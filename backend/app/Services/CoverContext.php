<?php

namespace App\Services;

use App\Models\BackupQuota;
use App\Models\HostBrandAssignment;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;

/**
 * What BackupService::coverReason() needs for many hosts and requests, loaded once
 * (BackupService::coverContext) instead of a handful of queries per host and request.
 */
final class CoverContext
{
    /**
     * @param  Collection<string, Collection<int, HostBrandAssignment>>  $assignments  by host id
     * @param  Collection<string, BackupQuota>  $quotas  by "host id|month"
     * @param  Collection<string, Collection<int, array{start: CarbonImmutable, end: CarbonImmutable, reason: string}>>  $intervals  by host id
     * @param  Collection<string, true>  $rejected  "request id|host id" of applications an admin turned down
     */
    public function __construct(
        private readonly Collection $assignments,
        private readonly Collection $quotas,
        private readonly Collection $intervals,
        private readonly Collection $rejected,
    ) {}

    public function hasAssignment(string $hostId, string $brandId, string $status): bool
    {
        return $this->assignments->get($hostId, collect())
            ->contains(fn (HostBrandAssignment $assignment) => $assignment->brand_id === $brandId && $assignment->status === $status);
    }

    /** The host's quota for a month: saved, or an unsaved default like BackupQuota::peek(). */
    public function quota(string $hostId, string $monthYear): BackupQuota
    {
        return $this->quotas->get("{$hostId}|{$monthYear}") ?? new BackupQuota([
            'host_id' => $hostId,
            'month_year' => $monthYear,
            'quota_used' => 0,
            'quota_max' => config('vidhelp.backup.quota_per_month'),
        ]);
    }

    /** What keeps the host busy, leaving out the request being checked (they may be its cover). */
    public function intervalsOf(string $hostId, ?string $exceptBackupId): Collection
    {
        return $this->intervals->get($hostId, collect())
            ->reject(fn (array $interval) => $exceptBackupId !== null && ($interval['backup_id'] ?? null) === $exceptBackupId)
            ->values();
    }

    public function wasRejected(?string $requestId, string $hostId): bool
    {
        return $requestId !== null && $this->rejected->has("{$requestId}|{$hostId}");
    }
}
