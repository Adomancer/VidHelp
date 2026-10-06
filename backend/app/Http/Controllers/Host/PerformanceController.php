<?php

namespace App\Http\Controllers\Host;

use App\Http\Controllers\Controller;
use App\Models\PointBalance;
use App\Models\PointLog;
use App\Services\PointService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PerformanceController extends Controller
{
    public function __construct(private PointService $points)
    {
    }

    /**
     * My points this period (and what was deducted), my SPs and my monthly ratings.
     */
    public function index(Request $request): JsonResponse
    {
        $host = $request->user()->hostProfile ?? abort(404, 'Kamu tidak punya profil host.');
        [$start, $end] = $this->points->periodFor(today());
        $opening = (int) config('vidhelp.points.starting_points');
        $balance = PointBalance::where('host_id', $host->id)->whereDate('period_start', $start)->first();

        return response()->json([
            'period' => ['start' => $start->toDateString(), 'end' => $end->toDateString()],
            'points' => $balance->current_points ?? $opening,
            'opening_points' => $balance->opening_points ?? $opening,
            'thresholds' => config('vidhelp.points.sp_thresholds'),
            'logs' => PointLog::counting()
                ->where('host_id', $host->id)
                ->whereDate('period_start', $start)
                ->with('violationType:id,name')
                ->latest('occurred_on')
                ->get(['id', 'violation_type_id', 'source', 'points_change', 'reason', 'occurred_on']),
            'warning_letters' => $host->warningLetters()->counting()->latest('issued_at')
                ->get(['id', 'level', 'reason', 'issued_at', 'period_start']),
            'ratings' => $host->ratings()->orderByDesc('month_year')->limit(12)
                ->get(['id', 'month_year', 'rating', 'note']),
        ]);
    }
}
