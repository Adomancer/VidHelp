<?php

namespace App\Http\Controllers\Operator;

use App\Http\Controllers\Controller;
use App\Models\BackupApplication;
use App\Models\BackupQuota;
use App\Models\BackupRequest;
use App\Models\HostProfile;
use App\Models\ScheduleSlot;
use App\Services\BackupService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class BackupController extends Controller
{
    public function __construct(private BackupService $backups)
    {
    }

    /**
     * Requests by tab: pending | open | filled (upcoming) | closed (past, cancelled, rejected).
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate(['status' => 'nullable|in:pending,open,filled,closed']);
        $tab = $request->status ?? 'pending';

        $requests = BackupRequest::query()
            ->with(['brand:id,name', 'requester.user', 'filler.user', 'attachments'])
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
                ->map(fn (BackupApplication $application) => $this->candidate($application->applicant, $backup) + [
                    'applied_at' => $application->created_at,
                ]),
        ]);
    }

    /**
     * Every active host who could be assigned directly (emergencies), eligible ones first.
     */
    public function candidates(BackupRequest $backup): JsonResponse
    {
        $candidates = HostProfile::query()
            ->where('status', 'active')
            ->whereKeyNot($backup->requesting_host_id)
            ->whereHas('user', fn ($q) => $q->where('status', 'active'))
            ->with('user')
            ->get()
            ->map(fn (HostProfile $host) => $this->candidate($host, $backup))
            ->sortBy([['eligible', 'desc'], ['same_brand', 'desc'], ['name', 'asc']])
            ->values();

        return response()->json(['candidates' => $candidates]);
    }

    /**
     * Request a backup on a host's behalf (e.g. they called in sick). Opens immediately.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'slot_id' => 'required|exists:schedule_slots,id',
            'backup_date' => 'required|date_format:Y-m-d',
            'reason_type' => 'required|in:sick,permit,other',
            'reason' => 'nullable|string|max:1000',
        ]);

        $backup = $this->backups->create(
            ScheduleSlot::with('assignment')->findOrFail($validated['slot_id']),
            $validated['backup_date'],
            ['reason_type' => $validated['reason_type'], 'reason' => $validated['reason'] ?? null],
            $request->user(),
            approved: true,
        );

        return response()->json(['request' => $backup, 'message' => 'Backup request opened'], 201);
    }

    public function approve(Request $request, BackupRequest $backup): JsonResponse
    {
        if ($backup->status !== 'pending') {
            return response()->json(['message' => 'Only pending requests can be approved.'], 422);
        }

        $backup->update(['status' => 'open', 'approved_by' => $request->user()->id, 'approved_at' => now()]);

        return response()->json(['message' => 'Approved. Hosts can now apply.']);
    }

    public function reject(BackupRequest $backup): JsonResponse
    {
        if (! in_array($backup->status, ['pending', 'open'])) {
            return response()->json(['message' => 'Only pending or open requests can be rejected.'], 422);
        }

        $this->backups->close($backup, 'rejected');

        return response()->json(['message' => 'Request rejected']);
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
     * Pick who covers it: an applicant, or any free host directly.
     */
    public function assign(Request $request, BackupRequest $backup): JsonResponse
    {
        $validated = $request->validate(['host_id' => 'required|exists:host_profiles,id']);

        $backup = $this->backups->fill($backup, HostProfile::findOrFail($validated['host_id']));

        return response()->json(['request' => $backup->load('filler.user'), 'message' => 'Backup host assigned']);
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

    private function candidate(HostProfile $host, BackupRequest $backup): array
    {
        $reason = $this->backups->ineligibleReason($host, $backup);
        $quota = BackupQuota::peek($host->id, $backup->quotaMonth());

        return [
            'host_id' => $host->id,
            'name' => $host->user->name,
            'avatar_url' => $host->user->avatar_url,
            'same_brand' => $this->backups->isSameBrand($host, $backup),
            'eligible' => $reason === null,
            'ineligible_reason' => $reason,
            'quota' => $quota->only('quota_used', 'quota_max'),
        ];
    }
}
