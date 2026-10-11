<?php

namespace App\Services;

use App\Models\Brand;
use App\Models\CashAdvance;
use App\Models\CashAdvanceInstallment;
use App\Models\HostProfile;
use App\Models\HourAdjustment;
use App\Models\LiveReport;
use App\Models\PaymentItem;
use App\Models\PaymentPeriod;
use App\Models\PaymentRequest;
use App\Models\SalarySlip;
use App\Models\ScheduleSlot;
use App\Models\User;
use App\Models\WorkSession;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Payment periods per brand, host pay, brand invoices (target cap + carry-over),
 * salary slips and kasbon deductions.
 *
 * A period pays at most the brand's target: hours carried in from the last period first, then
 * this period's hours. Hours over the target stay unpaid and carry to the next period, cut
 * from every host by the same share. What the brand is billed and what hosts are paid always
 * cover the same hours. Backups the requesting host pays the cover for directly count toward
 * the target but are not on payroll.
 */
class PayrollService
{
    /** The line for billed hours no host is paid for here (backups another host paid, hours carried before 2026-10-11). */
    private const OFF_PAYROLL = 'off_payroll';

    public function __construct(private Notifier $notifier) {}

    /**
     * The brand's period containing `$date`, created on first use. Null before the brand's payroll start date.
     */
    public function periodFor(Brand $brand, CarbonInterface|string $date): ?PaymentPeriod
    {
        if (! $brand->payroll_start_date) {
            return null;
        }

        $anchor = CarbonImmutable::parse($brand->payroll_start_date->toDateString());
        $day = CarbonImmutable::parse($date)->startOfDay();
        if ($day->lt($anchor)) {
            return null;
        }

        $cycle = max(1, $brand->payment_cycle_days);
        $start = $anchor->addDays(intdiv((int) floor($anchor->diffInDays($day)), $cycle) * $cycle);
        $end = $start->addDays($cycle - 1);

        $period = PaymentPeriod::where('brand_id', $brand->id)->whereDate('period_start', $start)->first();
        if ($period) {
            return $period;
        }

        // Hours the brand couldn't absorb last period count toward this one
        $previous = PaymentPeriod::where('brand_id', $brand->id)->whereDate('period_end', $start->subDay())->first();

        return PaymentPeriod::create([
            'brand_id' => $brand->id,
            'period_start' => $start->toDateString(),
            'period_end' => $end->toDateString(),
            'target_hours' => $brand->target_hours_per_period,
            'carried_in_hours' => $previous?->isLocked() ? $previous->carried_out_hours : 0,
            'status' => $end->lt(today()) ? 'waiting_payment' : 'in_progress',
        ]);
    }

    /**
     * Put an approved work session in its period, or the next open one if that period is already locked.
     */
    public function assign(WorkSession $session): void
    {
        $brand = $session->brand;
        $period = $this->periodFor($brand, $session->session_date);

        while ($period?->isLocked()) {
            $period = $this->periodFor($brand, CarbonImmutable::parse($period->period_end->toDateString())->addDay());
        }

        if ($period) {
            $session->update(['payment_period_id' => $period->id]);
        }
    }

    /** Sessions approved before the brand had a payroll start date. */
    public function assignUnassigned(Brand $brand): int
    {
        $sessions = WorkSession::where('brand_id', $brand->id)->whereNull('payment_period_id')->with('brand')->get();
        $sessions->each(fn (WorkSession $session) => $this->assign($session));

        return $sessions->count();
    }

