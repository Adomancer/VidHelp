<?php

namespace App\Services;

use App\Models\Brand;
use App\Models\CashAdvance;
use App\Models\CashAdvanceInstallment;
use App\Models\HourAdjustment;
use App\Models\PaymentPeriod;
use App\Models\SalarySlip;
use App\Models\User;
use App\Models\WorkSession;
use App\Services\Excel\Column;
use App\Services\Excel\ExcelReport;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * Payroll as Excel: one brand period for the brand (hours only, no pay), and the finance
 * report for any date range (sessions, pay, slips and kasbon).
 */
class PayrollReport
{
    public const PERIOD_STATUS = [
        'in_progress' => 'Berjalan',
        'waiting_payment' => 'Siap ditagihkan',
        'requested' => 'Menunggu brand',
        'paid' => 'Lunas',
    ];

    private const PERIOD_TONES = ['Berjalan' => 'blue', 'Siap ditagihkan' => 'amber', 'Menunggu brand' => 'violet', 'Lunas' => 'green'];

    private const SESSION_TYPES = [
        'regular' => 'Reguler',
        'backup' => 'Backup',
        'event' => 'Event',
        'double' => 'Double',
        'disrupted' => 'Terganggu',
        'adjustment' => 'Penyesuaian',
    ];

    private const ADVANCE_TYPES = ['early_payment' => 'Gaji di muka', 'loan' => 'Pinjaman'];

    private const ADVANCE_STATUS = ['unpaid' => 'Belum dicicil', 'in_progress' => 'Dicicil', 'paid' => 'Lunas'];

    public function __construct(private PayrollService $payroll) {}

    /**
     * One brand period, for billing the brand: totals, hours per host, every session and the
     * adjustments. Hours only: no rates or pay (brand leaders download it too).
     */
    public function period(PaymentPeriod $period, User $by): BinaryFileResponse
    {
        $period->loadMissing('brand');
        ['hosts' => $hosts, 'summary' => $summary] = $this->payroll->breakdown($period);
        $sessions = WorkSession::where('payment_period_id', $period->id)->with('host.user')->orderBy('start_at')->get();
        $adjustments = $period->adjustments()->with(['host.user', 'creator:id,name'])->oldest()->get();
        $range = $this->day($period->period_start).' – '.($period->period_end ? $this->day($period->period_end) : 'berjalan');

        $report = new ExcelReport("Laporan Periode {$period->brand->name}", "Periode {$range}", $by->name);

        $report->sheet('Ringkasan', 'Ringkasan periode')
            ->pairs('Periode', [
                ['Brand', $period->brand->name],
                ['Mulai', $period->period_start, 'date'],
                ['Selesai', $period->period_end, 'date'],
                ['Status', self::PERIOD_STATUS[$period->status] ?? $period->status],
                ['Sesi live', $sessions->count(), 'number'],
                ['Host yang live', $sessions->pluck('host_id')->unique()->count(), 'number'],
            ])
            ->pairs('Jam', [
                ['Target jam', $summary['target_hours'], 'hours'],
                ['Jam kerja periode ini', $summary['worked_hours'], 'hours'],
                ['Bawaan dari periode lalu', $summary['carried_in_hours'], 'hours'],
                ['Jam yang ditagihkan', $summary['achieved_hours'], 'hours'],
                ['Dibawa ke periode berikutnya', $summary['carried_out_hours'], 'hours'],
                ['Dibayar host sendiri (backup)', $summary['host_paid_hours'], 'hours'],
            ])
            ->table(
                [
                    Column::text('Host', 26),
                    Column::number('Sesi', 9),
                    Column::hours('Bawaan masuk', 13),
                    Column::hours('Jam kerja', 12),
                    Column::hours('Jam ditagihkan', 14),
                    Column::hours('Dibawa keluar', 13),
                ],
                $hosts->map(fn (array $host) => [
                    $host['name'], $host['session_count'], $host['carried_in_hours'], $host['worked_hours'], $host['hours'], $host['carried_out_hours'],
                ]),
                heading: 'Jam per host',
                totals: true,
            );

        $report->sheet('Sesi Live', "Semua sesi periode {$range}")->table(
            [
                Column::date('Tanggal'),
                Column::text('Hari', 10),
                Column::text('Host', 24),
                Column::text('Mulai', 9),
                Column::text('Selesai', 9),
                Column::hours('Durasi', 12),
                Column::text('Jenis', 13),
                Column::text('Catatan', 34, wrap: true),
            ],
            $sessions->map(fn (WorkSession $session) => [
                $session->session_date,
                $session->session_date->locale('id')->translatedFormat('l'),
                $session->host->user->name,
                $session->start_at->format('H:i'),
                $session->end_at->format('H:i'),
                $session->duration_hours,
                self::SESSION_TYPES[$session->session_type] ?? $session->session_type,
                $session->notes,
            ]),
            totals: true,
            empty: 'Belum ada sesi di periode ini.',
        );

        $report->sheet('Penyesuaian', 'Tambahan atau potongan jam')->table(
            [
                Column::text('Host', 24),
                Column::number('Sesi', 9),
                Column::hours('Jam', 10),
                Column::text('Catatan', 40, wrap: true),
                Column::text('Dicatat oleh', 18),
                Column::datetime('Dicatat pada'),
            ],
            $adjustments->map(fn (HourAdjustment $adjustment) => [
                $adjustment->host->user->name,
                $adjustment->sessions_added,
                $adjustment->hours_added,
                $adjustment->notes,
                $adjustment->creator?->name,
                $adjustment->created_at,
            ]),
            totals: true,
            empty: 'Tidak ada penyesuaian jam.',
        );

        return $report->download(str($period->brand->name)->slug().'-'.$period->period_start->toDateString().'.xlsx');
    }

