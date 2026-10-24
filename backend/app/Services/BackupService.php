<?php

namespace App\Services;

use App\Models\BackupApplication;
use App\Models\BackupQuota;
use App\Models\BackupRequest;
use App\Models\HostProfile;
use App\Models\ScheduleSlot;
use App\Models\User;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Backup rules: opening a request (to everyone or to named hosts), who may cover it,
 * the admin's decision on applicants, dropping out, and the automatic pick when the
 * admin doesn't decide in time.
 */
class BackupService
{
    public function __construct(
        private PointService $points,
        private HostCalendar $calendar,
        private EventCalendar $events,
        private Notifier $notifier,
    ) {}

    /**
     * The (unsaved) request for one occurrence of a slot, after checking that occurrence exists.
     */
    public function draft(ScheduleSlot $slot, string $date): BackupRequest
    {
        $day = CarbonImmutable::parse($date)->startOfDay();

        if (! $slot->runsOn($day)) {
            throw ValidationException::withMessages(['backup_date' => ['Slot itu tidak terjadwal di tanggal ini.']]);
        }
        if ($event = $this->events->replacing($slot->assignment->brand_id, $day)) {
            throw ValidationException::withMessages(['backup_date' => ["Di hari itu jadwal reguler diganti oleh {$event->name}."]]);
        }

        [$start, $end] = $slot->occurrenceOn($day);

        if ($end->isPast()) {
            throw ValidationException::withMessages(['backup_date' => ['Slot itu sudah selesai.']]);
        }

        return new BackupRequest([
            'slot_id' => $slot->id,
            'brand_id' => $slot->assignment->brand_id,
            'requesting_host_id' => $slot->assignment->host_id,
            'backup_date' => $day->toDateString(),
            'start_at' => $start,
            'end_at' => $end,
            'auto_fill_at' => $start->subMinutes(config('vidhelp.backup.auto_fill_before_minutes')),
        ]);
    }

    /**
     * Open a request for a host's slot on a date. It goes straight to the backup board
     * (open to everyone, or only to `$nomineeIds` when given). Hosts must ask at least
     * request_min_hours_before ahead; staff (`$byStaff`) may open one any time (emergencies).
     *
     * `$announce` = false when staff pick the cover straight away (nobody needs to apply).
     *
     * @param  array{reason_type: string, reason: ?string}  $reason
     * @param  list<string>  $nomineeIds
     */
    public function create(ScheduleSlot $slot, string $date, array $reason, User $by, bool $byStaff, array $nomineeIds = [], ?UploadedFile $letter = null, bool $announce = true): BackupRequest
    {
        $backup = $this->draft($slot, $date);

        $minHours = config('vidhelp.backup.request_min_hours_before');
        if (! $byStaff && $backup->start_at->lt(now()->addHours($minHours))) {
            throw ValidationException::withMessages(['backup_date' => [
                "Backup harus diajukan paling lambat {$minHours} jam sebelum sesi dimulai. Kalau mendadak tidak bisa, hubungi admin.",
            ]]);
        }

        $this->ensureNoActiveRequest($slot, $backup);
        $nominees = $this->checkNominees($backup, $nomineeIds);

        $backup->fill([
            ...$reason,
            'request_type' => $nominees->isEmpty() ? 'open' : 'direct',
            'created_by' => $by->id,
            'status' => 'open',
        ]);

        // Stored before the transaction and removed again if it rolls back, so no letter is left without its request
        $letterPath = $letter?->store('backup-letters', 'local');
        try {
            DB::transaction(function () use ($slot, $backup, $nominees, $letter, $letterPath, $by) {
                // One active request per slot and date: two sent at once wait here, and the second sees the first
                ScheduleSlot::whereKey($slot->id)->lockForUpdate()->first();
                $this->ensureNoActiveRequest($slot, $backup);

                $backup->save();
                $nominees->each(fn (HostProfile $host) => $backup->nominees()->create(['nominee_host_id' => $host->id]));

                if ($letter) {
                    $this->recordLetter($backup, $letter, $letterPath, $by);
                }
            });
        } catch (Throwable $e) {
            if ($letterPath) {
                Storage::disk('local')->delete($letterPath);
            }
            throw $e;
        }

        if ($announce) {
            $this->announceOpen($backup);
        }

        return $backup;
    }