    /**
     * Per-host pay and the brand invoice: the snapshot once locked, otherwise live (at today's rates).
     *
     * hours = paid in this period: carried in + worked − carried out. worked_hours leaves out
     * backups the requesting host paid the cover for (listed in host_paid instead).
     * achieved_hours (billed) = carried in + all worked hours, capped at the target.
     *
     * @return array{
     *     hosts: Collection<int, array{host_id: string, name: string, session_count: int, carried_in_hours: float, worked_hours: float, hours: float, carried_out_hours: float, rate_per_hour: float, amount: float, estimate: bool, host_paid: list<array{payer: string, hours: float}>}>,
     *     summary: array{worked_hours: float, host_paid_hours: float, carried_in_hours: float, achieved_hours: float, carried_out_hours: float, target_hours: int, total_amount: float},
     * }
     */
    public function breakdown(PaymentPeriod $period): array
    {
        $hostPaid = $this->coverSessions($period)->where('paid_by', 'requester');

        if ($period->isLocked()) {
            $hosts = $period->items()->with('host.user')->get()
                ->map(fn (PaymentItem $item) => [
                    'host_id' => $item->host_id,
                    'name' => $item->host->user->name,
                    'session_count' => $item->session_count,
                    'carried_in_hours' => $item->carried_in_hours,
                    'worked_hours' => $item->worked_hours,
                    'hours' => $item->hours,
                    'carried_out_hours' => $item->carried_out_hours,
                    'rate_per_hour' => $item->rate_per_hour,
                    'amount' => $item->amount,
                    'estimate' => false,
                    'host_paid' => $this->paidByPayer($hostPaid, $item->host_id),
                ])
                ->sortBy('name')
                ->values();

            return ['hosts' => $hosts, 'summary' => [
                'worked_hours' => $period->worked_hours,
                'host_paid_hours' => $period->host_paid_hours,
                'carried_in_hours' => $period->carried_in_hours,
                'achieved_hours' => $period->achieved_hours,
                'carried_out_hours' => $period->carried_out_hours,
                'target_hours' => $period->target_hours,
                'total_amount' => round($hosts->sum('amount')),
            ]];
        }

        $sessions = WorkSession::where('payment_period_id', $period->id)
            ->whereNotIn('id', $hostPaid->pluck('session_id'))
            ->get(['id', 'host_id', 'duration_hours'])
            ->groupBy('host_id');
        $adjustments = HourAdjustment::where('payment_period_id', $period->id)->get()->groupBy('host_id');
        [$carriedIn, $offPayrollCarriedIn] = $this->carriedIn($period);

        $hostIds = $sessions->keys()->merge($adjustments->keys())->merge(array_keys($carriedIn))->merge($hostPaid->pluck('host_id'))->unique();
        $profiles = HostProfile::with(['user', 'rateCategory'])->whereIn('id', $hostIds)->get()->keyBy('id');

        $lines = [];
        foreach ($hostIds as $id) {
            $lines[$id] = [
                'carried_in' => $carriedIn[$id] ?? 0.0,
                'worked' => max(0, round((float) ($sessions[$id] ?? collect())->sum('duration_hours') + (float) ($adjustments[$id] ?? collect())->sum('hours_added'), 2)),
                'sessions' => max(0, ($sessions[$id] ?? collect())->count() + (int) ($adjustments[$id] ?? collect())->sum('sessions_added')),
            ];
        }
        $lines[self::OFF_PAYROLL] = ['carried_in' => $offPayrollCarriedIn, 'worked' => round($hostPaid->sum('hours'), 2), 'sessions' => 0];
        $split = $this->allocate($lines, $period->target_hours);

        $hosts = $hostIds
            ->map(function (string $id) use ($lines, $split, $profiles, $hostPaid) {
                $rate = (float) ($profiles[$id]->rateCategory?->rate_per_hour ?? 0);

                return [
                    'host_id' => $id,
                    'name' => $profiles[$id]->user->name,
                    'session_count' => $lines[$id]['sessions'],
                    'carried_in_hours' => $lines[$id]['carried_in'],
                    'worked_hours' => $lines[$id]['worked'],
                    'hours' => $split[$id]['paid'],
                    'carried_out_hours' => $split[$id]['carried_out'],
                    'rate_per_hour' => $rate,
                    'amount' => round($split[$id]['paid'] * $rate),
                    'estimate' => true,
                    'host_paid' => $this->paidByPayer($hostPaid, $id),
                ];
            })
            ->sortBy('name')
            ->values();

        return ['hosts' => $hosts, 'summary' => [
            'worked_hours' => round(array_sum(array_column($lines, 'worked')), 2),
            'host_paid_hours' => $lines[self::OFF_PAYROLL]['worked'],
            'carried_in_hours' => $period->carried_in_hours,
            'achieved_hours' => round(array_sum(array_column($split, 'paid')), 2),
            'carried_out_hours' => round(array_sum(array_column($split, 'carried_out')), 2),
            'target_hours' => $period->target_hours,
            'total_amount' => round($hosts->sum('amount')),
        ]];
    }