    /**
     * Finance report for `[from, to]` (null = no bound): what was worked, paid and lent.
     * Sessions and kasbon count by their own date; slips by the day they were made (paid);
     * periods when they overlap the range.
     */
    public function range(?CarbonInterface $from, ?CarbonInterface $to, ?Brand $brand, User $by, string $label): BinaryFileResponse
    {
        $from = $from ? CarbonImmutable::parse($from)->startOfDay() : null;
        $to = $to ? CarbonImmutable::parse($to)->endOfDay() : null;
        $within = fn (?CarbonInterface $date) => $date && (! $from || $date->gte($from)) && (! $to || $date->lte($to));

        $sessions = WorkSession::query()
            ->with(['host.user:id,name', 'brand:id,name', 'period:id,period_start,period_end'])
            ->when($brand, fn ($q) => $q->where('brand_id', $brand->id))
            ->when($from, fn ($q) => $q->whereDate('session_date', '>=', $from->toDateString()))
            ->when($to, fn ($q) => $q->whereDate('session_date', '<=', $to->toDateString()))
            ->orderBy('start_at')
            ->get();

        $slips = SalarySlip::query()
            ->with(['host.user:id,name', 'period.brand:id,name'])
            ->when($brand, fn ($q) => $q->whereHas('period', fn ($q) => $q->where('brand_id', $brand->id)))
            ->when($from, fn ($q) => $q->where('generated_at', '>=', $from))
            ->when($to, fn ($q) => $q->where('generated_at', '<=', $to))
            ->orderBy('generated_at')
            ->get();

        $periods = PaymentPeriod::query()
            ->with(['brand:id,name', 'paymentRequest', 'items'])
            ->when($brand, fn ($q) => $q->where('brand_id', $brand->id))
            ->when($to, fn ($q) => $q->whereDate('period_start', '<=', $to->toDateString()))
            ->when($from, fn ($q) => $q->where(fn ($q) => $q->whereNull('period_end')->orWhereDate('period_end', '>=', $from->toDateString())))
            ->orderBy('period_start')
            ->get();

        $advances = CashAdvance::query()
            ->with(['host.user:id,name', 'brand:id,name', 'installments', 'recorder:id,name'])
            ->when($brand, fn ($q) => $q->where('brand_id', $brand->id))
            ->get();
        $newAdvances = $advances->filter(fn (CashAdvance $advance) => $within($advance->requested_at))->sortBy('requested_at')->values();

        $deductions = CashAdvanceInstallment::query()
            ->with(['advance.host.user:id,name', 'advance.settler:id,name', 'slip.period.brand:id,name'])
            ->whereIn('status', ['deducted', 'settled'])
            ->when($brand, fn ($q) => $q->whereHas('advance', fn ($q) => $q->where('brand_id', $brand->id)))
            ->get()
            ->map(fn (CashAdvanceInstallment $installment) => [$installment, $installment->deducted_at ?? $installment->advance->settled_at])
            ->filter(fn (array $pair) => $within($pair[1]))
            ->sortBy(fn (array $pair) => $pair[1])
            ->values();

        $outstanding = fn (CashAdvance $advance) => $advance->installments->where('status', 'scheduled')->sum('amount');
        $report = new ExcelReport('Laporan Keuangan', "{$label} · ".($brand ? "Brand {$brand->name}" : 'Semua brand'), $by->name);

        // Summary: the totals, then one line per brand
        $brandRows = $sessions->groupBy('brand_id')->keys()
            ->merge($slips->pluck('period.brand_id'))->unique()->filter()
            ->map(function (string $brandId) use ($sessions, $slips) {
                $brandSessions = $sessions->where('brand_id', $brandId);
                $brandSlips = $slips->where('period.brand_id', $brandId);

                return [
                    $brandSessions->first()?->brand->name ?? $brandSlips->first()->period->brand->name,
                    $brandSessions->count(),
                    round($brandSessions->sum('duration_hours'), 2),
                    $brandSlips->count(),
                    $brandSlips->sum('gross_amount'),
                    $brandSlips->sum('advance_deduction'),
                    $brandSlips->sum('net_amount'),
                ];
            })
            ->sortBy(0)->values();

        $report->sheet('Ringkasan', 'Ringkasan keuangan')
            ->pairs('Aktivitas live', [
                ['Sesi live', $sessions->count(), 'number'],
                ['Total jam kerja', round($sessions->sum('duration_hours'), 2), 'hours'],
                ['Host yang live', $sessions->pluck('host_id')->unique()->count(), 'number'],
            ])
            ->pairs('Pembayaran gaji (slip terbit di rentang ini)', [
                ['Slip gaji', $slips->count(), 'number'],
                ['Gaji kotor', $slips->sum('gross_amount'), 'rupiah'],
                ['Potongan kasbon', $slips->sum('advance_deduction'), 'rupiah'],
                ['Gaji bersih dibayar', $slips->sum('net_amount'), 'rupiah'],
            ])
            ->pairs('Kasbon', [
                ['Kasbon baru', $newAdvances->count(), 'number'],
                ['Nilai kasbon baru', $newAdvances->sum('total_amount'), 'rupiah'],
                ['Cicilan masuk (dipotong atau dilunasi)', $deductions->sum(fn (array $pair) => $pair[0]->amount), 'rupiah'],
                ['Sisa kasbon berjalan (hari ini)', $advances->sum($outstanding), 'rupiah'],
            ])
            ->table(
                [
                    Column::text('Brand', 26),
                    Column::number('Sesi', 9),
                    Column::hours('Jam kerja', 12),
                    Column::number('Slip', 8),
                    Column::rupiah('Gaji kotor'),
                    Column::rupiah('Potongan kasbon'),
                    Column::rupiah('Gaji bersih'),
                ],
                $brandRows,
                heading: 'Per brand',
                totals: true,
            );

        // One line per host: what they worked and were paid in the range, and what they still owe
        $hostIds = $sessions->pluck('host_id')->merge($slips->pluck('host_id'))->merge($newAdvances->pluck('host_id'))->unique();
        $names = $sessions->pluck('host.user.name', 'host_id')
            ->union($slips->pluck('host.user.name', 'host_id'))
            ->union($advances->pluck('host.user.name', 'host_id'));
        $report->sheet('Rekap Host', 'Per host dalam rentang ini')->table(
            [
                Column::text('Host', 24),
                Column::text('Brand', 24, wrap: true),
                Column::number('Sesi', 8),
                Column::hours('Jam kerja', 11),
                Column::number('Slip', 7),
                Column::rupiah('Gaji kotor', 16),
                Column::rupiah('Potongan kasbon', 16),
                Column::rupiah('Gaji bersih', 16),
                Column::rupiah('Kasbon baru', 15),
                Column::rupiah('Sisa kasbon', 15),
            ],
            $hostIds->map(fn (string $hostId) => [
                $names[$hostId] ?? '-',
                $sessions->where('host_id', $hostId)->pluck('brand.name')
                    ->merge($slips->where('host_id', $hostId)->pluck('period.brand.name'))->unique()->sort()->implode(', '),
                $sessions->where('host_id', $hostId)->count(),
                round($sessions->where('host_id', $hostId)->sum('duration_hours'), 2),
                $slips->where('host_id', $hostId)->count(),
                $slips->where('host_id', $hostId)->sum('gross_amount'),
                $slips->where('host_id', $hostId)->sum('advance_deduction'),
                $slips->where('host_id', $hostId)->sum('net_amount'),
                $newAdvances->where('host_id', $hostId)->sum('total_amount'),
                $advances->where('host_id', $hostId)->sum($outstanding),
            ])->sortBy(0)->values(),
            totals: true,
        );

        $report->sheet('Sesi Live', 'Semua sesi live yang disetujui')->table(
            [
                Column::date('Tanggal'),
                Column::text('Hari', 10),
                Column::text('Host', 22),
                Column::text('Brand', 18),
                Column::text('Mulai', 8),
                Column::text('Selesai', 8),
                Column::hours('Durasi', 11),
                Column::text('Jenis', 12),
                Column::text('Periode', 22),
                Column::text('Catatan', 30, wrap: true),
            ],
            $sessions->map(fn (WorkSession $session) => [
                $session->session_date,
                $session->session_date->locale('id')->translatedFormat('l'),
                $session->host->user->name,
                $session->brand->name,
                $session->start_at->format('H:i'),
                $session->end_at->format('H:i'),
                $session->duration_hours,
                self::SESSION_TYPES[$session->session_type] ?? $session->session_type,
                $session->period ? $this->periodLabel($session->period) : 'Belum masuk periode',
                $session->notes,
            ]),
            totals: true,
            empty: 'Tidak ada sesi live di rentang ini.',
        );

        $report->sheet('Periode', 'Periode pembayaran yang bersinggungan dengan rentang ini')->table(
            [
                Column::text('Brand', 20),
                Column::date('Mulai'),
                Column::date('Selesai'),
                Column::status('Status', self::PERIOD_TONES, 15),
                Column::hours('Target jam', 11, summed: false),
                Column::hours('Jam kerja', 11),
                Column::hours('Ditagihkan', 11),
                Column::hours('Bawaan masuk', 12),
                Column::hours('Dibawa keluar', 12),
                Column::rupiah('Total gaji', 16),
                Column::datetime('Diajukan'),
                Column::datetime('Lunas'),
                Column::text('Referensi bayar', 18),
            ],
            $periods->map(function (PaymentPeriod $period) {
                $request = $period->paymentRequest;
                $total = $period->isLocked() ? $period->items->sum('amount') : $this->payroll->breakdown($period)['summary']['total_amount'];

                return [
                    $period->brand->name,
                    $period->period_start,
                    $period->period_end,
                    self::PERIOD_STATUS[$period->status] ?? $period->status,
                    $period->target_hours,
                    $period->worked_hours,
                    $period->achieved_hours,
                    $period->carried_in_hours,
                    $period->carried_out_hours,
                    $total,
                    $request?->requested_at,
                    $request?->paid_at,
                    $request?->payment_reference,
                ];
            }),
            totals: true,
            empty: 'Tidak ada periode pembayaran di rentang ini.',
        )->note('Total gaji periode yang belum diajukan adalah perkiraan dengan tarif host saat ini; setelah diajukan, jam dan tarif dikunci.');

        $report->sheet('Slip Gaji', 'Slip gaji yang terbit (lunas) di rentang ini')->table(
            [
                Column::datetime('Terbit'),
                Column::text('Host', 22),
                Column::text('Brand', 18),
                Column::text('Periode', 22),
                Column::rupiah('Gaji kotor', 16),
                Column::rupiah('Potongan kasbon', 16),
                Column::rupiah('Gaji bersih', 16),
                Column::number('Cicilan dilewati', 12),
            ],
            $slips->map(fn (SalarySlip $slip) => [
                $slip->generated_at,
                $slip->host->user->name,
                $slip->period->brand->name,
                $this->periodLabel($slip->period),
                $slip->gross_amount,
                $slip->advance_deduction,
                $slip->net_amount,
                count($slip->skipped_deductions ?? []),
            ]),
            totals: true,
            empty: 'Tidak ada slip gaji di rentang ini.',
        );

        $report->sheet('Kasbon', 'Kasbon yang dicatat di rentang ini')->table(
            [
                Column::date('Tanggal'),
                Column::text('Host', 22),
                Column::text('Brand', 18),
                Column::text('Jenis', 14),
                Column::rupiah('Jumlah', 16),
                Column::number('Cicilan', 9, summed: false),
                Column::number('Terbayar', 9, summed: false),
                Column::rupiah('Sisa', 16),
                Column::status('Status', ['Belum dicicil' => 'amber', 'Dicicil' => 'blue', 'Lunas' => 'green'], 14),
                Column::text('Catatan', 28, wrap: true),
                Column::text('Dicatat oleh', 16),
            ],
            $newAdvances->map(fn (CashAdvance $advance) => [
                $advance->requested_at,
                $advance->host->user->name,
                $advance->brand?->name,
                self::ADVANCE_TYPES[$advance->type] ?? $advance->type,
                $advance->total_amount,
                $advance->installment_count,
                $advance->installments->where('status', '!=', 'scheduled')->count(),
                $outstanding($advance),
                self::ADVANCE_STATUS[$advance->status] ?? $advance->status,
                $advance->notes,
                $advance->recorder?->name,
            ]),
            totals: true,
            empty: 'Tidak ada kasbon baru di rentang ini.',
        );

        $report->sheet('Cicilan Kasbon', 'Cicilan yang masuk di rentang ini')->table(
            [
                Column::datetime('Tanggal'),
                Column::text('Host', 22),
                Column::text('Cicilan ke-', 11),
                Column::rupiah('Jumlah', 16),
                Column::status('Cara', ['Dipotong dari gaji' => 'blue', 'Dilunasi langsung' => 'green'], 18),
                Column::text('Slip / keterangan', 30, wrap: true),
            ],
            $deductions->map(fn (array $pair) => [
                $pair[1],
                $pair[0]->advance->host->user->name,
                "{$pair[0]->seq} dari {$pair[0]->advance->installment_count}",
                $pair[0]->amount,
                $pair[0]->status === 'settled' ? 'Dilunasi langsung' : 'Dipotong dari gaji',
                $pair[0]->slip
                    ? "{$pair[0]->slip->period->brand->name} · ".$this->periodLabel($pair[0]->slip->period)
                    : collect([$pair[0]->advance->settler?->name ? "oleh {$pair[0]->advance->settler->name}" : null, $pair[0]->advance->settled_note])->filter()->implode(' · '),
            ]),
            totals: true,
            empty: 'Tidak ada cicilan kasbon di rentang ini.',
        );

        $suffix = $from || $to ? ($from?->toDateString() ?? 'awal').'_'.($to?->toDateString() ?? 'sekarang') : 'semua';

        return $report->download("laporan-keuangan-{$suffix}.xlsx");
    }

    /** "1 Okt – 7 Okt 2026" */
    private function periodLabel(PaymentPeriod $period): string
    {
        return $period->period_start->locale('id')->translatedFormat('j M').' – '.($period->period_end ? $this->day($period->period_end) : 'berjalan');
    }

    private function day(CarbonInterface $date): string
    {
        return $date->locale('id')->translatedFormat('j M Y');
    }
}
