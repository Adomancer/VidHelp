<?php

namespace App\Services;

use App\Models\HostProfile;
use App\Models\HostRateCategory;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

/**
 * Rate levels seen from the hosts: who moves up a level soon, and who is placed by hand.
 */
class RateLevelService
{
    /**
     * Active hosts placed by tenure whose tenure reaches a higher level within `$days` (the nightly
     * re-placement moves them that day), soonest first.
     *
     * @return Collection<int, array{host_id: string, name: string, avatar_url: ?string, on: string, from: ?array{id: string, name: string, rate_per_hour: string}, to: array{id: string, name: string, rate_per_hour: string}}>
     */
    public function upcomingPromotions(int $days): Collection
    {
        $levels = HostRateCategory::orderBy('min_tenure_months')->get();
        $until = CarbonImmutable::today()->addDays($days);

        return $this->activeHosts()
            ->where('rate_category_overridden', false)
            ->get()
            ->map(function (HostProfile $host) use ($levels, $until) {
                $next = $levels->first(fn (HostRateCategory $level) => $level->min_tenure_months > $host->tenureMonths());
                $on = $next ? CarbonImmutable::parse($host->join_date)->addMonthsNoOverflow($next->min_tenure_months) : null;

                return $on && $on->lte($until) ? [
                    'host_id' => $host->id,
                    'name' => $host->user->name,
                    'avatar_url' => $host->user->avatar_url,
                    'on' => $on->toDateString(),
                    'from' => $host->rateCategory?->only('id', 'name', 'rate_per_hour'),
                    'to' => $next->only('id', 'name', 'rate_per_hour'),
                ] : null;
            })
            ->filter()
            ->sortBy('on')
            ->values();
    }

    /**
     * Active hosts whose level an admin set by hand (tenure doesn't move them), by name.
     *
     * @return Collection<int, array{host_id: string, name: string, avatar_url: ?string, level: ?array{id: string, name: string}}>
     */
    public function pinned(): Collection
    {
        return $this->activeHosts()
            ->where('rate_category_overridden', true)
            ->get()
            ->map(fn (HostProfile $host) => [
                'host_id' => $host->id,
                'name' => $host->user->name,
                'avatar_url' => $host->user->avatar_url,
                'level' => $host->rateCategory?->only('id', 'name'),
            ])
            ->sortBy('name')
            ->values();
    }

    /** @return Builder<HostProfile> */
    private function activeHosts(): Builder
    {
        return HostProfile::query()
            ->where('status', 'active')
            ->whereHas('user', fn ($q) => $q->where('status', 'active'))
            ->with(['user', 'rateCategory']);
    }
}