    /**
     * Fill the target with carried-in hours first, then this period's hours; what doesn't fit
     * carries out. When a group doesn't fit, every line in it gets the same share of the room.
     *
     * @param  array<string, array{carried_in: float, worked: float}>  $lines
     * @return array<string, array{paid: float, carried_out: float}>
     */
    private function allocate(array $lines, int $target): array
    {
        // Hundredths of an hour, so the shares add up exactly
        $carried = array_map(fn (array $line) => (int) round($line['carried_in'] * 100), $lines);
        $worked = array_map(fn (array $line) => (int) round($line['worked'] * 100), $lines);

        $fromCarried = $this->apportion($carried, $target * 100);
        $fromWorked = $this->apportion($worked, $target * 100 - array_sum($fromCarried));

        $split = [];
        foreach ($lines as $key => $line) {
            $paid = $fromCarried[$key] + $fromWorked[$key];
            $split[$key] = ['paid' => $paid / 100, 'carried_out' => ($carried[$key] + $worked[$key] - $paid) / 100];
        }

        return $split;
    }

    /**
     * Everything if it fits in $room; otherwise $room split in proportion to the weights,
     * the units left after rounding down going to the largest remainders.
     *
     * @param  array<string, int>  $weights
     * @return array<string, int>
     */
    private function apportion(array $weights, int $room): array
    {
        $sum = array_sum($weights);
        if ($sum <= $room) {
            return $weights;
        }

        $shares = [];
        $remainders = [];
        foreach ($weights as $key => $weight) {
            $shares[$key] = intdiv($weight * $room, $sum);
            $remainders[$key] = ($weight * $room) % $sum;
        }
        arsort($remainders);
        foreach (array_slice(array_keys($remainders), 0, $room - array_sum($shares)) as $key) {
            $shares[$key]++;
        }

        return $shares;
    }

    /**
     * Hours each host carries in from the previous period (once it is locked), and the carried
     * hours no host is paid for (their part of off-payroll hours, or carried before 2026-10-11).
     *
     * @return array{0: array<string, float>, 1: float}
     */
    private function carriedIn(PaymentPeriod $period): array
    {
        $previous = $this->previousPeriod($period);
        if (! $previous?->isLocked()) {
            return [[], 0.0];
        }

        $perHost = $previous->items()->where('carried_out_hours', '>', 0)->get()
            ->mapWithKeys(fn (PaymentItem $item) => [$item->host_id => $item->carried_out_hours])
            ->all();

        return [$perHost, max(0, round($period->carried_in_hours - array_sum($perHost), 2))];
    }

    /**
     * Backup sessions in the period and who pays the cover (see BackupRequest::coverPaidBy):
     * "agency", "requester" (directly, outside payroll) or null while a sick letter can still come.
     *
     * @return Collection<int, array{session_id: string, host_id: string, hours: float, paid_by: ?string, payer: string}>
     */
    private function coverSessions(PaymentPeriod $period): Collection
    {
        return WorkSession::where('payment_period_id', $period->id)
            ->where('session_type', 'backup')
            ->with('liveReport.attendance.backupRequest.requester.user')
            ->get()
            ->map(function (WorkSession $session) {
                $request = $session->liveReport?->attendance?->backupRequest;

                return [
                    'session_id' => $session->id,
                    'host_id' => $session->host_id,
                    'hours' => $session->duration_hours,
                    'paid_by' => $request ? $request->cover_paid_by : 'agency',
                    'payer' => $request?->requester->user->name ?? '',
                ];
            });
    }

