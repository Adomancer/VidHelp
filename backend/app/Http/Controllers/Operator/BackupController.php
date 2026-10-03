<?php

namespace App\Http\Controllers\Operator;

use App\Http\Controllers\Controller;
use App\Models\BackupApplication;
use App\Models\BackupRequest;
use App\Models\HostProfile;
use App\Models\ScheduleSlot;
use App\Services\BackupService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

class BackupController extends Controller
{
    public function __construct(private BackupService $backups) {}

    /**
     * Requests by tab: pending (applicants wait for a decision) | open (no applicants yet)
     * | filled (upcoming) | closed (past, cancelled, rejected).
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate(['status' => 'nullable|in:pending,open,filled,closed']);
        $tab = $request->status ?? 'pending';

        $requests = BackupRequest::query()
            ->with(['brand:id,name', 'requester.user', 'filler.user', 'attachments', 'nominees.host.user'])
            ->withCount(['applications as applicants_count' => fn ($q) => $q->where('status', 'applied')])
            ->when($tab === 'closed', fn ($q) => $q->where(fn ($q) => $q
                ->whereIn('status', ['cancelled', 'rejected'])
                ->orWhere('end_at', '<=', now())))
            ->when($tab !== 'closed', fn ($q) => $q->where('status', $tab)->where('end_at', '>', now()))
            ->orderBy('start_at', $tab === 'closed' ? 'desc' : 'asc')
            ->limit(100)
            ->get();

        return response()->json(['requests' => $requests]);
    }

    /**
     * Applicants in pick order, each with whether they can still be picked.
     */
    public function applicants(BackupRequest $backup): JsonResponse
    {
        return response()->json([
            'applicants' => $this->backups->rankedApplicants($backup)
                ->map(fn (BackupApplication $application) => $this->backups->candidate($application->applicant, $backup) + [
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
        $cover = isset($validated['host_id']) ? HostProfile::with('user')->findOrFail($validated['host_id']) : null;

        // Check the cover first, so a request isn't left behind when they can't take it
        if ($cover && $reason = $this->backups->coverReason($cover, $this->backups->draft($slot, $validated['backup_date']))) {
            throw ValidationException::withMessages(['host_id' => [$reason]]);
        }

        $backup = $this->backups->create(
            $slot,
            $validated['backup_date'],
            ['reason_type' => $validated['reason_type'], 'reason' => $validated['reason'] ?? null],
            $request->user(),
            byStaff: true,
            announce: $cover === null,
        );

        if ($cover) {
            $backup = $this->backups->fill($backup, $cover, $request->user())->load('filler.user');

            return response()->json(['request' => $backup, 'message' => 'Backup host approved'], 201);
        }

        return response()->json(['request' => $backup, 'message' => 'Backup request opened'], 201);
    }

    /**
     * Turn an applicant down. With nobody else waiting, the request is open again.
     */
    public function rejectApplicant(Request $request, BackupRequest $backup): JsonResponse
    {
        $validated = $request->validate(['host_id' => 'required|exists:host_profiles,id']);

        $this->backups->rejectApplicant($backup, HostProfile::findOrFail($validated['host_id']));

        return response()->json(['message' => 'Applicant rejected']);
    }

    /**
     * Call off a request entirely (also releases the cover, without penalty).
     */
    public function cancel(BackupRequest $backup): JsonResponse
    {
        if (! in_array($backup->status, ['pending', 'open', 'filled'])) {
            return response()->json(['message' => 'This request is already closed.'], 422);
        }

        $this->backups->close($backup, 'cancelled');

        return response()->json(['message' => 'Request cancelled']);
    }

    /**
     * ACC who covers it: an applicant, or any free host directly (emergencies).
     */
    public function assign(Request $request, BackupRequest $backup): JsonResponse
    {
        $validated = $request->validate(['host_id' => 'required|exists:host_profiles,id']);

        $backup = $this->backups->fill($backup, HostProfile::findOrFail($validated['host_id']), $request->user());

        return response()->json(['request' => $backup->load('filler.user'), 'message' => 'Backup host approved']);
    }

    /**
     * Remove the current cover without penalty (admin decision) and reopen.
     */
    public function unassign(BackupRequest $backup): JsonResponse
    {
        if ($backup->status !== 'filled') {
            return response()->json(['message' => 'Nobody is assigned to this backup.'], 422);
        }

        $this->backups->unfill($backup, 'rejected');

        return response()->json(['message' => 'Cover removed. The backup is open again.']);
    }

    /**
     * Download the latest sick letter.
     */
    public function letter(BackupRequest $backup): StreamedResponse
    {
        $attachment = $backup->attachments()->first();
        abort_unless($attachment && Storage::disk('local')->exists($attachment->file_path), 404, 'No letter uploaded.');

        return Storage::disk('local')->response($attachment->file_path, $attachment->original_name);
    }
}
