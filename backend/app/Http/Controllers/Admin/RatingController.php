<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\HostProfile;
use App\Models\HostRating;
use App\Models\PointLog;
use App\Models\WarningLetter;
use App\Services\Excel\Column;
use App\Services\Excel\ExcelReport;
use App\Services\RatingService;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class RatingController extends Controller
{
    /** How many months of a host's ratings the review shows, up to the month being rated. */
    private const RECENT_MONTHS = 6;

    public function __construct(private RatingService $ratings) {}

    /**
     * Every active host for a month (default this month): suggestion, violations, current rating,
     * and the active brands they live for (the page groups hosts by brand).
     */
    public function index(Request $request): JsonResponse
    {
        $month = $this->month($request);

        return response()->json(['month' => $month, 'scale' => config('vidhelp.rating'), 'hosts' => $this->rows($month)]);
    }

    /**
     * What a host's rating for the month rests on: the month's violations with their rating impact
     * (together they make the suggestion) and the host's ratings of the months up to it, newest first.
     */
    public function show(Request $request, HostProfile $host): JsonResponse
    {
        $month = $this->month($request);
        $first = CarbonImmutable::parse("{$month}-01");

        return response()->json([
            'violations' => PointLog::counting()
                ->where('host_id', $host->id)
                ->whereNotNull('violation_type_id')
                ->whereBetween('occurred_on', [$first->toDateString(), $first->endOfMonth()->toDateString()])
                ->with('violationType:id,name,rating_impact')
                ->orderBy('occurred_on')
                ->get()
                ->map(fn (PointLog $log) => [
                    'id' => $log->id,
                    'name' => $log->violationType->name,
                    'rating_impact' => $log->violationType->rating_impact,
                    'points' => $log->points_change,
                    'occurred_on' => $log->occurred_on->toDateString(),
                    'reason' => $log->reason,
                ]),
            'ratings' => $host->ratings()
                ->where('month_year', '<=', $month)
                ->orderByDesc('month_year')
                ->limit(self::RECENT_MONTHS)
                ->get()
                ->map(fn (HostRating $rating) => $rating->only('month_year', 'rating')),
        ]);
    }

    /**
     * Give every host not rated for the month yet their suggested rating (5 minus the month's violations);
     * with `brand_id`, only that brand's hosts.
     */
    public function applySuggested(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'month_year' => 'required|date_format:Y-m',
            'brand_id' => 'nullable|exists:brands,id',
            'without_deductions' => 'nullable|boolean',
        ]);

        $count = $this->ratings->rateUnratedWithSuggestion(
            $validated['month_year'],
            $request->user(),
            $validated['brand_id'] ?? null,
            (bool) ($validated['without_deductions'] ?? false),
        );

        return response()->json([
            'rated' => $count,
            'message' => $count > 0 ? "{$count} host diberi rating saran" : 'Semua host sudah dinilai',
        ]);
    }

    /**
     * The month as an Excel report: summary, every host's rating, and that month's point
     * history and SP letters.
     */
    public function export(Request $request): BinaryFileResponse
    {
        $month = $this->month($request);
        $first = CarbonImmutable::parse("{$month}-01");
        $monthName = $first->locale('id')->translatedFormat('F Y');
        $rows = $this->rows($month);

        $logs = PointLog::query()
            ->whereBetween('occurred_on', [$first->toDateString(), $first->endOfMonth()->toDateString()])
            ->with(['host.user:id,name', 'violationType:id,name', 'recorder:id,name', 'brandComplaint.brand:id,name'])
            ->orderBy('occurred_on')
            ->oldest()
            ->get();
        $letters = WarningLetter::query()
            ->whereBetween('issued_at', [$first->startOfDay(), $first->endOfMonth()->endOfDay()])
            ->with(['host.user:id,name', 'issuer:id,name'])
            ->orderBy('issued_at')
            ->get();
        $counted = $logs->whereNull('voided_at');
        $rated = $rows->filter(fn (array $row) => $row['rating'] !== null);
        $scale = config('vidhelp.rating');

        $report = new ExcelReport('Laporan Rating Host', "Bulan {$monthName} · skala {$scale['min']}–{$scale['max']}", $request->user()?->name);

        $report->sheet('Ringkasan', 'Ringkasan rating')
            ->pairs('Penilaian bulan ini', [
                ['Host aktif', $rows->count(), 'number'],
                ['Sudah dinilai', $rated->count(), 'number'],
                ['Belum dinilai', $rows->count() - $rated->count(), 'number'],
                ['Rata-rata rating', $rated->isEmpty() ? null : round($rated->avg(fn (array $row) => (float) $row['rating']->rating), 2), 'decimal'],
                ['Rata-rata rating saran', $rows->isEmpty() ? null : round($rows->avg('suggested'), 2), 'decimal'],
            ])
            ->pairs('Pelanggaran & SP', [
                ['Catatan poin', $counted->count(), 'number'],
                ['Total poin dipotong', abs($counted->where('points_change', '<', 0)->sum('points_change')), 'number'],
                ['Catatan dibatalkan', $logs->whereNotNull('voided_at')->count(), 'number'],
                ['Surat peringatan terbit', $letters->whereNull('voided_at')->count(), 'number'],
            ])
            ->table(
                [Column::text('Jenis', 36), Column::number('Kejadian', 12), Column::number('Poin dipotong', 14)],
                $counted->groupBy(fn (PointLog $log) => $log->label())
                    ->map(fn ($group, $label) => [$label, $group->count(), abs($group->sum('points_change'))])
                    ->sortByDesc(1)->values(),
                heading: 'Pelanggaran per jenis',
                totals: true,
            );

        $report->sheet('Rating', 'Rating per host')->table(
            [
                Column::number('No', 6, summed: false),
                Column::text('Host', 26),
                Column::number('Pelanggaran', 12),
                Column::decimal('Rating saran', 12),
                Column::decimal('Rating', 10),
                Column::status('Status', ['Sudah dinilai' => 'green', 'Belum dinilai' => 'amber'], 15),
                Column::text('Catatan', 34, wrap: true),
                Column::text('Dinilai oleh', 18),
            ],
            $rows->map(fn (array $row, int $i) => [
                $i + 1,
                $row['name'],
                $row['violations'],
                $row['suggested'],
                $row['rating']?->rating,
                $row['rating'] ? 'Sudah dinilai' : 'Belum dinilai',
                $row['rating']?->note,
                $row['rating']?->rater?->name,
            ]),
            totals: true,
        );

        $report->sheet('Riwayat Poin', 'Catatan poin bulan ini')->table(
            [
                Column::date('Tanggal'),
                Column::text('Host', 24),
                Column::text('Jenis', 30),
                Column::number('Poin', 9),
                Column::text('Alasan', 36, wrap: true),
                Column::text('Dicatat oleh', 18),
                Column::status('Status', ['Berlaku' => 'green', 'Dibatalkan' => 'gray'], 13),
            ],
            $logs->map(fn (PointLog $log) => [
                $log->occurred_on,
                $log->host->user->name,
                $log->label(),
                $log->points_change,
                $log->reason,
                $log->recorder?->name ?? 'Otomatis',
                $log->voided_at ? 'Dibatalkan' : 'Berlaku',
            ]),
            totals: true,
            empty: 'Tidak ada catatan poin di bulan ini.',
        );

        $report->sheet('Surat Peringatan', 'SP yang terbit bulan ini')->table(
            [
                Column::datetime('Terbit'),
                Column::text('Host', 24),
                Column::status('Level', ['SP1' => 'amber', 'SP2' => 'red', 'SP3' => 'red'], 9),
                Column::text('Alasan', 40, wrap: true),
                Column::text('Diterbitkan oleh', 18),
                Column::status('Status', ['Berlaku' => 'green', 'Dibatalkan' => 'gray'], 13),
            ],
            $letters->map(fn (WarningLetter $letter) => [
                $letter->issued_at,
                $letter->host->user->name,
                "SP{$letter->level}",
                $letter->reason,
                $letter->issuer?->name ?? 'Otomatis',
                $letter->voided_at ? 'Dibatalkan' : 'Berlaku',
            ]),
            empty: 'Tidak ada SP di bulan ini.',
        );

        return $report->download("ratings-{$month}.xlsx");
    }

    /**
     * One host's full point and SP history across all periods, newest first.
     */
    public function history(HostProfile $host): JsonResponse
    {
        return response()->json([
            'logs' => $host->pointLogs()
                ->with(['violationType:id,name', 'recorder:id,name', 'brandComplaint.brand:id,name'])
                ->latest('occurred_on')
                ->latest()
                ->get(),
            'warning_letters' => $host->warningLetters()->with('issuer:id,name')->latest('issued_at')->get(),
        ]);
    }

    public function upsert(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'host_id' => 'required|exists:host_profiles,id',
            'month_year' => 'required|date_format:Y-m',
            'rating' => 'required|numeric|min:'.config('vidhelp.rating.min').'|max:'.config('vidhelp.rating.max'),
            'note' => 'nullable|string|max:255',
        ]);

        $rating = $this->ratings->rate(
            HostProfile::findOrFail($validated['host_id']),
            $validated['month_year'],
            (float) $validated['rating'],
            $validated['note'] ?? null,
            $request->user(),
        );

        return response()->json(['rating' => $rating, 'message' => 'Rating disimpan']);
    }

    private function month(Request $request): string
    {
        $request->validate(['month' => 'nullable|date_format:Y-m']);

        return $request->month ?? now()->format('Y-m');
    }

    private function rows(string $month): Collection
    {
        $first = CarbonImmutable::parse("{$month}-01");

        $ratings = HostRating::where('month_year', $month)->with('rater:id,name')->get()->keyBy('host_id');
        $violations = PointLog::counting()
            ->whereNotNull('violation_type_id')
            ->whereBetween('occurred_on', [$first->toDateString(), $first->endOfMonth()->toDateString()])
            ->selectRaw('host_id, count(*) as total')->groupBy('host_id')->pluck('total', 'host_id');

        $hosts = HostProfile::query()
            ->where('status', 'active')
            ->whereHas('user', fn ($q) => $q->where('status', 'active'))
            ->with(['user', 'assignments' => fn ($q) => $q->where('status', 'active')
                ->whereHas('brand', fn ($q) => $q->where('status', 'active'))
                ->with('brand:id,name')])
            ->get();
        $suggestions = $this->ratings->suggestions($hosts->pluck('id')->all(), $month);

        return $hosts
            ->map(fn (HostProfile $host) => [
                'host_id' => $host->id,
                'name' => $host->user->name,
                'avatar_url' => $host->user->avatar_url,
                'brands' => $host->assignments->map(fn ($assignment) => $assignment->brand->only('id', 'name'))->sortBy('name')->values(),
                'violations' => (int) ($violations[$host->id] ?? 0),
                'suggested' => $suggestions[$host->id],
                'rating' => $ratings->get($host->id),
            ])
            ->sortBy('name')
            ->values();
    }
}