    /**
     * The hosts a direct request names: between direct_min_hosts and direct_max_hosts,
     * each able to cover it right now.
     *
     * @param  list<string>  $ids
     * @return Collection<int, HostProfile>
     */
    private function checkNominees(BackupRequest $backup, array $ids): Collection
    {
        if ($ids === []) {
            return collect();
        }

        $ids = array_values(array_unique($ids));
        [$min, $max] = [config('vidhelp.backup.direct_min_hosts'), config('vidhelp.backup.direct_max_hosts')];
        if (count($ids) < $min || count($ids) > $max) {
            throw ValidationException::withMessages(['host_ids' => ["Pilih antara {$min} sampai {$max} host."]]);
        }

        $hosts = HostProfile::with('user')->whereIn('id', $ids)->get();
        if ($hosts->count() !== count($ids)) {
            throw ValidationException::withMessages(['host_ids' => ['Salah satu host yang dipilih tidak ditemukan.']]);
        }

        foreach ($hosts as $host) {
            if ($reason = $this->coverReason($host, $backup)) {
                throw ValidationException::withMessages(['host_ids' => ["{$host->user->name} tidak bisa menggantikan: {$reason}"]]);
            }
        }

        return $hosts;
    }

    private function ensureNoActiveRequest(ScheduleSlot $slot, BackupRequest $backup): void
    {
        $duplicate = BackupRequest::where('slot_id', $slot->id)
            ->whereDate('backup_date', $backup->backup_date)
            ->whereIn('status', ['pending', 'open', 'filled'])
            ->exists();
        if ($duplicate) {
            throw ValidationException::withMessages(['backup_date' => ['Sudah ada permintaan backup untuk slot ini di tanggal itu.']]);
        }
    }

    /** Store a sick letter (or other proof) for the request; the file is removed again if saving it fails. */
    public function attachLetter(BackupRequest $backup, UploadedFile $file, User $by): void
    {
        $path = $file->store('backup-letters', 'local');

        try {
            DB::transaction(fn () => $this->recordLetter($backup, $file, $path, $by));
        } catch (Throwable $e) {
            Storage::disk('local')->delete($path);
            throw $e;
        }
    }

    private function recordLetter(BackupRequest $backup, UploadedFile $file, string $path, User $by): void
    {
        $backup->attachments()->create([
            'file_path' => $path,
            'original_name' => $file->getClientOriginalName(),
            'mime_type' => $file->getMimeType(),
            'size_kb' => (int) ceil($file->getSize() / 1024),
            'uploaded_by' => $by->id,
        ]);

        // Whether the letter was on time decides who pays the cover (see BackupRequest::coverPaidBy)
        if (! $backup->letter_uploaded_at) {
            $backup->update(['letter_uploaded_at' => now()]);
        }
    }

    /**
     * Why a host can't apply to this request themselves, or null if they can.
     */
    public function ineligibleReason(HostProfile $host, BackupRequest $request): ?string
    {
        if ($request->request_type === 'direct' && $host->id !== $request->requesting_host_id && ! $request->isNominated($host)) {
            return "Hanya host yang diminta {$request->requester->user->name} yang bisa mengambil ini.";
        }

        // An admin's "no" sticks: no applying again (an admin can still assign them directly)
        if ($request->exists && $request->applications()->where('applicant_host_id', $host->id)->where('status', 'rejected')->exists()) {
            return 'Admin sudah menolak tawaranmu untuk backup ini.';
        }

        return $this->coverReason($host, $request);
    }

    /**
     * Why a host can't cover this request at all (also when an admin assigns them), or null if they can.
     */
    public function coverReason(HostProfile $host, BackupRequest $request): ?string
    {
        if ($host->id === $request->requesting_host_id) {
            return 'Ini permintaanmu sendiri.';
        }

        if ($host->status !== 'active' || $host->user->status !== 'active') {
            return 'Host ini tidak aktif.';
        }

        if ($host->assignments()->where('brand_id', $request->brand_id)->where('status', 'banned')->exists()) {
            return "Diblokir dari {$request->brand->name}.";
        }

        if ($busy = $this->busyReason($host, $request->start_at, $request->end_at, $request)) {
            return $busy;
        }

        if (! $this->isSameBrand($host, $request)) {
            $quota = BackupQuota::peek($host->id, $request->quotaMonth());
            if ($quota->isFull()) {
                return "Kuota backup lintas brand bulan ini sudah habis ({$quota->quota_used}/{$quota->quota_max}).";
            }
        }

        return null;
    }

