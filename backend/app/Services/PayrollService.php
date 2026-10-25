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
 * A brand's period runs until its target hours are reached (about a month for 720 hours), or
 * until finance closes it early; the next one starts the day after. The brand's leader
 * host (its PIC) then requests payment; finance follows it up and marks it paid. Admins only look.
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
     * The brand's period a session on `$date` belongs to: the closed one whose dates cover it,
     * or else the running one. Null before the brand's payroll start date.
     */
    public function periodFor(Brand $brand, CarbonInterface|string $date): ?PaymentPeriod
    {
        $open = $this->openPeriod($brand);
        $day = CarbonImmutable::parse($date)->toDateString();
        if (! $open || $day < $brand->payroll_start_date->toDateString()) {
            return null;
        }

        return PaymentPeriod::where('brand_id', $brand->id)
            ->whereDate('period_start', '<=', $day)
            ->whereDate('period_end', '>=', $day)
            ->first() ?? $open;
    }

    /**
     * The brand's running period, started on first use: from the payroll start date, or the day
     * after the last period ended. Null without a payroll start date.
     */
    public function openPeriod(Brand $brand): ?PaymentPeriod
    {
        if (! $brand->payroll_start_date) {
            return null;
        }

        $open = PaymentPeriod::where('brand_id', $brand->id)->whereNull('period_end')->first();
        if ($open) {
            return $open;
        }

        return DB::transaction(function () use ($brand) {
            // One brand at a time: two approvals starting its next period at once wait here, and
            // the second finds (reading as committed now) the period the first started
            Brand::whereKey($brand->id)->lockForUpdate()->first();
            $open = PaymentPeriod::where('brand_id', $brand->id)->whereNull('period_end')->lockForUpdate()->first();
            if ($open) {
                return $open;
            }

            // Hours the brand couldn't absorb last period count toward this one
            $previous = PaymentPeriod::where('brand_id', $brand->id)->orderByDesc('period_end')->lockForUpdate()->first();

            return PaymentPeriod::create([
                'brand_id' => $brand->id,
                'period_start' => $previous
                    ? CarbonImmutable::parse($previous->period_end->toDateString())->addDay()->toDateString()
                    : $brand->payroll_start_date->toDateString(),
                'target_hours' => $brand->target_hours_per_period,
                'carried_in_hours' => $previous?->isLocked() ? $previous->carried_out_hours : 0,
                'status' => 'in_progress',
            ]);
        });
    }

    /**
     * Put an approved work session in its period, or the next open one if that period is already
     * locked; the period closes if that reaches the target.
     *
     * The period row is locked as requestPayment() locks it, so a session can't join a period
     * whose pay is being snapshotted without it (it would be neither paid nor carried over).
     */
    public function assign(WorkSession $session): void
    {
        $brand = $session->brand;

        $period = DB::transaction(function () use ($session, $brand) {
            $period = $this->periodFor($brand, $session->session_date);

            while ($period) {
                $period = PaymentPeriod::lockForUpdate()->findOrFail($period->id);
                if (! $period->isLocked()) {
                    break;
                }
                $period = $this->nextPeriod($period) ?? $this->openPeriod($brand);
            }

            if ($period) {
                $session->update(['payment_period_id' => $period->id]);
            }

            return $period;
        });

        if ($period) {
            $this->closeIfTargetReached($period);
        }
    }

    /**
     * Add or remove hours/sessions for a host in a period whose pay isn't requested yet.
     *
     * @param  array{host_id: string, sessions_added: int|string, hours_added: float|string, notes: string}  $attributes
     */
    public function addAdjustment(PaymentPeriod $period, array $attributes, User $by): HourAdjustment
    {
        return DB::transaction(function () use ($period, $attributes, $by) {
            $period = $this->lockOpen($period);

            return $period->adjustments()->create([
                ...$attributes,
                'hours_added' => round((float) $attributes['hours_added'], 2),
                'created_by' => $by->id,
            ]);
        });
    }

    public function removeAdjustment(HourAdjustment $adjustment): void
    {
        DB::transaction(function () use ($adjustment) {
            $this->lockOpen($adjustment->period);
            $adjustment->delete();
        });
    }

    /** Lock the period against requestPayment(), refusing one whose pay is already snapshotted. */
    private function lockOpen(PaymentPeriod $period): PaymentPeriod
    {
        $period = PaymentPeriod::lockForUpdate()->findOrFail($period->id);
        if ($period->isLocked()) {
            throw ValidationException::withMessages(['period' => ['Periode ini terkunci; pembayaran sudah diajukan.']]);
        }

        return $period;
    }

    /** Sessions approved before the brand had a payroll start date, oldest first so periods fill in order. */
    public function assignUnassigned(Brand $brand): int
    {
        $sessions = WorkSession::where('brand_id', $brand->id)
            ->whereNull('payment_period_id')
            ->with('brand')
            ->orderBy('session_date')
            ->orderBy('start_at')
            ->get();
        $sessions->each(fn (WorkSession $session) => $this->assign($session));

        return $sessions->count();
    }

    /**
     * Close the running period once carried-in plus worked hours reach its target. It ends on the
     * day of its last session; the next period starts the day after. The brand's leader is told to
     * request payment.
     */
    public function closeIfTargetReached(PaymentPeriod $period): bool
    {
        if ($period->status !== 'in_progress') {
            return false;
        }

        return DB::transaction(function () use ($period) {
            // Checked again under the lock: two approvals reaching the target at once close it
            // (and tell the PIC and admins) only once
            $period = PaymentPeriod::lockForUpdate()->findOrFail($period->id);
            if ($period->status !== 'in_progress') {
                return false;
            }

            $summary = $this->breakdown($period)['summary'];
            if ($period->target_hours > $summary['carried_in_hours'] + $summary['worked_hours']) {
                return false;
            }

            $lastSession = $period->workSessions()->max('session_date');
            $this->close($period, $lastSession ? CarbonImmutable::parse($lastSession) : CarbonImmutable::today(), null);

            return true;
        });
    }

    /**
     * Close a running period before its target, e.g. the brand stopped going live: it ends today
     * and its hours can be billed as they are.
     */
    public function closeEarly(PaymentPeriod $period, User $by): PaymentPeriod
    {
        return DB::transaction(function () use ($period, $by) {
            $period = PaymentPeriod::lockForUpdate()->findOrFail($period->id);

            if ($period->status !== 'in_progress') {
                $this->fail('Periode ini sudah ditutup.');
            }
            if (! $this->hasHours($period)) {
                $this->fail('Belum ada jam di periode ini.');
            }

            $lastSession = $period->workSessions()->max('session_date');
            $this->close($period, max(CarbonImmutable::today(), CarbonImmutable::parse($lastSession ?? today())), $by);

            return $period;
        });
    }

    private function close(PaymentPeriod $period, CarbonImmutable $end, ?User $by): void
    {
        $period->update([
            'period_end' => max($end, CarbonImmutable::parse($period->period_start->toDateString()))->toDateString(),
            'status' => 'waiting_payment',
            'closed_at' => now(),
            'closed_by' => $by?->id,
        ]);
        $this->openPeriod($period->brand);

        $period->loadMissing('brand');
        $summary = $this->breakdown($period)['summary'];
        $title = $by
            ? "Periode {$period->brand->name} ditutup lebih awal"
            : "Target {$period->target_hours} jam {$period->brand->name} tercapai";
        $notice = Notice::make('period_ready', $title)
            ->body("{$this->dates($period)}: {$this->hours($summary['achieved_hours'])} jam bisa ditagihkan. Ajukan pembayaran ke brand.")
            ->brand($period->brand->name)
            ->field('Periode', $this->dates($period))
            ->field('Jam ditagihkan', "{$this->hours($summary['achieved_hours'])} / {$this->hours($period->target_hours)} jam")
            ->field('Pindah ke periode berikutnya', $summary['carried_out_hours'] > 0 ? "{$this->hours($summary['carried_out_hours'])} jam" : null)
            ->field('Ditutup oleh', $by?->name ?? 'Otomatis (target tercapai)');

        $this->notifier->toUsers($this->notifier->brandLeaders($period->brand_id), (clone $notice)->link('/host/pay', 'Ajukan pembayaran'), dm: true);
        $this->notifier->toUsers($this->notifier->admins(), $notice->link('/admin/payroll', 'Buka payroll'), dm: true);
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
     * breakdown()'s summary and host count for a list of periods: the locked ones from their
     * snapshot in one query, only the running ones worked out live.
     *
     * @param  Collection<int, PaymentPeriod>  $periods
     * @return Collection<string, array{summary: array, hosts: int}>
     */
    public function summaries(Collection $periods): Collection
    {
        $locked = $periods->filter(fn (PaymentPeriod $period) => $period->isLocked());
        $items = $locked->isEmpty() ? collect() : PaymentItem::whereIn('payment_period_id', $locked->pluck('id'))
            ->groupBy('payment_period_id')
            ->selectRaw('payment_period_id, count(*) as hosts, sum(amount) as total_amount')
            ->get()
            ->keyBy('payment_period_id');

        return $periods->mapWithKeys(function (PaymentPeriod $period) use ($items) {
            if (! $period->isLocked()) {
                ['hosts' => $hosts, 'summary' => $summary] = $this->breakdown($period);

                return [$period->id => ['summary' => $summary, 'hosts' => $hosts->count()]];
            }

            $snapshot = $items->get($period->id);

            return [$period->id => ['hosts' => (int) ($snapshot?->hosts ?? 0), 'summary' => [
                'worked_hours' => $period->worked_hours,
                'host_paid_hours' => $period->host_paid_hours,
                'carried_in_hours' => $period->carried_in_hours,
                'achieved_hours' => $period->achieved_hours,
                'carried_out_hours' => $period->carried_out_hours,
                'target_hours' => $period->target_hours,
                'total_amount' => round((float) ($snapshot?->total_amount ?? 0)),
            ]]];
        });
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
     * Done by the brand's leader host once the target is reached (finance can on their behalf).
     */
    public function requestPayment(PaymentPeriod $period, User $by): PaymentRequest
    {
        $request = DB::transaction(function () use ($period, $by) {
            $period = PaymentPeriod::lockForUpdate()->findOrFail($period->id);

            if ($period->status === 'in_progress') {
                $summary = $this->breakdown($period)['summary'];
                $this->fail("Target {$period->target_hours} jam belum tercapai (baru {$this->hours($summary['carried_in_hours'] + $summary['worked_hours'])} jam). Finance bisa menutup periode lebih awal kalau brand berhenti live.");
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

            $next = $this->nextPeriod($period) ?? $this->openPeriod($period->brand);
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

        $period->refresh()->loadMissing('brand');
        $this->notifier->toUsers(
            $this->notifier->admins()->reject(fn (User $user) => $user->is($by)),
            Notice::make('payment_requested', "Pembayaran {$period->brand->name} diajukan")
                ->body("{$by->name} mengajukan {$this->hours($period->achieved_hours)} jam untuk {$this->dates($period)}. Tandai lunas setelah brand membayar.")
                ->brand($period->brand->name)
                ->field('Periode', $this->dates($period))
                ->field('Jam ditagihkan', "{$this->hours($period->achieved_hours)} jam")
                ->field('Diajukan oleh', $by->name)
                ->link('/admin/payroll', 'Tandai lunas'),
            dm: true,
        );

        // The hours carried over may already fill the next period
        if ($next = $this->nextPeriod($period)) {
            $this->closeIfTargetReached($next);
        }

        return $request;
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
     * Payroll at a glance, with host pay: periods that reached the target waiting for the PIC's
     * request, requested ones waiting for the brand's payment (and since when the oldest waits),
     * running periods, periods paid this month, and active brands without a payroll start.
     *
     * @return array{
     *     waiting_payment: array{count: int, amount: float},
     *     requested: array{count: int, amount: float, oldest_requested_at: ?string},
     *     in_progress: array{count: int},
     *     paid_this_month: array{count: int, amount: float},
     *     brands_without_start: array{count: int, names: list<string>},
     * }
     */
    public function overview(): array
    {
        // Not locked yet: pay comes from the live breakdown (there are few, the target just closed them)
        $waiting = PaymentPeriod::where('status', 'waiting_payment')->get();
        $requested = PaymentPeriod::where('status', 'requested')->select('id');
        $paidThisMonth = PaymentPeriod::where('status', 'paid')
            ->whereHas('paymentRequest', fn ($q) => $q->where('paid_at', '>=', now()->startOfMonth()))
            ->select('id');
        $oldestRequest = PaymentRequest::whereIn('payment_period_id', $requested)->where('status', '!=', 'cancelled')->min('requested_at');
        $withoutStart = Brand::where('status', 'active')->whereNull('payroll_start_date')->orderBy('name');

        return [
            'waiting_payment' => [
                'count' => $waiting->count(),
                'amount' => round($waiting->sum(fn (PaymentPeriod $period) => $this->breakdown($period)['summary']['total_amount']), 2),
            ],
            'requested' => [
                'count' => $requested->count(),
                'amount' => (float) PaymentItem::whereIn('payment_period_id', $requested)->sum('amount'),
                'oldest_requested_at' => $oldestRequest ? CarbonImmutable::parse($oldestRequest)->toIso8601String() : null,
            ],
            'in_progress' => ['count' => PaymentPeriod::where('status', 'in_progress')->count()],
            'paid_this_month' => [
                'count' => $paidThisMonth->count(),
                'amount' => (float) PaymentItem::whereIn('payment_period_id', $paidThisMonth)->sum('amount'),
            ],
            'brands_without_start' => [
                'count' => $withoutStart->count(),
                'names' => $withoutStart->limit(5)->pluck('name')->all(),
            ],
        ];
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
                ->whereDate('session_date', '<=', $period->period_end ?? today()))
            ->count();
    }

    public function nextPeriod(PaymentPeriod $period): ?PaymentPeriod
    {
        if (! $period->period_end) {
            return null;
        }

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

    /** "1 Okt – 7 Okt 2026", or "sejak 1 Okt 2026" while running */
    private function dates(PaymentPeriod $period): string
    {
        return $period->period_end
            ? $period->period_start->translatedFormat('j M').' – '.$period->period_end->translatedFormat('j M Y')
            : 'sejak '.$period->period_start->translatedFormat('j M Y');
    }

    /** "12,5" */
    private function hours(float $hours): string
    {
        return rtrim(rtrim(number_format($hours, 2, ',', '.'), '0'), ',');
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

            // Hosts whose hours all carried over (or who only have backups paid by another host) get no slip.
            // By host, so two periods paid at once lock the hosts' kasbon in the same order (no deadlock).
            return $period->items()->where('hours', '>', 0)->orderBy('host_id')->get()->map(function ($item) use ($period) {
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

                $this->notifier->toUsers($item->host->user, Notice::make('slip_ready', "Slip gaji siap: {$period->brand->name}")
                    ->body('Gaji bersih '.$this->rupiah($slip->net_amount)." untuk {$this->dates($period)}.")
                    ->brand($period->brand->name)
                    ->field('Periode', $this->dates($period))
                    ->field('Jam dibayar', "{$this->hours($item->hours)} jam")
                    ->field('Gaji kotor', $this->rupiah($slip->gross_amount))
                    ->field('Potongan kasbon', $deducted > 0 ? $this->rupiah($deducted) : null)
                    ->field('Gaji bersih', $this->rupiah($slip->net_amount))
                    ->link("/host/pay/slips/{$slip->id}", 'Lihat slip'), dm: true);

                return $slip;
            });
        });
    }

    /**
     * Take the next installment of each of the host's open kasbon (oldest first) if the slip covers it.
     * An installment that doesn't fit waits for the next slip; it is counted and listed on this slip as skipped.
     * The kasbon are locked, so slips from two brands paid at once can't both take the same installment.
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
            ->orderBy('id')
            ->lockForUpdate()
            ->get();

        foreach ($advances as $advance) {
            $installment = $advance->installments()->where('status', 'scheduled')->orderBy('seq')->lockForUpdate()->first();
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
        $outstanding = $this->outstandingAdvances($host);

        return ['monthly_salary' => $salary, 'outstanding' => $outstanding, 'available' => max(0, $salary - $outstanding)];
    }

    /** Kasbon installments the host has not paid back yet. */
    public function outstandingAdvances(HostProfile $host): float
    {
        return (float) CashAdvanceInstallment::where('status', 'scheduled')
            ->whereHas('advance', fn ($q) => $q->where('host_id', $host->id))
            ->sum('amount');
    }

    /**
     * The host's pay so far in each period not yet paid (estimate at today's rate): the periods
     * they worked in and the ones their hours over a target carried into. Oldest first, with the
     * brand's progress to the target (the period closes, and gets billed, once it is reached).
     *
     * @return Collection<int, array>
     */
    public function hostOpenPeriods(HostProfile $host): Collection
    {
        $periodIds = WorkSession::where('host_id', $host->id)->whereNotNull('payment_period_id')->pluck('payment_period_id')
            ->merge(HourAdjustment::where('host_id', $host->id)->pluck('payment_period_id'))
            ->merge(PaymentItem::where('host_id', $host->id)->where('carried_out_hours', '>', 0)->with('period')->get()
                ->map(fn (PaymentItem $item) => $this->nextPeriod($item->period)?->id)
                ->filter())
            ->unique();

        return PaymentPeriod::with('brand:id,name')
            ->whereIn('id', $periodIds)
            ->whereIn('status', ['in_progress', 'waiting_payment'])
            ->orderBy('period_start')
            ->get()
            ->map(function (PaymentPeriod $period) use ($host) {
                $breakdown = $this->breakdown($period);
                $row = $breakdown['hosts']->firstWhere('host_id', $host->id);

                return $row ? [
                    'period_id' => $period->id,
                    'brand' => $period->brand->only('id', 'name'),
                    'period_start' => $period->period_start->toDateString(),
                    'period_end' => $period->period_end?->toDateString(),
                    'status' => $period->status,
                    'target_hours' => $period->target_hours,
                    // Everyone's hours toward the target: carried in + worked
                    'brand_hours' => round($breakdown['summary']['carried_in_hours'] + $breakdown['summary']['worked_hours'], 2),
                    'session_count' => $row['session_count'],
                    'carried_in_hours' => $row['carried_in_hours'],
                    'worked_hours' => $row['worked_hours'],
                    'hours' => $row['hours'],
                    'carried_out_hours' => $row['carried_out_hours'],
                    'rate_per_hour' => $row['rate_per_hour'],
                    'estimate' => $row['amount'],
                    'host_paid' => $row['host_paid'],
                ] : null;
            })
            ->filter()
            ->values();
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
     * Remove a kasbon recorded by mistake, as long as nothing was paid back yet. Locked so it
     * can't disappear while a slip is taking its installment.
     */
    public function deleteAdvance(CashAdvance $advance): void
    {
        DB::transaction(function () use ($advance) {
            $advance = CashAdvance::lockForUpdate()->findOrFail($advance->id);
            if ($advance->installments()->where('status', '!=', 'scheduled')->exists()) {
                throw ValidationException::withMessages(['advance' => ['Sebagian kasbon ini sudah dibayar; tidak bisa dihapus lagi.']]);
            }

            $advance->delete();
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
     * Every active brand with a payroll start date has a running period, closed if it already
     * reached its target (e.g. after the target was lowered). Runs nightly as a safety net.
     *
     * @return int how many periods closed
     */
    public function rollPeriods(): int
    {
        return Brand::whereNotNull('payroll_start_date')->where('status', 'active')->get()
            ->filter(fn (Brand $brand) => $this->closeIfTargetReached($this->openPeriod($brand)))
            ->count();
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
