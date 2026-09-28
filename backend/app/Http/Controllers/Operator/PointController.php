<?php

namespace App\Http\Controllers\Operator;

use App\Http\Controllers\Controller;
use App\Models\BrandComplaint;
use App\Models\HostProfile;
use App\Models\PointBalance;
use App\Models\PointLog;
use App\Models\ViolationType;
use App\Models\WarningLetter;
use App\Services\PointService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class PointController extends Controller
{
    public function __construct(private PointService $points)
    {
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

        return $this->recorded($log, 'Violation recorded');
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
                'message' => 'Complaint recorded (the brand complaint penalty is switched off).',
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

        return $this->recorded($log, 'Complaint recorded');
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
                ? "{$message}. Points are now {$points}: SP{$letter->level} was issued automatically."
                : "{$message}. Points are now {$points}.",
        ], 201);
    }
}