    /**
     * What keeps the host busy between start and end: their own slot, another cover or an event block.
     */
    public function busyReason(HostProfile $host, CarbonInterface $start, CarbonInterface $end, ?BackupRequest $except = null): ?string
    {
        return $this->calendar->busyReason($host, $start, $end, exceptBackupId: $except?->getKey());
    }

    public function isSameBrand(HostProfile $host, BackupRequest $request): bool
    {
        return $host->assignments()->where('brand_id', $request->brand_id)->where('status', 'active')->exists();
    }

    /**
     * Every active host (but the requester) with whether they could cover the request, eligible ones first.
     *
     * @return Collection<int, array<string, mixed>>
     */
    public function candidates(BackupRequest $request): Collection
    {
        return HostProfile::query()
            ->where('status', 'active')
            ->whereKeyNot($request->requesting_host_id)
            ->whereHas('user', fn ($q) => $q->where('status', 'active'))
            ->with(['user', 'latestRating'])
            ->get()
            ->map(fn (HostProfile $host) => $this->candidate($host, $request))
            ->sortBy([['eligible', 'desc'], ['same_brand', 'desc'], ['name', 'asc']])
            ->values();
    }

    /** One host as a possible cover. */
    public function candidate(HostProfile $host, BackupRequest $request): array
    {
        $reason = $this->coverReason($host, $request);
        $quota = BackupQuota::peek($host->id, $request->quotaMonth());

        return [
            'host_id' => $host->id,
            'name' => $host->user->name,
            'avatar_url' => $host->user->avatar_url,
            'same_brand' => $this->isSameBrand($host, $request),
            'rating' => $host->latestRating?->rating,
            'eligible' => $reason === null,
            'ineligible_reason' => $reason,
            'quota' => $quota->only('quota_used', 'quota_max'),
        ];
    }

    /**
     * A host offers to cover the request. The first applicant moves it to pending
     * (waiting for the admin's decision); others may still apply until the slot starts.
     */
    public function apply(BackupRequest $request, HostProfile $host): void
    {
        $first = DB::transaction(function () use ($request, $host) {
            $request = BackupRequest::lockForUpdate()->findOrFail($request->id);

            if (! $request->isOpenForApplications()) {
                $this->fail('Backup ini sudah tidak dibuka.');
            }
            if ($reason = $this->ineligibleReason($host, $request)) {
                $this->fail($reason);
            }
            if ($other = $this->overlappingApplication($host, $request)) {
                $this->fail("Kamu sudah mendaftar menggantikan di {$other->request->brand->name} pada waktu yang sama. Tarik diri dari yang itu dulu.");
            }

            $request->applications()->updateOrCreate(
                ['applicant_host_id' => $host->id],
                ['status' => 'applied', 'decided_at' => null]
            );

            $first = $request->status === 'open';
            if ($first) {
                $request->update(['status' => 'pending']);
            }

            return $first;
        });

        if ($first) {
            $this->announceApplied($request->fresh(), $host);
        }
    }

    /** The host's own waiting application to another request at an overlapping time. */
    private function overlappingApplication(HostProfile $host, BackupRequest $request): ?BackupApplication
    {
        return BackupApplication::query()
            ->with('request.brand:id,name')
            ->where('applicant_host_id', $host->id)
            ->where('status', 'applied')
            ->whereHas('request', fn ($q) => $q
                ->whereKeyNot($request->id)
                ->whereIn('status', ['open', 'pending'])
                ->where('start_at', '<', $request->end_at)
                ->where('end_at', '>', $request->start_at))
            ->first();
    }

    /** A host takes back their application before the admin decides. */
    public function withdraw(BackupRequest $request, HostProfile $host): void
    {
        DB::transaction(function () use ($request, $host) {
            $updated = $request->applications()
                ->where('applicant_host_id', $host->id)
                ->where('status', 'applied')
                ->update(['status' => 'withdrawn', 'decided_at' => now()]);

            if (! $updated) {
                $this->fail('Kamu tidak punya pendaftaran yang tertunda untuk backup ini.');
            }

            $this->syncWaitingStatus($request);
        });
    }