    /**
     * A host's backup hours paid directly by the hosts they covered, per payer.
     *
     * @param  Collection<int, array{host_id: string, payer: string, hours: float}>  $hostPaid
     * @return list<array{payer: string, hours: float}>
     */
    private function paidByPayer(Collection $hostPaid, string $hostId): array
    {
        return $hostPaid->where('host_id', $hostId)
            ->groupBy('payer')
            ->map(fn (Collection $covers, string $payer) => ['payer' => $payer, 'hours' => round($covers->sum('hours'), 2)])
            ->values()
            ->all();
    }

    /**
     * Sick-leave backups in the period whose letter can still come: until then it isn't known
     * whether the agency or the requesting host pays the cover.
     */
    public function pendingCoverLetters(PaymentPeriod $period): int
    {
        return $this->coverSessions($period)->whereNull('paid_by')->count();
    }

    /**
     * Lock the period, snapshot host pay at today's rates, and ask the brand to pay.
     */
    public function requestPayment(PaymentPeriod $period, User $by): PaymentRequest
    {
        return DB::transaction(function () use ($period, $by) {
            $period = PaymentPeriod::lockForUpdate()->findOrFail($period->id);

            if ($period->status === 'in_progress') {
                $this->fail('Pembayaran baru bisa diajukan setelah periode berakhir.');
            }
            if ($period->isLocked()) {
                $this->fail('Pembayaran untuk periode ini sudah diajukan.');
            }

            // Hours still under review would otherwise slip into the next period unnoticed
            $pending = $this->pendingReports($period);
            if ($pending > 0) {
                $this->fail("{$pending} laporan live di periode ini masih menunggu dicek. Setujui atau tolak dulu.");
            }

            // Who pays a sick-leave cover is only known once the letter is in or its deadline passed
            $letters = $this->pendingCoverLetters($period);
            if ($letters > 0) {
                $this->fail("{$letters} sesi backup karena sakit masih menunggu surat dokter. Tunggu suratnya diunggah atau batas waktunya lewat.");
            }

            // This period starts with the hours the previous one carries out
            $previous = $this->previousPeriod($period);
            if ($previous && ! $previous->isLocked() && $this->hasHours($previous)) {
                $this->fail("Ajukan dulu periode sebelumnya ({$this->dates($previous)}); jam yang melewati targetnya dibawa ke periode ini.");
            }

            ['hosts' => $hosts, 'summary' => $summary] = $this->breakdown($period);

            $next = $this->periodFor($period->brand, CarbonImmutable::parse($period->period_end->toDateString())->addDay());
            if ($summary['carried_out_hours'] > 0 && $next?->isLocked()) {
                $this->fail("Periode berikutnya ({$this->dates($next)}) sudah diajukan, jadi {$summary['carried_out_hours']} jam yang melewati target tidak bisa dibawa ke sana. Batalkan pengajuan periode itu dulu.");
            }

            $period->items()->delete();
            foreach ($hosts as $row) {
                $period->items()->create([
                    'host_id' => $row['host_id'],
                    'session_count' => $row['session_count'],
                    'carried_in_hours' => $row['carried_in_hours'],
                    'worked_hours' => $row['worked_hours'],
                    'hours' => $row['hours'],
                    'carried_out_hours' => $row['carried_out_hours'],
                    'rate_per_hour' => $row['rate_per_hour'],
                    'amount' => $row['amount'],
                ]);
            }

            $period->update([
                'worked_hours' => $summary['worked_hours'],
                'host_paid_hours' => $summary['host_paid_hours'],
                'achieved_hours' => $summary['achieved_hours'],
                'carried_out_hours' => $summary['carried_out_hours'],
                'status' => 'requested',
                'locked_at' => now(),
            ]);

            if ($next && ! $next->isLocked()) {
                $next->update(['carried_in_hours' => $summary['carried_out_hours']]);
            }

            return PaymentRequest::create([
                'payment_period_id' => $period->id,
                'requested_by' => $by->id,
                'requested_at' => now(),
                'status' => 'requested',
                'exported_report_url' => "/api/finance/payroll/periods/{$period->id}/export",
            ]);
        });
    }

