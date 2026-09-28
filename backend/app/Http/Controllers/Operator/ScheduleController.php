<?php

namespace App\Http\Controllers\Operator;

use App\Http\Controllers\Controller;
use App\Models\BackupRequest;
use App\Models\ScheduleSlot;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ScheduleController extends Controller
{
    /**
     * Weekly slots in effect on a date (default today), filterable by brand or host.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'on' => 'nullable|date',
            'brand_id' => 'nullable|uuid',
            'host_id' => 'nullable|uuid',
        ]);

        $slots = ScheduleSlot::query()
            ->activeOn($request->date('on') ?? today())
            ->with(['assignment.brand:id,name', 'assignment.host.user'])
            ->when($request->brand_id, fn ($q, $id) => $q->whereHas('assignment', fn ($q) => $q->where('brand_id', $id)))
            ->when($request->host_id, fn ($q, $id) => $q->whereHas('assignment', fn ($q) => $q->where('host_id', $id)))
            ->orderBy('day_of_week')
            ->orderBy('start_time')
            ->get();

        // Backups in the 7 days from `on`, so the board can mark "covered by B" on that week's slots
        $from = ($request->date('on') ?? today())->startOfDay();
        $backups = BackupRequest::query()
            ->whereIn('status', ['pending', 'open', 'filled'])
            ->whereIn('slot_id', $slots->pluck('id'))
            ->whereDate('backup_date', '>=', $from)
            ->whereDate('backup_date', '<', $from->copy()->addDays(7))
            ->with('filler.user')
            ->get()
            ->map(fn (BackupRequest $backup) => $backup->slotMarker());

        return response()->json(['slots' => $slots, 'backups' => $backups]);
    }

    public function store(Request $request): JsonResponse
    {
        $slot = new ScheduleSlot(['slot_type' => 'regular', 'status' => 'active', 'effective_from' => today()]);
        $slot->fill($this->validated($request, $slot));

        $this->ensureNoConflicts($slot);
        $slot->save();

        return response()->json(['slot' => $this->load($slot), 'message' => 'Slot added'], 201);
    }

    /**
     * Edit times, day, host or period. Locked slots are admin-only.
     */
    public function update(Request $request, ScheduleSlot $schedule): JsonResponse
    {
        $this->ensureCanChange($request, $schedule);

        $schedule->fill($this->validated($request, $schedule));
        $this->ensureNoConflicts($schedule);
        $schedule->save();

        return response()->json(['slot' => $this->load($schedule), 'message' => 'Slot updated']);
    }

    /**
     * Remove a slot from today on (past weeks keep their history).
     */
    public function destroy(Request $request, ScheduleSlot $schedule): JsonResponse
    {
        $this->ensureCanChange($request, $schedule);

        $schedule->retire();

        return response()->json(['message' => 'Slot removed']);
    }

    /**
     * Admin only: lock so operators can't change or remove the slot.
     */
    public function lock(Request $request, ScheduleSlot $schedule): JsonResponse
    {
        $validated = $request->validate(['is_locked' => 'required|boolean']);

        $schedule->update($validated);

        return response()->json([
            'slot' => $this->load($schedule),
            'message' => $validated['is_locked'] ? 'Slot locked' : 'Slot unlocked',
        ]);
    }

    private function validated(Request $request, ScheduleSlot $slot): array
    {
        $required = $slot->exists ? 'sometimes' : 'required';

        $validated = $request->validate([
            'assignment_id' => [
                $required,
                Rule::exists('host_brand_assignments', 'id')->where('status', 'active'),
            ],
            'day_of_week' => "$required|integer|between:1,7",
            'start_time' => "$required|date_format:H:i",
            'end_time' => "$required|date_format:H:i",
            'slot_type' => 'sometimes|in:regular,pd',
            'effective_from' => 'sometimes|date',
            'effective_to' => 'sometimes|nullable|date',
        ], [
            'assignment_id.exists' => 'Choose a host who is active on this brand.',
        ]);

        // Cross-field checks against the merged (existing + new) values
        $start = $validated['start_time'] ?? $slot->start_time;
        $end = $validated['end_time'] ?? $slot->end_time;
        if ($start === $end) {
            throw ValidationException::withMessages(['end_time' => ['End time must differ from start time.']]);
        }

        $from = $validated['effective_from'] ?? $slot->effective_from?->toDateString();
        $to = array_key_exists('effective_to', $validated) ? $validated['effective_to'] : $slot->effective_to?->toDateString();
        if ($to !== null && $to < $from) {
            throw ValidationException::withMessages(['effective_to' => ['The end date must be on or after the start date.']]);
        }

        return $validated;
    }

    private function ensureNoConflicts(ScheduleSlot $slot): void
    {
        $clash = $slot->conflicts()->first();

        if ($clash) {
            $who = $clash->assignment->host->user->name;
            $brand = $clash->assignment->brand->name;

            throw ValidationException::withMessages([
                'start_time' => ["Clashes with {$who} on {$brand} ({$clash->label()})."],
            ]);
        }
    }

    private function ensureCanChange(Request $request, ScheduleSlot $slot): void
    {
        abort_if(
            $slot->is_locked && ! $request->user()->hasRole('admin'),
            403,
            'This slot is locked. Only an admin can change it.'
        );
    }

    private function load(ScheduleSlot $slot): ScheduleSlot
    {
        return $slot->load(['assignment.brand:id,name', 'assignment.host.user']);
    }
}