    /**
     * The admin turns an applicant down. With nobody else waiting, the request is open again.
     */
    public function rejectApplicant(BackupRequest $request, HostProfile $host): void
    {
        $reopened = DB::transaction(function () use ($request, $host) {
            $updated = $request->applications()
                ->where('applicant_host_id', $host->id)
                ->where('status', 'applied')
                ->update(['status' => 'rejected', 'decided_at' => now()]);

            if (! $updated) {
                $this->fail('Host ini tidak punya pendaftaran yang tertunda untuk backup ini.');
            }

            return $this->syncWaitingStatus($request) === 'open';
        });

        $request->loadMissing(['brand', 'requester.user']);
        $host->loadMissing('user');
        $window = "{$request->brand->name} · {$this->window($request)}";

        $this->notifier->toUsers($host->user, $this->notice($request, 'backup_not_picked', "Kamu tidak terpilih menggantikan di {$request->brand->name}")
            ->body("{$window}, untuk {$request->requester->user->name}.")
            ->field('Untuk', $request->requester->user->name)
            ->link('/host/backups', 'Cari backup lain'), dm: true);

        if ($reopened) {
            $this->notifier->toUsers($request->requester->user, $this->notice($request, 'backup_reopened', 'Permintaan backup kamu dibuka lagi')
                ->body("{$window}: pendaftar tidak disetujui. Host lain masih bisa mendaftar.")
                ->field('Pendaftar yang ditolak', $host->user->name)
                ->link('/host/backups', 'Lihat permintaan'), dm: true);
        }
    }

    /**
     * open ⇄ pending, depending on whether anyone is waiting for a decision. Returns the new status.
     */
    private function syncWaitingStatus(BackupRequest $request): string
    {
        $request->refresh();
        if (! in_array($request->status, ['open', 'pending'], true)) {
            return $request->status;
        }

        $waiting = $request->applications()->where('status', 'applied')->exists();
        $request->update(['status' => $waiting ? 'pending' : 'open']);

        return $request->status;
    }

    /**
     * Applicants in pick order: best latest rating first, then same brand, then earliest to apply.
     *
     * @return Collection<int, BackupApplication>
     */
    public function rankedApplicants(BackupRequest $request): Collection
    {
        // Unrated hosts rank below every rated one
        $rating = fn (BackupApplication $application) => $application->applicant->latestRating?->rating ?? -1;

        return $request->applications()
            ->with(['applicant.user', 'applicant.latestRating'])
            ->where('status', 'applied')
            ->get()
            ->sortBy([
                fn (BackupApplication $a, BackupApplication $b) => $rating($b) <=> $rating($a),
                fn (BackupApplication $a, BackupApplication $b) => $this->isSameBrand($b->applicant, $request) <=> $this->isSameBrand($a->applicant, $request),
                fn (BackupApplication $a, BackupApplication $b) => $a->created_at <=> $b->created_at,
            ])
            ->values();
    }

    /**
     * ACC `host` as the cover. They don't need to have applied (admin can assign anyone directly).
     * `$by` = the admin who decided; null when picked automatically.
     */
    public function fill(BackupRequest $request, HostProfile $host, ?User $by = null): BackupRequest
    {
        $filled = DB::transaction(function () use ($request, $host, $by) {
            $request = BackupRequest::lockForUpdate()->findOrFail($request->id);

            if (! in_array($request->status, ['open', 'pending'], true)) {
                throw ValidationException::withMessages(['host_id' => ['Backup ini tidak sedang dibuka.']]);
            }
            if ($reason = $this->coverReason($host, $request)) {
                throw ValidationException::withMessages(['host_id' => [$reason]]);
            }

            $crossBrand = ! $this->isSameBrand($host, $request);
            if ($crossBrand) {
                BackupQuota::for($host->id, $request->quotaMonth())->increment('quota_used');
            }

            $request->applications()->updateOrCreate(
                ['applicant_host_id' => $host->id],
                ['status' => 'approved', 'decided_at' => now()]
            );

            $request->update([
                'status' => 'filled',
                'filled_by_host_id' => $host->id,
                'filled_at' => now(),
                'approved_by' => $by?->id,
                'approved_at' => now(),
                'auto_filled' => $by === null,
                'counts_toward_quota' => $crossBrand,
            ]);

            return $request;
        });

        $this->announceFilled($filled, $host);
        $this->announceNotPicked($filled);

        return $filled;
    }