    /**
     * Take back a request (e.g. a mistake spotted after sending the report): unlock the period
     * so hours and adjustments can change, and undo the hours it carried to the next period.
     * The cancelled request is kept as history.
     */
    public function cancelRequest(PaymentPeriod $period, User $by, string $reason): void
    {
        DB::transaction(function () use ($period, $by, $reason) {
            $period = PaymentPeriod::lockForUpdate()->findOrFail($period->id);

            if ($period->status !== 'requested') {
                $this->fail($period->status === 'paid' ? 'Periode ini sudah lunas; tidak bisa dibuka lagi.' : 'Pembayaran untuk periode ini belum diajukan.');
            }

            $next = $this->nextPeriod($period);
            if ($next?->isLocked()) {
                $this->fail('Periode berikutnya sudah terkunci dengan jam bawaan dari periode ini. Batalkan pengajuannya dulu.');
            }

            $period->paymentRequest?->update([
                'status' => 'cancelled',
                'cancelled_at' => now(),
                'cancelled_by' => $by->id,
                'cancel_reason' => $reason,
            ]);

            $period->items()->delete();
            $period->update([
                'worked_hours' => 0,
                'host_paid_hours' => 0,
                'achieved_hours' => 0,
                'carried_out_hours' => 0,
                'status' => 'waiting_payment',
                'locked_at' => null,
            ]);

            $next?->update(['carried_in_hours' => 0]);
        });
    }

    /**
     * Live reports for the period's brand and dates that nobody has approved or rejected yet.
     */
    public function pendingReports(PaymentPeriod $period): int
    {
        return LiveReport::where('brand_id', $period->brand_id)
            ->whereIn('status', ['submitted', 'flagged'])
            ->whereHas('attendance', fn ($q) => $q
                ->whereDate('session_date', '>=', $period->period_start)
                ->whereDate('session_date', '<=', $period->period_end))
            ->count();
    }

    public function nextPeriod(PaymentPeriod $period): ?PaymentPeriod
    {
        return PaymentPeriod::where('brand_id', $period->brand_id)
            ->whereDate('period_start', CarbonImmutable::parse($period->period_end->toDateString())->addDay())
            ->first();
    }

    private function previousPeriod(PaymentPeriod $period): ?PaymentPeriod
    {
        return PaymentPeriod::where('brand_id', $period->brand_id)
            ->whereDate('period_end', CarbonImmutable::parse($period->period_start->toDateString())->subDay())
            ->first();
    }

    /** Whether anything in the period could be paid or carried. */
    private function hasHours(PaymentPeriod $period): bool
    {
        return $period->carried_in_hours > 0 || $period->workSessions()->exists() || $period->adjustments()->exists();
    }

    /** "1 Okt – 7 Okt 2026" */
    private function dates(PaymentPeriod $period): string
    {
        return $period->period_start->translatedFormat('j M').' – '.$period->period_end->translatedFormat('j M Y');
    }

    /**
     * The brand paid: close the period and create a salary slip per host paid something (kasbon deducted).
     *
     * @return Collection<int, SalarySlip>
     */
    public function markPaid(PaymentPeriod $period, ?string $reference = null): Collection
    {
        return DB::transaction(function () use ($period, $reference) {
            $period = PaymentPeriod::lockForUpdate()->findOrFail($period->id);

            if ($period->status !== 'requested') {
                $this->fail($period->status === 'paid' ? 'Periode ini sudah lunas.' : 'Ajukan pembayaran dulu.');
            }

            $period->paymentRequest?->update(['status' => 'paid', 'paid_at' => now(), 'payment_reference' => $reference]);
            $period->update(['status' => 'paid']);

            // Hosts whose hours all carried over (or who only have backups paid by another host) get no slip
            return $period->items()->where('hours', '>', 0)->get()->map(function ($item) use ($period) {
                $slip = SalarySlip::create([
                    'host_id' => $item->host_id,
                    'payment_period_id' => $period->id,
                    'gross_amount' => $item->amount,
                    'advance_deduction' => 0,
                    'net_amount' => $item->amount,
                    'generated_at' => now(),
                ]);

                [$deducted, $skipped] = $this->deductAdvances($slip, $period);
                $slip->update([
                    'advance_deduction' => $deducted,
                    'skipped_deductions' => $skipped ?: null,
                    'net_amount' => $slip->gross_amount - $deducted,
                ]);

                $this->notifier->toUsers(
                    $item->host->user,
                    'slip_ready',
                    "Slip gaji siap: {$period->brand->name}",
                    'Gaji bersih '.$this->rupiah($slip->net_amount)." untuk {$this->dates($period)}.",
                    "/host/pay/slips/{$slip->id}",
                    dm: true,
                );

                return $slip;
            });
        });
    }

