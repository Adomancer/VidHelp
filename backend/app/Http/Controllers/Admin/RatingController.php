<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\HostProfile;
use App\Models\HostRating;
use App\Models\PointLog;
use App\Services\RatingService;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RatingController extends Controller
{
    public function __construct(private RatingService $ratings)
    {
    }

    /**
     * Every active host for a month (default this month): suggestion, violations, current rating.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate(['month' => 'nullable|date_format:Y-m']);
        $month = $request->month ?? now()->format('Y-m');
        $first = CarbonImmutable::parse("{$month}-01");

        $ratings = HostRating::where('month_year', $month)->with('rater:id,name')->get()->keyBy('host_id');
        $violations = PointLog::counting()
            ->whereNotNull('violation_type_id')
            ->whereBetween('occurred_on', [$first->toDateString(), $first->endOfMonth()->toDateString()])
            ->selectRaw('host_id, count(*) as total')->groupBy('host_id')->pluck('total', 'host_id');

        $hosts = HostProfile::query()
            ->where('status', 'active')
            ->whereHas('user', fn ($q) => $q->where('status', 'active'))
            ->with('user')
            ->get()
            ->map(fn (HostProfile $host) => [
                'host_id' => $host->id,
                'name' => $host->user->name,
                'avatar_url' => $host->user->avatar_url,
                'violations' => (int) ($violations[$host->id] ?? 0),
                'suggested' => $this->ratings->suggested($host, $month),
                'rating' => $ratings->get($host->id),
            ])
            ->sortBy('name')
            ->values();

        return response()->json(['month' => $month, 'scale' => config('vidhelp.rating'), 'hosts' => $hosts]);
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

        return response()->json(['rating' => $rating, 'message' => 'Rating saved']);
    }
}