    /**
     * Undo a fill: the cover's application becomes `$applicationStatus`
     * ("cancelled" = they dropped out → penalty), quota is refunded, request reopens
     * (pending if other applicants are still waiting).
     */
    public function unfill(BackupRequest $request, string $applicationStatus, bool $announce = true): void
    {
        $previousCover = $request->filler;

        DB::transaction(function () use ($request, $applicationStatus) {
            if ($request->counts_toward_quota) {
                BackupQuota::for($request->filled_by_host_id, $request->quotaMonth())->decrement('quota_used');
            }

            $cover = $request->applications()->where('applicant_host_id', $request->filled_by_host_id)->first();
            $cover?->update(['status' => $applicationStatus, 'decided_at' => now()]);

            // The cover dropped out after being picked: point penalty
            if ($cover && $applicationStatus === 'cancelled') {
                $this->points->penalizeBackupDrop($cover);
            }

            $request->update([
                'status' => 'open',
                'filled_by_host_id' => null,
                'filled_at' => null,
                'approved_by' => null,
                'approved_at' => null,
                'auto_filled' => false,
                'counts_toward_quota' => false,
            ]);

            $this->syncWaitingStatus($request);
        });

        if (! $announce) {
            return;
        }

        // Removed by an admin (not dropped): tell the host they are off it
        if ($previousCover && $applicationStatus !== 'cancelled') {
            $this->notifier->toUsers($previousCover->user, $this->notice($request, 'backup_unassigned', "Kamu tidak lagi menggantikan di {$request->brand->name}")
                ->body("{$this->window($request)}: admin mencabut penugasanmu. Kamu libur di sesi ini.")
                ->field('Untuk', $request->requester->user->name)
                ->link('/host/schedule', 'Lihat jadwal'), dm: true);
        }

        $this->announceOpen($request->fresh(), reopened: true);
    }

    /**
     * Close a request (cancelled): release a cover and turn down applicants.
     */
    public function close(BackupRequest $request, string $status): void
    {
        // Who to tell afterwards: the cover (taken off the session) and anyone still waiting
        $cover = $request->status === 'filled' ? $request->filler?->user : null;
        $waiting = $request->applications()->where('status', 'applied')->with('applicant.user')->get()
            ->map(fn (BackupApplication $application) => $application->applicant->user);

        DB::transaction(function () use ($request, $status) {
            if ($request->status === 'filled') {
                $this->unfill($request, 'rejected', announce: false);
            }

            $request->applications()->where('status', 'applied')->update(['status' => 'rejected', 'decided_at' => now()]);
            $request->update(['status' => $status, 'cancelled_at' => $status === 'cancelled' ? now() : null]);
        });

        $request->loadMissing(['brand', 'requester.user']);
        $window = "{$request->brand->name} · {$this->window($request)}";
        $notice = $this->notice($request, 'backup_cancelled', "Backup dibatalkan: {$request->brand->name}")
            ->field('Untuk', $request->requester->user->name)
            ->field('Pengganti', $cover?->name);

        if ($cover) {
            $this->notifier->toUsers($cover, (clone $notice)
                ->body("{$window}: {$request->requester->user->name} tidak lagi butuh pengganti. Kamu libur di sesi ini.")
                ->link('/host/schedule', 'Lihat jadwal'), dm: true);
        }
        if ($waiting->isNotEmpty()) {
            $this->notifier->toUsers($waiting, (clone $notice)
                ->body("{$window}: permintaan dibatalkan, jadi pendaftaranmu ditutup.")
                ->link('/host/backups', 'Cari backup lain'));
        }

        $this->notifier->toChannel('backups', $notice
            ->body("{$window}: {$request->requester->user->name} tidak lagi butuh pengganti.")
            ->link('/host/backups')
            ->mention($cover));
    }

    /**
     * Scheduled every minute: for requests about to start that the admin didn't decide
     * on, ACC the best applicant (auto-ACC); with no eligible applicant, alert the admins once.
     *
     * @return int how many were filled
     */
    public function autoProcess(): int
    {
        $filled = 0;
        $due = BackupRequest::whereIn('status', ['open', 'pending'])
            ->where('auto_fill_at', '<=', now())
            ->where('end_at', '>', now())
            ->get();

        foreach ($due as $request) {
            $picked = false;
            foreach ($this->rankedApplicants($request) as $application) {
                try {
                    $this->fill($request, $application->applicant);
                    $filled++;
                    $picked = true;
                    break;
                } catch (ValidationException) {
                    continue; // e.g. became busy or quota full since applying
                }
            }

            // Nobody (eligible) applied: warn the admins once
            if (! $picked && ! $request->no_cover_alerted_at) {
                $request->update(['no_cover_alerted_at' => now()]);
                $this->announceNoCover($request);
            }
        }

        return $filled;
    }

