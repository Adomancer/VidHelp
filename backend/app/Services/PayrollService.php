<?php

namespace App\Services;

use App\Models\Brand;
use App\Models\CashAdvance;
use App\Models\HostProfile;
use App\Models\HourAdjustment;
use App\Models\LiveReport;
use App\Models\PaymentPeriod;
use App\Models\PaymentRequest;
use App\Models\SalarySlip;
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
 * Hosts are paid for every approved hour in the period; the target cap and carried
 * hours only change what the brand is invoiced. (Agency decision still open.)
 */
class PayrollService
{
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
     * Per-host pay: the snapshot once locked, otherwise live (sessions + adjustments at today's rate).
     *
     * @return Collection<int, array{host_id: string, name: string, session_count: int, hours: float, rate_per_hour: float, amount: float, estimate: bool}>
     */
    public function hostTotals(PaymentPeriod $period): Collection
    {
        if ($period->isLocked()) {
            return $period->items()->with('host.user')->get()
                ->map(fn ($item) => [
                    'host_id' => $item->host_id,
                    'name' => $item->host->user->name,
                    'session_count' => $item->session_count,
                    'hours' => $item->hours,
                    'rate_per_hour' => $item->rate_per_hour,
                    'amount' => $item->amount,
                    'estimate' => false,
                ])
                ->sortBy('name')
                ->values();
        }

        $sessions = WorkSession::where('payment_period_id', $period->id)
            ->selectRaw('host_id, count(*) as sessions, sum(duration_hours) as hours')
            ->groupBy('host_id')->get()->keyBy('host_id');
        $adjustments = HourAdjustment::where('payment_period_id', $period->id)
            ->selectRaw('host_id, sum(sessions_added) as sessions, sum(hours_added) as hours')
            ->groupBy('host_id')->get()->keyBy('host_id');

        return HostProfile::with(['user', 'rateCategory'])
            ->whereIn('id', $sessions->keys()->merge($adjustments->keys())->unique())
            ->get()
            ->map(function (HostProfile $host) use ($sessions, $adjustments) {
                $hours = max(0, round((float) ($sessions[$host->id]->hours ?? 0) + (float) ($adjustments[$host->id]->hours ?? 0), 2));
                $count = max(0, (int) ($sessions[$host->id]->sessions ?? 0) + (int) ($adjustments[$host->id]->sessions ?? 0));
                $rate = (float) ($host->rateCategory?->rate_per_hour ?? 0);

                return [
                    'host_id' => $host->id,
                    'name' => $host->user->name,
                    'session_count' => $count,
                    'hours' => $hours,
                    'rate_per_hour' => $rate,
                    'amount' => round($hours * $rate),
                    'estimate' => true,
                ];
            })
            ->sortBy('name')
            ->values();
    }

    /**
     * What the brand is invoiced: worked + carried in, capped at the target; the rest carries out.
     *
     * @param  Collection<int, array>  $totals
     */
    public function summary(PaymentPeriod $period, Collection $totals): array
    {
        if ($period->isLocked()) {
            return [
                'worked_hours' => $period->worked_hours,
                'carried_in_hours' => $period->carried_in_hours,
                'achieved_hours' => $period->achieved_hours,
                'carried_out_hours' => $period->carried_out_hours,
                'target_hours' => $period->target_hours,
                'total_amount' => round($totals->sum('amount')),
            ];
        }

        $worked = round($totals->sum('hours'), 2);
        $available = $worked + $period->carried_in_hours;

        return [
            'worked_hours' => $worked,
            'carried_in_hours' => $period->carried_in_hours,
            'achieved_hours' => round(min($available, $period->target_hours), 2),
            'carried_out_hours' => round(max(0, $available - $period->target_hours), 2),
            'target_hours' => $period->target_hours,
            'total_amount' => round($totals->sum('amount')),
        ];
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

            $totals = $this->hostTotals($period);
            $summary = $this->summary($period, $totals);

            $period->items()->delete();
            foreach ($totals as $row) {
                $period->items()->create([
                    'host_id' => $row['host_id'],
                    'session_count' => $row['session_count'],
                    'hours' => $row['hours'],
                    'rate_per_hour' => $row['rate_per_hour'],
                    'amount' => $row['amount'],
                ]);
            }

            $period->update([
                'worked_hours' => $summary['worked_hours'],
                'achieved_hours' => $summary['achieved_hours'],
                'carried_out_hours' => $summary['carried_out_hours'],
                'status' => 'requested',
                'locked_at' => now(),
            ]);

            $next = $this->periodFor($period->brand, CarbonImmutable::parse($period->period_end->toDateString())->addDay());
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

    private function nextPeriod(PaymentPeriod $period): ?PaymentPeriod
    {
        return PaymentPeriod::where('brand_id', $period->brand_id)
            ->whereDate('period_start', CarbonImmutable::parse($period->period_end->toDateString())->addDay())
            ->first();
    }

    /**
     * The brand paid: close the period and create a salary slip per host (kasbon deducted).
     *
     * @return Collection<int, SalarySlip>
     */
    public function markPaid(PaymentPeriod $period): Collection
    {
        return DB::transaction(function () use ($period) {
            $period = PaymentPeriod::lockForUpdate()->findOrFail($period->id);

            if ($period->status !== 'requested') {
                $this->fail($period->status === 'paid' ? 'Periode ini sudah lunas.' : 'Ajukan pembayaran dulu.');
            }

            $period->paymentRequest?->update(['status' => 'paid', 'paid_at' => now()]);
            $period->update(['status' => 'paid']);

            return $period->items()->get()->map(function ($item) use ($period) {
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
                    'Gaji bersih Rp '.number_format($slip->net_amount, 0, ',', '.')." untuk {$period->period_start->translatedFormat('j M')} – {$period->period_end->translatedFormat('j M Y')}.",
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
     * Record a kasbon and split it into equal installments (the last one takes the rounding).
     */
    public function recordAdvance(HostProfile $host, array $attributes, User $by): CashAdvance
    {
        return DB::transaction(function () use ($host, $attributes, $by) {
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
            'hours' => $item?->hours ?? 0,
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
        $summary = $this->summary($period, $this->hostTotals($period));

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

    private function fail(string $message): never
    {
        throw ValidationException::withMessages(['period' => [$message]]);
    }
}
