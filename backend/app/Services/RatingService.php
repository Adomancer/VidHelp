<?php

namespace App\Services;

use App\Models\HostProfile;
use App\Models\HostRating;
use App\Models\PointLog;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
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
        return $this->suggestions([$host->id], $monthYear)->get($host->id);
    }

    /**
     * The suggestion for several hosts in one query, by host id.
     *
     * @param  list<string>  $hostIds
     * @return Collection<string, float>
     */
    public function suggestions(array $hostIds, string $monthYear): Collection
    {
        $month = CarbonImmutable::parse("{$monthYear}-01");

        $impacts = $hostIds === [] ? collect() : PointLog::counting()
            ->join('violation_types', 'violation_types.id', '=', 'point_logs.violation_type_id')
            ->whereIn('point_logs.host_id', $hostIds)
            ->whereBetween('point_logs.occurred_on', [$month->toDateString(), $month->endOfMonth()->toDateString()])
            ->groupBy('point_logs.host_id')
            ->selectRaw('point_logs.host_id, sum(violation_types.rating_impact) as impact')
            ->pluck('impact', 'host_id');

        return collect($hostIds)->mapWithKeys(fn (string $id) => [
            $id => round(max(config('vidhelp.rating.min'), config('vidhelp.rating.max') - (float) ($impacts[$id] ?? 0)), 1),
        ]);
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

        return DB::transaction(function () use ($rated, $brandId, $monthYear, $withoutDeductionsOnly, $by) {
            $hosts = HostProfile::query()
                ->where('status', 'active')
                ->whereHas('user', fn ($q) => $q->where('status', 'active'))
                ->when($brandId, fn ($q) => $q->whereHas('assignments', fn ($q) => $q->where('brand_id', $brandId)->where('status', 'active')))
                ->whereNotIn('id', $rated)
                ->get();
            $suggestions = $this->suggestions($hosts->pluck('id')->all(), $monthYear);

            return $hosts
                ->filter(fn (HostProfile $host) => ! $withoutDeductionsOnly || $suggestions[$host->id] >= config('vidhelp.rating.max'))
                ->each(fn (HostProfile $host) => $this->rate($host, $monthYear, $suggestions[$host->id], null, $by, suggested: $suggestions[$host->id]))
                ->count();
        });
    }

    /** `$suggested` when it was worked out already (rating many hosts at once). */
    public function rate(HostProfile $host, string $monthYear, float $rating, ?string $note, User $by, ?float $suggested = null): HostRating
    {
        return HostRating::updateOrCreate(
            ['host_id' => $host->id, 'month_year' => $monthYear],
            [
                'rating' => round($rating, 1),
                'suggested_rating' => $suggested ?? $this->suggested($host, $monthYear),
                'note' => $note,
                'rated_by' => $by->id,
            ]
        );
    }
}