    /**
     * The request is (again) looking for a cover: every other host may apply, or only
     * the nominees of a direct request (pinged in #backup-needs too).
     */
    public function announceOpen(BackupRequest $request, bool $reopened = false): void
    {
        $request->loadMissing(['brand', 'requester.user']);
        $requester = $request->requester->user;

        if ($request->request_type === 'direct') {
            $request->loadMissing('nominees.host.user');
            $nominees = $request->nominees->map(fn ($nominee) => $nominee->host->user);
            $notice = $this->notice($request, 'backup_asked', "{$requester->name} meminta kamu menggantikan di {$request->brand->name}")
                ->body("{$this->window($request)}. Daftar di tab Backup kalau kamu bisa.")
                ->field('Untuk', $requester->name)
                ->field('Yang diminta', $nominees->pluck('name')->join(', '))
                ->field('Dipilih otomatis', Notice::time($request->auto_fill_at), inline: false)
                ->about($requester)
                ->link('/host/backups', 'Daftar di VidHelp');

            $this->notifier->toUsers($nominees, $notice, dm: true);
            $this->notifier->toChannel('backups', $notice
                ->as('backup_asked', ($reopened ? 'Masih butuh pengganti: ' : 'Minta digantikan: ')."{$requester->name} di {$request->brand->name}")
                ->body("{$this->window($request)}. Hanya host yang diminta yang bisa mendaftar.")
                ->mention($nominees));

            return;
        }

        $notice = $this->notice($request, 'backup_opened', ($reopened ? 'Butuh backup lagi: ' : 'Butuh backup: ').$request->brand->name)
            ->body("{$this->window($request)} · untuk {$requester->name}. Daftar di tab Backup.")
            ->field('Untuk', $requester->name)
            ->field('Dipilih otomatis', Notice::time($request->auto_fill_at), inline: false)
            ->about($requester)
            ->link('/host/backups', 'Daftar di VidHelp');

        $this->notifier->toUsers($this->notifier->hosts(exceptHostId: $request->requesting_host_id), $notice);
        $this->notifier->toChannel('backups', $notice);
    }

    /** Someone applied: the admins decide (or the best applicant is auto-picked before the slot). */
    private function announceApplied(BackupRequest $request, HostProfile $applicant): void
    {
        $request->loadMissing(['brand', 'requester.user']);
        $applicant->loadMissing(['user', 'latestRating']);
        $rating = $applicant->latestRating?->rating;

        $notice = $this->notice($request, 'backup_applied', "{$applicant->user->name} ingin menggantikan {$request->requester->user->name}")
            ->body("{$request->brand->name} · {$this->window($request)}. Setujui atau tolak sebelum {$request->auto_fill_at->translatedFormat('D j M H:i')}, atau pendaftar terbaik dipilih otomatis.")
            ->field('Pendaftar', $applicant->user->name)
            ->field('Menggantikan', $request->requester->user->name)
            ->field('Brand', $this->isSameBrand($applicant, $request) ? 'Brand sendiri' : 'Lintas brand (pakai kuota)')
            ->field('Poin', $this->points->balance($applicant)->current_points)
            ->field('Rating terakhir', $rating !== null ? "{$rating}/".config('vidhelp.rating.max') : 'Belum ada')
            ->field('Putuskan sebelum', Notice::time($request->auto_fill_at), inline: false)
            ->about($applicant->user)
            ->link('/operator/backups', 'Tinjau pendaftar');

        $this->notifier->toUsers($this->notifier->staff(), $notice, dm: true);
        $this->notifier->toChannel('admin', $notice);
    }