    /**
     * Take the next installment of each of the host's open kasbon (oldest first) if the slip covers it.
     * An installment that doesn't fit waits for the next slip; it is counted and listed on this slip as skipped.
     *
     * @return array{0: float, 1: list<array{type: string, seq: int, installment_count: int, amount: float}>}
     */
    private function deductAdvances(SalarySlip $slip, PaymentPeriod $period): array
    {
        $remaining = $slip->gross_amount;
        $deducted = 0.0;
        $skipped = [];

        $advances = CashAdvance::where('host_id', $slip->host_id)
            ->whereIn('status', ['unpaid', 'in_progress'])
            ->orderBy('requested_at')
            ->get();

        foreach ($advances as $advance) {
            $installment = $advance->installments()->where('status', 'scheduled')->first();
            if (! $installment) {
                continue;
            }
            if ($installment->amount > $remaining) {
                $installment->increment('skip_count');
                $skipped[] = [
                    'type' => $advance->type,
                    'seq' => $installment->seq,
                    'installment_count' => $advance->installment_count,
                    'amount' => $installment->amount,
                ];

                continue;
            }

            $installment->update([
                'status' => 'deducted',
                'payment_period_id' => $period->id,
                'salary_slip_id' => $slip->id,
                'deducted_brand_id' => $period->brand_id,
                'deducted_at' => now(),
            ]);
            $remaining -= $installment->amount;
            $deducted += $installment->amount;

            $open = $advance->installments()->where('status', 'scheduled')->exists();
            $advance->update(['status' => $open ? 'in_progress' : 'paid']);
        }

        return [$deducted, $skipped];
    }

    /**
     * What a host earns in a month by their schedule: active weekly slot hours × 52/12 × their rate.
     */
    public function monthlySalary(HostProfile $host): float
    {
        $minutes = ScheduleSlot::activeOn(today())
            ->whereHas('assignment', fn ($q) => $q->where('host_id', $host->id)->where('status', 'active'))
            ->get()
            ->sum(function (ScheduleSlot $slot) {
                [$start, $end] = $slot->weekRange();

                return $end - $start;
            });

        return round($minutes / 60 * 52 / 12 * (float) ($host->rateCategory?->rate_per_hour ?? 0));
    }

    /**
     * How much more kasbon the host may take: open kasbon (installments not yet paid back)
     * may not exceed their monthly salary.
     *
     * @return array{monthly_salary: float, outstanding: float, available: float}
     */
    public function advanceLimit(HostProfile $host): array
    {
        $salary = $this->monthlySalary($host);
        $outstanding = (float) CashAdvanceInstallment::where('status', 'scheduled')
            ->whereHas('advance', fn ($q) => $q->where('host_id', $host->id))
            ->sum('amount');

        return ['monthly_salary' => $salary, 'outstanding' => $outstanding, 'available' => max(0, $salary - $outstanding)];
    }

