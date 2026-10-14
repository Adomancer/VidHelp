<?php

namespace App\Http\Controllers\Operator;

use App\Http\Controllers\Controller;
use App\Models\BrandComplaint;
use App\Models\HostProfile;
use App\Models\PointBalance;
use App\Models\PointLog;
use App\Models\ViolationType;
use App\Models\WarningLetter;
use App\Services\Excel\Column;
use App\Services\Excel\ExcelReport;
use App\Services\PointService;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class PointController extends Controller
{
    public function __construct(private PointService $points)
    {
    }

    /**
     * The current points period as an Excel report: summary, every host's balance and SP level,
     * the point history, the SP letters, and the violation types with their points.
     */
    public function export(Request $request): BinaryFileResponse
    {
        [$start, $end] = $this->points->periodFor(today());
        $opening = (int) config('vidhelp.points.starting_points');
        $thresholds = config('vidhelp.points.sp_thresholds');
        $range = CarbonImmutable::parse($start)->locale('id')->translatedFormat('j M Y').' – '.CarbonImmutable::parse($end)->locale('id')->translatedFormat('j M Y');

        $balances = PointBalance::whereDate('period_start', $start)->pluck('current_points', 'host_id');
        $logs = PointLog::query()
            ->whereDate('period_start', $start)
            ->with(['host.user:id,name', 'violationType:id,name', 'recorder:id,name', 'voider:id,name', 'brandComplaint.brand:id,name'])
            ->orderBy('occurred_on')
            ->oldest()
            ->get();
        $letters = WarningLetter::query()
            ->whereDate('period_start', $start)
            ->with(['host.user:id,name', 'issuer:id,name'])
            ->orderBy('issued_at')
            ->get();
        $counted = $logs->whereNull('voided_at');
        $levels = $letters->whereNull('voided_at')->groupBy('host_id')->map(fn ($group) => $group->max('level'));

        $hosts = HostProfile::query()
            ->where('status', 'active')
            ->whereHas('user', fn ($q) => $q->where('status', 'active'))
            ->with('user')
            ->get()
            ->map(fn (HostProfile $host) => [
                'name' => $host->user->name,
                'email' => $host->user->email,
                'points' => (int) ($balances[$host->id] ?? $opening),
                'level' => (int) ($levels[$host->id] ?? 0),
                'deductions' => $counted->where('host_id', $host->id)->where('points_change', '<', 0)->count(),
                'deducted' => abs($counted->where('host_id', $host->id)->where('points_change', '<', 0)->sum('points_change')),
            ])
            ->sortBy([['points', 'asc'], ['name', 'asc']])
            ->values();

        $spLabel = fn (int $level) => $level > 0 ? "SP{$level}" : 'Aman';
        $spTones = ['Aman' => 'green', 'SP1' => 'amber', 'SP2' => 'red', 'SP3' => 'red'];
        $report = new ExcelReport('Laporan Poin & SP', "Periode poin {$range} · mulai {$opening} poin", $request->user()?->name);

        $report->sheet('Ringkasan', 'Ringkasan poin')
            ->pairs('Periode ini', [
                ['Host aktif', $hosts->count(), 'number'],
                ['Rata-rata poin', $hosts->isEmpty() ? null : round($hosts->avg('points'), 1), 'decimal'],
                ['Poin terendah', $hosts->min('points'), 'number'],
                ['Catatan poin', $counted->count(), 'number'],
                ['Total poin dipotong', abs($counted->where('points_change', '<', 0)->sum('points_change')), 'number'],
                ['SP terbit', $letters->whereNull('voided_at')->count(), 'number'],
            ])
            ->table(
                [Column::text('Status SP', 20), Column::text('Batas poin', 22), Column::number('Jumlah host', 14)],
                collect([0 => null, ...$thresholds])->map(fn ($limit, $level) => [
                    $spLabel($level),
                    $level === 0 ? 'di atas '.$thresholds[1] : "{$limit} atau kurang",
                    $hosts->where('level', $level)->count(),
                ])->values(),
                heading: 'Sebaran status SP',
                totals: true,
            )
            ->table(
                [Column::text('Jenis', 36), Column::number('Kejadian', 12), Column::number('Poin dipotong', 14)],
                $counted->groupBy(fn (PointLog $log) => $log->label())
                    ->map(fn ($group, $label) => [$label, $group->count(), abs($group->sum('points_change'))])
                    ->sortByDesc(1)->values(),
                heading: 'Pelanggaran per jenis',
                totals: true,
            );

        $report->sheet('Saldo Poin', 'Saldo poin per host, terendah dulu')->table(
            [
                Column::number('No', 6, summed: false),
                Column::text('Host', 26),
                Column::text('Email', 28),
                Column::number('Poin', 9, summed: false),
                Column::status('Status SP', $spTones, 12),
                Column::number('Jumlah potongan', 14),
                Column::number('Poin dipotong', 14),
            ],
            $hosts->map(fn (array $host, int $i) => [
                $i + 1, $host['name'], $host['email'], $host['points'], $spLabel($host['level']), $host['deductions'], $host['deducted'],
            ]),
            totals: true,
        );

        $report->sheet('Riwayat Poin', 'Semua catatan poin periode ini')->table(
            [
                Column::date('Tanggal'),
                Column::text('Host', 24),
                Column::text('Jenis', 30),
                Column::number('Poin', 9),
                Column::text('Alasan', 36, wrap: true),
                Column::text('Dicatat oleh', 18),
                Column::status('Status', ['Berlaku' => 'green', 'Dibatalkan' => 'gray'], 13),
                Column::text('Dibatalkan oleh', 18),
            ],
            $logs->map(fn (PointLog $log) => [
                $log->occurred_on,
                $log->host->user->name,
                $log->label(),
                $log->points_change,
                $log->reason,
                $log->recorder?->name ?? 'Otomatis',
                $log->voided_at ? 'Dibatalkan' : 'Berlaku',
                $log->voider?->name,
            ]),
            totals: true,
            empty: 'Belum ada catatan poin di periode ini.',
        );

        $report->sheet('Surat Peringatan', 'SP periode ini')->table(
            [
                Column::datetime('Terbit'),
                Column::text('Host', 24),
                Column::status('Level', $spTones, 9),
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
            empty: 'Belum ada SP di periode ini.',
        );

        $report->sheet('Jenis Pelanggaran', 'Daftar jenis pelanggaran')->table(
            [
                Column::text('Jenis', 34),
                Column::number('Poin dipotong', 14, summed: false),
                Column::decimal('Dampak rating', 14),
                Column::status('Status', ['Aktif' => 'green', 'Nonaktif' => 'gray'], 12),
                Column::text('Diterapkan', 22),
            ],
            ViolationType::orderBy('name')->get()->map(fn (ViolationType $type) => [
                $type->name,
                $type->default_points,
                $type->rating_impact,
                $type->is_active ? 'Aktif' : 'Nonaktif',
                $type->code ? 'Manual & otomatis' : 'Manual',
            ]),
        );

        return $report->download('poin-sp-'.CarbonImmutable::parse($start)->toDateString().'.xlsx');
    }

    /**
     * Every active host's points in the current period, lowest first.
     */
    public function index(Request $request): JsonResponse
    {
        [$start, $end] = $this->points->periodFor(today());
        $opening = (int) config('vidhelp.points.starting_points');

        $balances = PointBalance::whereDate('period_start', $start)->pluck('current_points', 'host_id');
        $levels = WarningLetter::counting()->whereDate('period_start', $start)
            ->selectRaw('host_id, max(level) as level')->groupBy('host_id')->pluck('level', 'host_id');
        $deductions = PointLog::counting()->whereDate('period_start', $start)->where('points_change', '<', 0)
            ->selectRaw('host_id, count(*) as total')->groupBy('host_id')->pluck('total', 'host_id');

        $hosts = HostProfile::query()
            ->where('status', 'active')
            ->whereHas('user', fn ($q) => $q->where('status', 'active'))
            ->when($request->search, fn ($q, $search) => $q->whereHas('user', fn ($q) => $q
                ->where('name', 'like', "%{$search}%")
                ->orWhere('email', 'like', "%{$search}%")))
            ->with('user')
            ->get()
            ->map(fn (HostProfile $host) => [
                'host_id' => $host->id,
                'name' => $host->user->name,
                'email' => $host->user->email,
                'avatar_url' => $host->user->avatar_url,
                'points' => $balances[$host->id] ?? $opening,
                'sp_level' => (int) ($levels[$host->id] ?? 0),
                'deductions' => (int) ($deductions[$host->id] ?? 0),
            ])
            ->sortBy([['points', 'asc'], ['name', 'asc']])
            ->values();

        return response()->json([
            'period' => ['start' => $start->toDateString(), 'end' => $end->toDateString()],
            'thresholds' => config('vidhelp.points.sp_thresholds'),
            'hosts' => $hosts,
        ]);
    }

    /**
     * One host's points history for a period (`on` = any date inside it; default today).
     */
    public function show(Request $request, HostProfile $host): JsonResponse
    {
        $request->validate(['on' => 'nullable|date']);
        [$start, $end] = $this->points->periodFor($request->date('on') ?? today());
        $opening = (int) config('vidhelp.points.starting_points');

        $balance = PointBalance::where('host_id', $host->id)->whereDate('period_start', $start)->first();

        return response()->json([
            'host' => $host->load('user'),
            'period' => ['start' => $start->toDateString(), 'end' => $end->toDateString()],
            'points' => $balance->current_points ?? $opening,
            'opening_points' => $balance->opening_points ?? $opening,
            'thresholds' => config('vidhelp.points.sp_thresholds'),
            'logs' => PointLog::where('host_id', $host->id)
                ->whereDate('period_start', $start)
                ->with(['violationType:id,name', 'recorder:id,name', 'brandComplaint.brand:id,name'])
                ->latest('occurred_on')
                ->latest()
                ->get(),
            'warning_letters' => $host->warningLetters()->with('issuer:id,name')->latest('issued_at')->get(),
            'ratings' => $host->ratings()->orderByDesc('month_year')->limit(12)->get(),
        ]);
    }

    /** Active violation types for the "record a violation" form. */
    public function violationTypes(): JsonResponse
    {
        return response()->json([
            'violation_types' => ViolationType::where('is_active', true)->orderBy('name')->get(),
        ]);
    }

    /**
     * Record a violation. `points` overrides the type's default deduction.
     */
    public function storeViolation(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'host_id' => 'required|exists:host_profiles,id',
            'violation_type_id' => ['required', Rule::exists('violation_types', 'id')->where('is_active', true)],
            'points' => 'nullable|integer|min:1|max:100',
            'reason' => 'nullable|string|max:255',
            'occurred_on' => 'nullable|date|before_or_equal:today',
        ]);

        $log = $this->points->deduct(
            HostProfile::findOrFail($validated['host_id']),
            ViolationType::findOrFail($validated['violation_type_id']),
            'internal',
            $validated['reason'] ?? null,
            $request->user(),
            $validated['points'] ?? null,
            ['occurred_on' => $validated['occurred_on'] ?? today()->toDateString()],
        );

        return $this->recorded($log, 'Pelanggaran dicatat');
    }

    /**
     * Record a brand complaint; it deducts the "brand complaint" type's points
     * (or `points`) unless an admin switched that type off.
     */
    public function storeComplaint(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'host_id' => 'required|exists:host_profiles,id',
            'brand_id' => 'required|exists:brands,id',
            'description' => 'required|string|max:2000',
            'points' => 'nullable|integer|min:1|max:100',
            'occurred_on' => 'nullable|date|before_or_equal:today',
        ]);

        $host = HostProfile::findOrFail($validated['host_id']);
        $complaint = BrandComplaint::create([
            'host_id' => $host->id,
            'brand_id' => $validated['brand_id'],
            'description' => $validated['description'],
            'recorded_by' => $request->user()->id,
        ]);

        $type = ViolationType::forCode(ViolationType::BRAND_COMPLAINT);
        if (! $type) {
            return response()->json([
                'complaint' => $complaint,
                'message' => 'Komplain dicatat (penalti komplain brand sedang dimatikan).',
            ], 201);
        }

        $log = $this->points->deduct(
            $host,
            $type,
            'brand_complaint',
            $validated['description'],
            $request->user(),
            $validated['points'] ?? null,
            ['brand_complaint_id' => $complaint->id, 'occurred_on' => $validated['occurred_on'] ?? today()->toDateString()],
        );

        return $this->recorded($log, 'Komplain dicatat');
    }

    private function recorded(PointLog $log, string $message): JsonResponse
    {
        $letter = WarningLetter::where('point_log_id', $log->id)->first();
        $points = PointBalance::where('host_id', $log->host_id)->whereDate('period_start', $log->period_start)->value('current_points');

        return response()->json([
            'log' => $log,
            'points' => $points,
            'warning_letter' => $letter,
            'message' => $letter
                ? "{$message}. Poin sekarang {$points}: SP{$letter->level} terbit otomatis."
                : "{$message}. Poin sekarang {$points}.",
        ], 201);
    }
}
