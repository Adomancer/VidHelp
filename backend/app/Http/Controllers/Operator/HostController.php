<?php

namespace App\Http\Controllers\Operator;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Brand;
use App\Models\HostBrandAssignment;
use App\Models\HostProfile;
use App\Models\User;
use App\Services\Excel\Column;
use App\Services\Excel\ExcelReport;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class HostController extends Controller
{
    /**
     * Hosts with their rate level and brand assignments. No KTP/bank data.
     */
    public function index(Request $request): JsonResponse
    {
        return response()->json($this->filtered($request)->paginate(20));
    }

    private const STATUS = ['active' => 'Aktif', 'inactive' => 'Nonaktif', 'archived' => 'Diarsipkan', 'banned' => 'Diblokir'];

    private const STATUS_TONES = ['Aktif' => 'green', 'Nonaktif' => 'amber', 'Diarsipkan' => 'gray', 'Diblokir' => 'red'];

    /**
     * The same list (same filters, every page) as an Excel report: a summary (status, brands,
     * rate levels) and the full host list. No KTP/bank data; guardians' numbers (someone else's
     * personal data) only for admins. Every export is written to the audit log.
     */
    public function export(Request $request): BinaryFileResponse
    {
        $hosts = $this->filtered($request)->with('rateCategory')->get();
        $withGuardians = $request->user()->hasAnyRole(['admin', 'finance']);
        $brand = $request->brand_id ? Brand::find($request->brand_id) : null;
        $filters = collect([
            $brand ? "Brand {$brand->name}" : 'Semua brand',
            ...array_map(fn ($term) => "cari \"{$term}\"", array_filter((array) $request->input('search', []), 'strlen')),
            $request->input('host_ids') ? count($request->input('host_ids')).' host dipilih' : null,
        ])->filter()->implode(' · ');

        $report = new ExcelReport('Laporan Data Host', $filters, $request->user()?->name);
        $activeOn = fn (HostProfile $host) => $host->assignments->where('status', 'active');

        $report->sheet('Ringkasan', 'Ringkasan host')
            ->pairs('Jumlah host', [
                ['Total host', $hosts->count(), 'number'],
                ...collect(self::STATUS)->map(fn ($label, $status) => [$label, $hosts->where('status', $status)->count(), 'number'])->values()->all(),
                ['Rata-rata masa kerja (bulan)', round($hosts->avg(fn (HostProfile $host) => $host->tenureMonths()) ?? 0, 1), 'decimal'],
            ])
            ->table(
                [Column::text('Brand', 30), Column::number('Host aktif', 14), Column::text('Leader', 24)],
                $hosts->flatMap($activeOn)->groupBy('brand_id')
                    ->map(fn ($assignments) => [
                        $assignments->first()->brand->name,
                        $assignments->count(),
                        $hosts->firstWhere('id', $assignments->firstWhere('is_leader', true)?->host_id)?->user->name,
                    ])
                    ->sortBy(0)->values(),
                heading: 'Host per brand',
                totals: true,
            )
            ->table(
                [Column::text('Level tarif', 30), Column::rupiah('Tarif per jam', 18, summed: false), Column::number('Jumlah host', 14)],
                $hosts->groupBy(fn (HostProfile $host) => $host->rateCategory?->name ?? 'Belum ada level')
                    ->map(fn ($group, $name) => [$name, $group->first()->rateCategory?->rate_per_hour, $group->count()])
                    ->sortBy(1)->values(),
                heading: 'Host per level tarif',
                totals: true,
            );

        $report->sheet('Daftar Host', 'Semua host sesuai filter')->table(
            [
                Column::number('No', 6, summed: false),
                Column::text('Nama', 24),
                Column::text('Email', 28),
                Column::text('No. HP', 16),
                ...($withGuardians ? [Column::text('No. HP wali', 16)] : []),
                Column::status('Status', self::STATUS_TONES, 13),
                Column::text('Level tarif', 16),
                Column::rupiah('Tarif per jam', 16, summed: false),
                Column::date('Tanggal bergabung', 15),
                Column::number('Masa kerja (bulan)', 12, summed: false),
                Column::text('Brand aktif', 30, wrap: true),
                Column::text('Leader di', 20, wrap: true),
            ],
            $hosts->values()->map(fn (HostProfile $host, int $i) => [
                $i + 1,
                $host->user->name,
                $host->user->email,
                $host->phone,
                ...($withGuardians ? [$host->guardian_phone] : []),
                self::STATUS[$host->status] ?? $host->status,
                $host->rateCategory?->name.($host->rate_category_overridden ? ' (manual)' : ''),
                $host->rateCategory?->rate_per_hour,
                $host->join_date,
                $host->tenureMonths(),
                $activeOn($host)->map(fn (HostBrandAssignment $assignment) => $assignment->brand->name)->sort()->implode(', '),
                $activeOn($host)->where('is_leader', true)->map(fn (HostBrandAssignment $assignment) => $assignment->brand->name)->implode(', '),
            ]),
            totals: false,
        );

        AuditLog::record('hosts_exported', new: ['filters' => $filters, 'count' => $hosts->count(), 'guardian_phones' => $withGuardians]);

        return $report->download('hosts-'.today()->toDateString().'.xlsx');
    }

    /**
     * `search` (one text or several) and `host_ids`: hosts matching any of them.
     */
    private function filtered(Request $request): Builder
    {
        $request->validate([
            'search' => 'nullable',
            'search.*' => 'nullable|string|max:100',
            'host_ids' => 'nullable|array|max:100',
            'host_ids.*' => 'uuid',
        ]);

        $terms = array_values(array_filter(array_map('trim', (array) $request->input('search', [])), 'strlen'));
        $hostIds = $request->input('host_ids', []);

        return HostProfile::query()
            ->with(['user', 'rateCategory:id,name', 'assignments.brand:id,name'])
            ->when($terms || $hostIds, fn ($q) => $q->where(function ($q) use ($terms, $hostIds) {
                if ($hostIds) {
                    $q->orWhereIn('id', $hostIds);
                }
                foreach ($terms as $term) {
                    $q->orWhereHas('user', fn ($q) => $q
                        ->where('name', 'like', "%{$term}%")
                        ->orWhere('email', 'like', "%{$term}%"));
                }
            }))
            ->when($request->brand_id, fn ($q, $brandId) => $q->whereHas('assignments', fn ($q) => $q
                ->where('brand_id', $brandId)
                ->where('status', 'active')))
            ->when($request->status, fn ($q, $status) => $q->where('status', $status))
            ->orderBy(
                User::select('name')->whereColumn('users.id', 'host_profiles.user_id')
            );
    }
}
