<?php

namespace App\Http\Controllers\Host;

use App\Http\Controllers\Controller;
use App\Models\BackupQuota;
use App\Models\BackupRequest;
use App\Models\HostProfile;
use App\Models\ScheduleSlot;
use App\Services\BackupService;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class BackupController extends Controller
{
    public function __construct(private BackupService $backups)
    {
    }

    /**
     * My own requests, the backups I'm covering, and this month's cross-brand quota.
     */
    public function index(Request $request): JsonResponse
    {
        $host = $this->host($request);

        return response()->json([
            'requests' => BackupRequest::where('requesting_host_id', $host->id)
                ->with(['brand:id,name', 'filler.user', 'attachments'])
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
     * "Backup needs": open requests from other hosts, with whether I can apply.
     */
    public function needs(Request $request): JsonResponse
    {
        $host = $this->host($request);

        $needs = BackupRequest::where('status', 'open')
            ->where('end_at', '>', now())
            ->where('requesting_host_id', '!=', $host->id)
            ->with(['brand:id,name', 'requester.user', 'applications' => fn ($q) => $q->where('applicant_host_id', $host->id)])
            ->orderBy('start_at')
            ->get()
            ->map(function (BackupRequest $backup) use ($host) {
                $mine = $backup->applications->first();

                return [
                    ...$backup->publicSummary(),
                    'same_brand' => $this->backups->isSameBrand($host, $backup),
                    'my_application' => $mine?->only('id', 'status'),
                    'ineligible_reason' => $mine?->status === 'applied' ? null : $this->backups->ineligibleReason($host, $backup),
                ];
            });

        return response()->json(['needs' => $needs]);
    }

    /**
     * My slot occurrences in the next 14 days that don't have a backup request yet.
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

        $occurrences = [];
        for ($day = CarbonImmutable::today(); $day->lt(today()->addDays(14)); $day = $day->addDay()) {
            foreach ($slots as $slot) {
                [$start, $end] = $slot->occurrenceOn($day);
                if ($slot->runsOn($day) && $end->isFuture() && ! $taken->has($slot->id.'|'.$day->toDateString())) {
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
     * Ask for a backup for one occurrence of my slot. Waits for admin approval.
     */
    public function store(Request $request): JsonResponse
    {
        $host = $this->host($request);

        $validated = $request->validate([
            'slot_id' => 'required|uuid',
            'backup_date' => 'required|date_format:Y-m-d',
            'reason_type' => 'required|in:sick,permit,other',
            'reason' => 'nullable|string|max:1000',
        ]);

        $slot = ScheduleSlot::whereKey($validated['slot_id'])
            ->whereHas('assignment', fn ($q) => $q->where('host_id', $host->id)->where('status', 'active'))
            ->first() ?? throw ValidationException::withMessages(['slot_id' => ['Choose one of your own slots.']]);

        $backup = $this->backups->create(
            $slot,
            $validated['backup_date'],
            ['reason_type' => $validated['reason_type'], 'reason' => $validated['reason'] ?? null],
            $request->user(),
            approved: false,
        );

        return response()->json(['request' => $backup->load('brand:id,name'), 'message' => 'Backup requested. Waiting for admin approval.'], 201);
    }

    /**
     * Withdraw my own request (only before someone has been picked to cover it).
     */
    public function cancel(Request $request, BackupRequest $backup): JsonResponse
    {
        $this->ensureOwnRequest($request, $backup);

        if (! in_array($backup->status, ['pending', 'open'])) {
            return response()->json(['message' => 'A cover has already been picked. Ask an admin to cancel it.'], 422);
        }

        $this->backups->close($backup, 'cancelled');

        return response()->json(['message' => 'Request cancelled']);
    }

    /**
     * Upload the doctor's letter for a sick request.
     */
    public function uploadLetter(Request $request, BackupRequest $backup): JsonResponse
    {
        $this->ensureOwnRequest($request, $backup);
        $request->validate(['letter' => 'required|file|mimes:jpg,jpeg,png,pdf|max:5120']);

        $file = $request->file('letter');
        $backup->attachments()->create([
            'file_path' => $file->store('backup-letters', 'local'),
            'original_name' => $file->getClientOriginalName(),
            'mime_type' => $file->getMimeType(),
            'size_kb' => (int) ceil($file->getSize() / 1024),
            'uploaded_by' => $request->user()->id,
        ]);

        return response()->json(['request' => $backup->fresh(['brand:id,name', 'attachments']), 'message' => 'Letter uploaded']);
    }

    /**
     * Offer to cover an open request.
     */
    public function apply(Request $request, BackupRequest $backup): JsonResponse
    {
        $host = $this->host($request);

        if (! $backup->isOpenForApplications()) {
            return response()->json(['message' => 'This backup is no longer open.'], 422);
        }
        if ($reason = $this->backups->ineligibleReason($host, $backup)) {
            return response()->json(['message' => $reason], 422);
        }

        $backup->applications()->updateOrCreate(
            ['applicant_host_id' => $host->id],
            ['status' => 'applied', 'decided_at' => null]
        );

        return response()->json(['message' => 'Applied. An admin will pick who covers it.']);
    }

    /**
     * Take back my application before I'm picked.
     */
    public function withdraw(Request $request, BackupRequest $backup): JsonResponse
    {
        $updated = $backup->applications()
            ->where('applicant_host_id', $this->host($request)->id)
            ->where('status', 'applied')
            ->update(['status' => 'withdrawn', 'decided_at' => now()]);

        return $updated
            ? response()->json(['message' => 'Application withdrawn'])
            : response()->json(['message' => 'You have no pending application for this backup.'], 422);
    }

    /**
     * Drop a backup I was picked for. Reopens it for others and flags a point penalty.
     */
    public function drop(Request $request, BackupRequest $backup): JsonResponse
    {
        $host = $this->host($request);

        if ($backup->status !== 'filled' || $backup->filled_by_host_id !== $host->id) {
            return response()->json(['message' => 'You are not covering this backup.'], 422);
        }
        if ($backup->start_at->isPast()) {
            return response()->json(['message' => 'This backup has already started. Contact an admin.'], 422);
        }

        $this->backups->unfill($backup, 'cancelled');

        return response()->json(['message' => 'You dropped this backup. It is open for other hosts again, and a point penalty will apply.']);
    }

    private function host(Request $request): HostProfile
    {
        return $request->user()->hostProfile ?? abort(404, 'You do not have a host profile.');
    }

    private function ensureOwnRequest(Request $request, BackupRequest $backup): void
    {
        abort_unless($backup->requesting_host_id === $this->host($request)->id, 403, 'This is not your request.');
    }
}