    /**
     * Record a kasbon (within the host's limit) and split it into equal installments (the last one takes the rounding).
     */
    public function recordAdvance(HostProfile $host, array $attributes, User $by): CashAdvance
    {
        return DB::transaction(function () use ($host, $attributes, $by) {
            // One kasbon at a time per host, so two at once can't both fit under the limit
            $host = HostProfile::with('rateCategory')->lockForUpdate()->findOrFail($host->id);

            $limit = $this->advanceLimit($host);
            if ($attributes['total_amount'] > $limit['available']) {
                throw ValidationException::withMessages(['total_amount' => [$limit['monthly_salary'] > 0
                    ? 'Melebihi batas kasbon. Gaji bulanan dari jadwal '.$this->rupiah($limit['monthly_salary']).', kasbon berjalan '.$this->rupiah($limit['outstanding']).', jadi maksimal '.$this->rupiah($limit['available']).'.'
                    : 'Host ini belum punya jadwal aktif atau tarif, jadi belum ada gaji bulanan untuk batas kasbon.']]);
            }

            $advance = CashAdvance::create([
                ...$attributes,
                'host_id' => $host->id,
                'status' => 'unpaid',
                'recorded_by' => $by->id,
                'requested_at' => now(),
            ]);

            $this->scheduleInstallments($advance, (int) round($advance->total_amount), $advance->installment_count, 1);

            return $advance->load('installments');
        });
    }

    /**
     * The host paid the rest back outside payroll (cash or transfer): close every open installment.
     */
    public function settleAdvance(CashAdvance $advance, User $by, ?string $note): CashAdvance
    {
        return DB::transaction(function () use ($advance, $by, $note) {
            $advance = CashAdvance::lockForUpdate()->findOrFail($advance->id);
            if ($advance->status === 'paid') {
                throw ValidationException::withMessages(['advance' => ['Kasbon ini sudah lunas.']]);
            }

            $advance->installments()->where('status', 'scheduled')->update(['status' => 'settled']);
            $advance->update([
                'status' => 'paid',
                'settled_at' => now(),
                'settled_by' => $by->id,
                'settled_note' => $note,
            ]);

            return $advance->load('installments');
        });
    }

    /**
     * Spread what's still owed over a new number of installments (e.g. the host's pay dropped).
     */
    public function rescheduleAdvance(CashAdvance $advance, int $count): CashAdvance
    {
        return DB::transaction(function () use ($advance, $count) {
            $advance = CashAdvance::lockForUpdate()->findOrFail($advance->id);
            $open = $advance->installments()->where('status', 'scheduled')->get();
            if ($open->isEmpty()) {
                throw ValidationException::withMessages(['advance' => ['Tidak ada sisa yang harus dibayar untuk kasbon ini.']]);
            }

            $firstSeq = $open->min('seq');
            $advance->installments()->where('status', 'scheduled')->delete();
            $this->scheduleInstallments($advance, (int) round($open->sum('amount')), $count, $firstSeq);
            $advance->update(['installment_count' => $firstSeq - 1 + $count]);

            return $advance->load('installments');
        });
    }

    /**
     * Split $total into $count equal installments numbered from $firstSeq (the last one takes the rounding).
     */
    private function scheduleInstallments(CashAdvance $advance, int $total, int $count, int $firstSeq): void
    {
        $each = intdiv($total, $count);

        for ($i = 1; $i <= $count; $i++) {
            $advance->installments()->create([
                'seq' => $firstSeq + $i - 1,
                'amount' => $i === $count ? $total - $each * ($count - 1) : $each,
                'status' => 'scheduled',
            ]);
        }
    }

