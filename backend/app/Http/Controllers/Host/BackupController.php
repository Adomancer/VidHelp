<?php

namespace App\Http\Controllers\Host;

use App\Http\Controllers\Controller;
use App\Models\BackupQuota;
use App\Models\BackupRequest;
use App\Models\HostProfile;
use App\Models\ScheduleSlot;
use App\Services\BackupService;
use App\Services\EventCalendar;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class BackupController extends Controller
{
    public function __construct(private BackupService $backups, private EventCalendar $events) {}

    /**
     * My own requests, the backups I'm covering, and this month's cross-brand quota.
     */
    public function index(Request $request): JsonResponse
    {
        $host = $this->host($request);

        return response()->json([
            'requests' => BackupRequest::where('requesting_host_id', $host->id)
                ->with(['brand:id,name', 'filler.user', 'attachments', 'nominees.host.user'])
                ->latest('start_at')
                ->limit(30)
                ->get(),
            'covers' => BackupRequest::where('filled_by_host_id', $host->id)
                ->where('status', 'filled')
                ->where('end_at', '>', now()->subDays(7))
                ->with(['brand:id,name', 'requester.user'])
                ->orderBy('start_at')
                ->get()
                ->map(fn (BackupRequest $backup) => $backup->publicSummary()),
            'quota' => BackupQuota::peek($host->id, now()->format('Y-m'))->only('month_year', 'quota_used', 'quota_max'),
        ]);
    }

    /**
     * "Backup needs": requests from other hosts still taking applicants (open to everyone,
     * or naming specific hosts), with whether I can apply. Ones that name me come first.
     */
    public function needs(Request $request): JsonResponse
    {
        $host = $this->host($request);

        $needs = BackupRequest::whereIn('status', ['open', 'pending'])
            ->where('start_at', '>', now())
            ->where('requesting_host_id', '!=', $host->id)
            ->with(['brand:id,name', 'requester.user', 'nominees.host.user', 'applications' => fn ($q) => $q->where('applicant_host_id', $host->id)])
            ->orderBy('start_at')
            ->get()
            ->map(function (BackupRequest $backup) use ($host) {
                $mine = $backup->applications->first();

                return [
                    ...$backup->publicSummary(),
                    'asked_me' => $backup->nominees->contains('nominee_host_id', $host->id),
                    'same_brand' => $this->backups->isSameBrand($host, $backup),
                    'my_application' => $mine?->only('id', 'status'),
                    'ineligible_reason' => $mine?->status === 'applied' ? null : $this->backups->ineligibleReason($host, $backup),
                ];
            })
            ->sortByDesc('asked_me')
            ->values();

        return response()->json(['needs' => $needs]);
    }

    /**
     * My slot occurrences in the next 14 days that I can still request a backup for
     * (far enough ahead, and without a request yet).
     */
    public function slots(Request $request): JsonResponse
    {
        $host = $this->host($request);

        $slots = ScheduleSlot::query()
            ->with('assignment.brand:id,name')
            ->where('status', 'active')
            ->whereHas('assignment', fn ($q) => $q->where('host_id', $host->id)->where('status', 'active'))
            ->get();

        $taken = BackupRequest::where('requesting_host_id', $host->id)
            ->whereIn('status', ['pending', 'open', 'filled'])
            ->get()
            ->map(fn (BackupRequest $backup) => $backup->slot_id.'|'.$backup->backup_date->toDateString())
            ->flip();

        $earliest = now()->addHours(config('vidhelp.backup.request_min_hours_before'));
        $occurrences = [];
        for ($day = CarbonImmutable::today(); $day->lt(today()->addDays(14)); $day = $day->addDay()) {
            foreach ($slots as $slot) {
                [$start, $end] = $slot->occurrenceOn($day);
                $runs = $slot->runsOn($day) && ! $this->events->replacing($slot->assignment->brand_id, $day);
                if ($runs && $start->gte($earliest) && ! $taken->has($slot->id.'|'.$day->toDateString())) {
                    $occurrences[] = [
                        'slot_id' => $slot->id,
                        'date' => $day->toDateString(),
                        'start_at' => $start,
                        'end_at' => $end,
                        'brand' => $slot->assignment->brand->only('id', 'name'),
                    ];
                }
            }
        }

        usort($occurrences, fn ($a, $b) => $a['start_at'] <=> $b['start_at']);

        return response()->json(['slots' => $occurrences]);
    }

    /**
     * Hosts I could name for a direct request on one occurrence of my slot, free ones first.
     */
    public function candidates(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'slot_id' => 'required|uuid',
            'backup_date' => 'required|date_format:Y-m-d',
        ]);

        $draft = $this->backups->draft($this->mySlot($request, $validated['slot_id']), $validated['backup_date']);

        // Other hosts' reasons (banned, quota, their schedule) are theirs: hosts only see "not available"
        return response()->json([
            'candidates' => $this->backups->candidates($draft)
                ->map(fn (array $candidate) => [
                    ...collect($candidate)->only('host_id', 'name', 'avatar_url', 'same_brand', 'eligible'),
                    'ineligible_reason' => $candidate['eligible'] ? null : 'Tidak tersedia',
                ]),
        ]);
    }

    /**
     * Ask for a backup for one occurrence of my slot: open to every host, or only to the
     * hosts I name (direct). It shows on the backup board right away.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'slot_id' => 'required|uuid',
            'backup_date' => 'required|date_format:Y-m-d',
            'reason_type' => 'required|in:sick,permit,other',
            'reason' => 'nullable|string|max:1000',
            'request_type' => 'nullable|in:open,direct',
            'host_ids' => [
                'exclude_unless:request_type,direct', 'required', 'array',
                'min:'.config('vidhelp.backup.direct_min_hosts'), 'max:'.config('vidhelp.backup.direct_max_hosts'),
            ],
            'host_ids.*' => 'uuid|distinct',
            'letter' => 'nullable|file|mimes:jpg,jpeg,png,pdf|max:5120',
        ], [
            'host_ids.required' => 'Pilih host yang ingin kamu minta.',
            'host_ids.min' => 'Pilih minimal :min host.',
            'host_ids.max' => 'Pilih maksimal :max host.',
        ]);

        $backup = $this->backups->create(
            $this->mySlot($request, $validated['slot_id']),
            $validated['backup_date'],
            ['reason_type' => $validated['reason_type'], 'reason' => $validated['reason'] ?? null],
            $request->user(),
            byStaff: false,
            nomineeIds: $validated['host_ids'] ?? [],
            letter: $request->file('letter'),
        );

        $message = $backup->request_type === 'direct'
            ? 'Backup diajukan. Host yang kamu pilih sudah diminta untuk menggantikan.'
            : 'Backup diajukan. Host lain sekarang bisa mendaftar.';

        return response()->json(['request' => $backup->load(['brand:id,name', 'attachments', 'nominees.host.user']), 'message' => $message], 201);
    }

    /**
     * Withdraw my own request (only before someone has been picked to cover it).
     */
    public function cancel(Request $request, BackupRequest $backup): JsonResponse
    {
        $this->ensureOwnRequest($request, $backup);

        if (! in_array($backup->status, ['pending', 'open'])) {
            return response()->json(['message' => 'Pengganti sudah disetujui. Minta admin untuk membatalkannya.'], 422);
        }

        $this->backups->close($backup, 'cancelled');

        return response()->json(['message' => 'Permintaan dibatalkan']);
    }

    /**
     * Upload the doctor's letter for a sick request.
     */
    public function uploadLetter(Request $request, BackupRequest $backup): JsonResponse
    {
        $this->ensureOwnRequest($request, $backup);
        $request->validate(['letter' => 'required|file|mimes:jpg,jpeg,png,pdf|max:5120']);

        $this->backups->attachLetter($backup, $request->file('letter'), $request->user());

        return response()->json(['request' => $backup->fresh(['brand:id,name', 'attachments']), 'message' => 'Surat diunggah']);
    }

    /**
     * Offer to cover a request. The admin approves or rejects it.
     */
    public function apply(Request $request, BackupRequest $backup): JsonResponse
    {
        $this->backups->apply($backup, $this->host($request));

        return response()->json(['message' => 'Sudah mendaftar. Menunggu persetujuan admin.']);
    }

    /**
     * Take back my application before the admin decides.
     */
    public function withdraw(Request $request, BackupRequest $backup): JsonResponse
    {
        $this->backups->withdraw($backup, $this->host($request));

        return response()->json(['message' => 'Pendaftaran ditarik']);
    }

    /**
     * Drop a backup I was picked for. Reopens it for others and flags a point penalty.
     */
    public function drop(Request $request, BackupRequest $backup): JsonResponse
    {
        $host = $this->host($request);

        if ($backup->status !== 'filled' || $backup->filled_by_host_id !== $host->id) {
            return response()->json(['message' => 'Kamu tidak menggantikan di backup ini.'], 422);
        }
        if ($backup->start_at->isPast()) {
            return response()->json(['message' => 'Backup ini sudah dimulai. Hubungi admin.'], 422);
        }

        $this->backups->unfill($backup, 'cancelled');

        return response()->json(['message' => 'Kamu batal menggantikan. Backup ini dibuka lagi untuk host lain, dan poinmu akan dipotong.']);
    }

    private function host(Request $request): HostProfile
    {
        return $request->user()->hostProfile ?? abort(404, 'Kamu tidak punya profil host.');
    }

    /** One of my own slots (on an active assignment). */
    private function mySlot(Request $request, string $slotId): ScheduleSlot
    {
        return ScheduleSlot::whereKey($slotId)
            ->with('assignment')
            ->whereHas('assignment', fn ($q) => $q->where('host_id', $this->host($request)->id)->where('status', 'active'))
            ->first() ?? throw ValidationException::withMessages(['slot_id' => ['Pilih salah satu slot milikmu.']]);
    }

    private function ensureOwnRequest(Request $request, BackupRequest $backup): void
    {
        abort_unless($backup->requesting_host_id === $this->host($request)->id, 403, 'Ini bukan permintaanmu.');
    }
}
