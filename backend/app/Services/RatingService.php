<?php

namespace App\Services;

use App\Models\HostProfile;
use App\Models\HostRating;
use App\Models\PointLog;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

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

    /**
     * Give every active host without a rating for the month their suggestion (with `$brandId`,
     * only the hosts active on that brand; with `$withoutDeductionsOnly`, only those whose
     * violations took nothing off, i.e. the suggestion is the top of the scale). Ratings already
     * given stay as they are. Returns how many hosts were rated.
     */
    public function rateUnratedWithSuggestion(string $monthYear, User $by, ?string $brandId = null, bool $withoutDeductionsOnly = false): int
    {
        $rated = HostRating::where('month_year', $monthYear)->select('host_id');

        return DB::transaction(fn () => HostProfile::query()
            ->where('status', 'active')
            ->whereHas('user', fn ($q) => $q->where('status', 'active'))
            ->when($brandId, fn ($q) => $q->whereHas('assignments', fn ($q) => $q->where('brand_id', $brandId)->where('status', 'active')))
            ->whereNotIn('id', $rated)
            ->get()
            ->map(fn (HostProfile $host) => [$host, $this->suggested($host, $monthYear)])
            ->filter(fn (array $pair) => ! $withoutDeductionsOnly || $pair[1] >= config('vidhelp.rating.max'))
            ->each(fn (array $pair) => $this->rate($pair[0], $monthYear, $pair[1], null, $by))
            ->count());
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