    private function announceFilled(BackupRequest $request, HostProfile $cover): void
    {
        $request->loadMissing(['brand', 'requester.user']);
        $cover->loadMissing('user');
        $requester = $request->requester->user;
        $window = "{$request->brand->name} · {$this->window($request)}";
        $pickedBy = $request->auto_filled ? 'Otomatis (tidak ada keputusan sebelum batas waktu)' : 'Admin';

        $this->notifier->toUsers($cover->user, $this->notice($request, 'backup_picked', "Kamu menggantikan di {$request->brand->name}")
            ->body("{$window}, untuk {$requester->name}.")
            ->field('Untuk', $requester->name)
            ->field('Dipilih oleh', $pickedBy)
            ->about($requester)
            ->link('/host/schedule', 'Lihat jadwal'), dm: true);

        $this->notifier->toUsers($requester, $this->notice($request, 'backup_covered', 'Backup kamu sudah ada penggantinya')
            ->body("{$cover->user->name} menggantikan {$window}.")
            ->field('Pengganti', $cover->user->name)
            ->field('Dipilih oleh', $pickedBy)
            ->about($cover->user)
            ->link('/host/backups', 'Lihat backup'), dm: true);

        $this->notifier->toChannel('backups', $this->notice($request, 'backup_filled', "Backup terisi: {$request->brand->name}")
            ->body("{$cover->user->name} menggantikan {$requester->name}.")
            ->field('Pengganti', $cover->user->name)
            ->field('Untuk', $requester->name)
            ->about($cover->user)
            ->mention([$cover->user, $requester])
            ->link('/host/backups'));

        if ($request->auto_filled) {
            $notice = $this->notice($request, 'backup_auto_picked', "Otomatis memilih {$cover->user->name}")
                ->body("Menggantikan {$requester->name} pada {$window}; tidak ada keputusan sebelum batas waktu.")
                ->field('Pengganti', $cover->user->name)
                ->field('Untuk', $requester->name)
                ->about($cover->user)
                ->link('/operator/backups', 'Lihat backup');
            $this->notifier->toUsers($this->notifier->admins(), $notice, dm: true);
            $this->notifier->toChannel('admin', $notice);
        }
    }

    /** Applicants still waiting when someone else got the cover: they stay on standby in case the cover drops out. */
    private function announceNotPicked(BackupRequest $request): void
    {
        $others = $request->applications()->where('status', 'applied')->with('applicant.user')->get()
            ->map(fn (BackupApplication $application) => $application->applicant->user);
        if ($others->isEmpty()) {
            return;
        }

        $request->loadMissing(['brand', 'requester.user']);

        $this->notifier->toUsers($others, $this->notice($request, 'backup_not_picked', "Kamu tidak terpilih menggantikan di {$request->brand->name}")
            ->body("{$request->brand->name} · {$this->window($request)}, untuk {$request->requester->user->name}. Kamu tetap di daftar tunggu kalau penggantinya batal.")
            ->link('/host/backups'));
    }

    private function announceNoCover(BackupRequest $request): void
    {
        $request->loadMissing(['brand', 'requester.user']);
        $applicants = $request->applications()->where('status', 'applied')->count();

        $notice = $this->notice($request, 'backup_no_cover', "Tidak ada yang bisa menggantikan {$request->requester->user->name}")
            ->body("{$request->brand->name} · {$this->window($request)} segera dimulai dan belum ada host yang memenuhi syarat mendaftar. Tunjuk pengganti secara manual.")
            ->field('Untuk', $request->requester->user->name)
            ->field('Pendaftar', $applicants ? "{$applicants} (tidak ada yang memenuhi syarat)" : 'Belum ada')
            ->about($request->requester->user)
            ->link('/operator/backups', 'Tunjuk pengganti');

        $this->notifier->toUsers($this->notifier->staff(), $notice, dm: true);
        $this->notifier->toChannel('admin', $notice);
    }

    /** A notice about a request, with its brand and time filled in. */
    private function notice(BackupRequest $request, string $type, string $title): Notice
    {
        $request->loadMissing(['brand', 'requester.user']);

        return Notice::make($type, $title)
            ->brand($request->brand->name)
            ->field('Waktu', Notice::window($request->start_at, $request->end_at), inline: false);
    }

    /** "Tue 6 Oct 14:00–16:00" */
    private function window(BackupRequest $request): string
    {
        return $request->start_at->translatedFormat('D j M H:i').'–'.$request->end_at->format('H:i');
    }

    private function fail(string $message): never
    {
        throw ValidationException::withMessages(['backup' => [$message]]);
    }
}
