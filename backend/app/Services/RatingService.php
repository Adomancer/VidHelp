<?php

namespace App\Services;

use App\Models\HostProfile;
use App\Models\HostRating;
use App\Models\PointLog;
use App\Models\User;
use Carbon\CarbonImmutable;

/**
 * Monthly host ratings (1.0-5.0) given by admins, with a suggestion from the month's violations.
 */
class RatingService
{
    /**
     * Max rating minus the rating impact of the month's (non-cancelled) violations.
     */
    public function suggested(HostProfile $host, string $monthYear): float
    {
        $month = CarbonImmutable::parse("{$monthYear}-01");

        $impact = (float) PointLog::counting()
            ->join('violation_types', 'violation_types.id', '=', 'point_logs.violation_type_id')
            ->where('point_logs.host_id', $host->id)
            ->whereBetween('point_logs.occurred_on', [$month->toDateString(), $month->endOfMonth()->toDateString()])
            ->sum('violation_types.rating_impact');

        return round(max(config('vidhelp.rating.min'), config('vidhelp.rating.max') - $impact), 1);
    }

    public function rate(HostProfile $host, string $monthYear, float $rating, ?string $note, User $by): HostRating
    {
        return HostRating::updateOrCreate(
            ['host_id' => $host->id, 'month_year' => $monthYear],
            [
                'rating' => round($rating, 1),
                'suggested_rating' => $this->suggested($host, $monthYear),
                'note' => $note,
                'rated_by' => $by->id,
            ]
        );
    }
}
