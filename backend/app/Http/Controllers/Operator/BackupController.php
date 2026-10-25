<?php

namespace App\Http\Controllers\Operator;

use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\BackupApplication;
use App\Models\BackupRequest;
use App\Models\HostProfile;
use App\Models\ScheduleSlot;
use App\Services\BackupService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class BackupController extends Controller
{
    public function __construct(private BackupService $backups) {}

    /** Requests on the closed tab (past, cancelled, rejected) and the recap read 25 at a time / the latest 100. */
    private const CLOSED_PER_PAGE = 25;

    private const RECAP_SIZE = 100;

    /**
     * Requests by tab: pending (applicants wait for a decision) | open (no applicants yet)
     * | filled (upcoming) | closed (past, cancelled, rejected), with `total` for the tab.
     * The upcoming tabs come whole (up to 100); closed grows forever, so it is paged
     * (`page`) and searched here (`search`: host, brand or reason; `reason_types[]`).
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'status' => 'nullable|in:pending,open,filled,closed',
            'page' => 'nullable|integer|min:1',
            'search' => 'nullable|string|max:100',
            'reason_types' => 'nullable|array',
            'reason_types.*' => 'in:sick,permit,other',
        ]);
        $tab = $request->status ?? 'pending';

        $query = BackupRequest::query()
            ->with(['brand:id,name', 'requester.user', 'filler.user', 'attachments', 'nominees.host.user'])
            ->withCount(['applications as applicants_count' => fn ($q) => $q->where('status', 'applied')])
            ->when($tab === 'closed', fn ($q) => $this->closed($q))
            ->when($tab !== 'closed', fn ($q) => $q->where('status', $tab)->where('end_at', '>', now()))
            ->orderBy('start_at', $tab === 'closed' ? 'desc' : 'asc');

        if ($tab === 'closed') {
            $search = trim((string) $request->search);
            $page = $query
                ->when($search !== '' || $request->filled('reason_types'), fn ($q) => $q->where(fn ($q) => $q
                    ->when($search !== '', fn ($q) => $q
                        ->where('reason', 'like', "%{$search}%")
                        ->orWhereHas('brand', fn ($q) => $q->where('name', 'like', "%{$search}%"))
                        ->orWhereHas('requester.user', fn ($q) => $q->where('name', 'like', "%{$search}%"))
                        ->orWhereHas('filler.user', fn ($q) => $q->where('name', 'like', "%{$search}%")))
                    ->when($request->filled('reason_types'), fn ($q) => $q->orWhereIn('reason_type', $request->reason_types))))
                ->paginate(self::CLOSED_PER_PAGE);

            return response()->json([
                'requests' => $page->items(),
                'total' => $page->total(),
                'current_page' => $page->currentPage(),
                'last_page' => $page->lastPage(),
            ]);
        }

        return response()->json([
            'requests' => (clone $query)->limit(100)->get(),
            'total' => $query->count(),
        ]);
    }

    /** Past, cancelled or rejected requests. */
    private function closed(Builder $query): Builder
    {
        return $query->where(fn ($q) => $q->whereIn('status', ['cancelled', 'rejected'])->orWhere('end_at', '<=', now()));
    }

    /**
     * Sick requests still missing their doctor's letter (letter_status due or late), on any tab,
     * however old: `total`, and the 100 that started most recently.
     */
    public function letters(): JsonResponse
    {
        $query = BackupRequest::query()
            ->where('reason_type', 'sick')
            ->whereNotIn('status', ['cancelled', 'rejected'])
            ->whereDoesntHave('attachments');

        return response()->json([
            'requests' => (clone $query)
                ->with(['brand:id,name', 'requester.user', 'filler.user', 'attachments', 'nominees.host.user'])
                ->withCount(['applications as applicants_count' => fn ($q) => $q->where('status', 'applied')])
                ->orderByDesc('start_at')
                ->limit(100)
                ->get(),
            'total' => $query->count(),
        ]);
    }

    /**
     * How the latest 100 closed requests went: filled (and automatically), not filled, and who covered most.
     */
    public function recap(): JsonResponse
    {
        $requests = $this->closed(BackupRequest::query())
            ->with('filler.user')
            ->orderByDesc('start_at')
            ->limit(self::RECAP_SIZE)
            ->get(['id', 'status', 'auto_filled', 'filled_by_host_id', 'start_at']);
        $filled = $requests->where('status', 'filled');

        return response()->json([
            'total' => $requests->count(),
            'window' => self::RECAP_SIZE,
            'filled' => $filled->count(),
            'auto_filled' => $filled->where('auto_filled', true)->count(),
            'top_covers' => $filled->whereNotNull('filler')
                ->groupBy('filled_by_host_id')
                ->map(fn ($group) => [
                    'name' => $group->first()->filler->user->name,
                    'avatar_url' => $group->first()->filler->user->avatar_url,
                    'count' => $group->count(),
                ])
                ->sortBy([['count', 'desc'], ['name', 'asc']])
                ->take(3)
                ->values(),
        ]);
    }

    /**
     * Applicants in pick order, each with whether they can still be picked.
     */
    public function applicants(BackupRequest $backup): JsonResponse
    {
        $applications = $this->backups->rankedApplicants($backup);
        $context = $this->backups->coverContext($applications->pluck('applicant'), collect([$backup]));

        return response()->json([
            'applicants' => $applications
                ->map(fn (BackupApplication $application) => $this->backups->candidate($application->applicant, $backup, $context) + [
                    'applied_at' => $application->created_at,
                ]),
        ]);
    }

    /**
     * Every active host who could be assigned directly (emergencies), eligible ones first.
     */
    public function candidates(BackupRequest $backup): JsonResponse
    {
        return response()->json(['candidates' => $this->backups->candidates($backup)]);
    }

    /**
     * Every active host who could cover one session of a slot, before a request exists
     * (free ones first), so staff can pick the cover straight from the schedule.
     */
    public function slotCandidates(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'slot_id' => 'required|exists:schedule_slots,id',
            'backup_date' => 'required|date_format:Y-m-d',
        ]);

        $draft = $this->backups->draft(ScheduleSlot::with('assignment')->findOrFail($validated['slot_id']), $validated['backup_date']);

        return response()->json(['candidates' => $this->backups->candidates($draft)]);
    }

    /**
     * Request a backup on a host's behalf (e.g. they called in sick). Opens immediately,
     * also for a session starting soon. With `host_id`, that host covers it right away.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'slot_id' => 'required|exists:schedule_slots,id',
            'backup_date' => 'required|date_format:Y-m-d',
            'reason_type' => 'required|in:sick,permit,other',
            'reason' => 'nullable|string|max:1000',
            'host_id' => 'nullable|exists:host_profiles,id',
        ]);

        $slot = ScheduleSlot::with('assignment')->findOrFail($validated['slot_id']);
        $reason = ['reason_type' => $validated['reason_type'], 'reason' => $validated['reason'] ?? null];

        // With a cover, the request and its cover are saved together (or not at all)
        if (isset($validated['host_id'])) {
            $cover = HostProfile::with('user')->findOrFail($validated['host_id']);
            $backup = $this->backups->createFilled($slot, $validated['backup_date'], $reason, $request->user(), $cover)->load('filler.user');

            return response()->json(['request' => $backup, 'message' => 'Host pengganti disetujui'], 201);
        }

        $backup = $this->backups->create($slot, $validated['backup_date'], $reason, $request->user(), byStaff: true);

        return response()->json(['request' => $backup, 'message' => 'Permintaan backup dibuka'], 201);
    }

    /**
     * Turn an applicant down. With nobody else waiting, the request is open again.
     */
    public function rejectApplicant(Request $request, BackupRequest $backup): JsonResponse
    {
        $validated = $request->validate(['host_id' => 'required|exists:host_profiles,id']);

        $this->backups->rejectApplicant($backup, HostProfile::findOrFail($validated['host_id']));

        return response()->json(['message' => 'Pendaftar ditolak']);
    }

    /**
     * Call off a request entirely (also releases the cover, without penalty).
     */
    public function cancel(BackupRequest $backup): JsonResponse
    {
        if (! in_array($backup->status, ['pending', 'open', 'filled'])) {
            return response()->json(['message' => 'Permintaan ini sudah ditutup.'], 422);
        }
        if ($this->started($backup)) {
            return response()->json(['message' => 'Sesi ini sudah dimulai, jadi permintaannya tidak bisa dibatalkan lagi.'], 422);
        }

        $this->backups->close($backup, 'cancelled');

        return response()->json(['message' => 'Permintaan dibatalkan']);
    }

    /**
     * ACC who covers it: an applicant, or any free host directly (emergencies).
     */
    public function assign(Request $request, BackupRequest $backup): JsonResponse
    {
        $validated = $request->validate(['host_id' => 'required|exists:host_profiles,id']);

        $backup = $this->backups->fill($backup, HostProfile::findOrFail($validated['host_id']), $request->user());

        return response()->json(['request' => $backup->load('filler.user'), 'message' => 'Host pengganti disetujui']);
    }

    /**
     * Remove the current cover without penalty (admin decision) and reopen.
     */
    public function unassign(BackupRequest $backup): JsonResponse
    {
        if ($backup->status !== 'filled') {
            return response()->json(['message' => 'Belum ada yang ditunjuk untuk backup ini.'], 422);
        }
        if ($this->started($backup)) {
            return response()->json(['message' => 'Sesi ini sudah dimulai, jadi penggantinya tidak bisa dilepas lagi.'], 422);
        }

        $this->backups->unfill($backup, 'rejected');

        return response()->json(['message' => 'Pengganti dilepas. Backup dibuka lagi.']);
    }

    /**
     * Whether the session has started or been checked in for: its cover then stays (their
     * hours, pay, quota and access to the brand's material depend on it).
     */
    private function started(BackupRequest $backup): bool
    {
        return $backup->start_at->isPast() || Attendance::where('backup_request_id', $backup->id)->exists();
    }

    /**
     * Download the latest sick letter.
     */
    public function letter(BackupRequest $backup): StreamedResponse
    {
        $attachment = $backup->attachments()->first();
        abort_unless($attachment && Storage::disk('local')->exists($attachment->file_path), 404, 'Belum ada surat yang diunggah.');

        return Storage::disk('local')->response($attachment->file_path, $attachment->original_name);
    }
}