    /**
     * Everything a printed salary slip shows. Bank account numbers stay masked.
     */
    public function slipDetail(SalarySlip $slip): array
    {
        $slip->load(['host.user', 'host.sensitiveData', 'period.brand:id,name', 'deductions.advance']);
        $item = $slip->period->items()->where('host_id', $slip->host_id)->first();

        return [
            'id' => $slip->id,
            'host_name' => $slip->host->user->name,
            'brand' => $slip->period->brand->only('id', 'name'),
            'period_start' => $slip->period->period_start->toDateString(),
            'period_end' => $slip->period->period_end->toDateString(),
            'session_count' => $item?->session_count ?? 0,
            'carried_in_hours' => $item?->carried_in_hours ?? 0,
            'worked_hours' => $item?->worked_hours ?? 0,
            'hours' => $item?->hours ?? 0,
            'carried_out_hours' => $item?->carried_out_hours ?? 0,
            'rate_per_hour' => $item?->rate_per_hour ?? 0,
            'gross_amount' => $slip->gross_amount,
            'advance_deduction' => $slip->advance_deduction,
            'net_amount' => $slip->net_amount,
            'deductions' => $slip->deductions->map(fn ($installment) => [
                'type' => $installment->advance->type,
                'seq' => $installment->seq,
                'installment_count' => $installment->advance->installment_count,
                'amount' => $installment->amount,
            ])->values(),
            'skipped_deductions' => $slip->skipped_deductions ?? [],
            'bank' => $slip->host->sensitiveData ? [
                'bank_name' => $slip->host->sensitiveData->bank_name,
                'account' => $slip->host->sensitiveData->bank_account_masked,
                'holder' => $slip->host->sensitiveData->account_holder_name,
            ] : null,
            'generated_at' => $slip->generated_at,
        ];
    }

    /**
     * Ended periods wait for payment; every brand with a payroll start date gets its current period.
     */
    public function rollPeriods(): int
    {
        // One by one rather than a bulk update, so each change lands in the audit log
        $ended = PaymentPeriod::where('status', 'in_progress')->whereDate('period_end', '<', today())->get();
        $ended->each(fn (PaymentPeriod $period) => $period->update(['status' => 'waiting_payment']));
        $closed = $ended->count();

        Brand::whereNotNull('payroll_start_date')->where('status', 'active')->get()
            ->each(fn (Brand $brand) => $this->periodFor($brand, today()));

        return $closed;
    }

    /**
     * The brand report for a period as CSV: every session, then adjustments and totals.
     */
    public function exportCsv(PaymentPeriod $period): string
    {
        $out = fopen('php://temp', 'r+');
        $summary = $this->breakdown($period)['summary'];

        fputcsv($out, ['Brand', $period->brand->name]);
        fputcsv($out, ['Periode', $period->period_start->toDateString(), $period->period_end->toDateString()]);
        fputcsv($out, []);
        fputcsv($out, ['Tanggal', 'Host', 'Mulai', 'Selesai', 'Jam', 'Jenis']);

        WorkSession::where('payment_period_id', $period->id)->with('host.user')->orderBy('start_at')->get()
            ->each(fn (WorkSession $session) => fputcsv($out, [
                $session->session_date->toDateString(),
                $session->host->user->name,
                $session->start_at->format('Y-m-d H:i'),
                $session->end_at->format('Y-m-d H:i'),
                $session->duration_hours,
                $session->session_type,
            ]));

        $adjustments = $period->adjustments()->with('host.user')->get();
        if ($adjustments->isNotEmpty()) {
            fputcsv($out, []);
            fputcsv($out, ['Penyesuaian']);
            fputcsv($out, ['Host', 'Sesi', 'Jam', 'Catatan']);
            $adjustments->each(fn (HourAdjustment $adjustment) => fputcsv($out, [
                $adjustment->host->user->name, $adjustment->sessions_added, $adjustment->hours_added, $adjustment->notes,
            ]));
        }

        fputcsv($out, []);
        fputcsv($out, ['Jam kerja', $summary['worked_hours']]);
        fputcsv($out, ['Bawaan dari periode lalu', $summary['carried_in_hours']]);
        fputcsv($out, ["Jam yang ditagihkan (target {$summary['target_hours']})", $summary['achieved_hours']]);
        fputcsv($out, ['Dibawa ke periode berikutnya', $summary['carried_out_hours']]);

        rewind($out);
        $csv = stream_get_contents($out);
        fclose($out);

        return $csv;
    }

    private function rupiah(float $amount): string
    {
        return 'Rp '.number_format($amount, 0, ',', '.');
    }

    private function fail(string $message): never
    {
        throw ValidationException::withMessages(['period' => [$message]]);
    }
}
