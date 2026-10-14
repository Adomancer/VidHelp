<?php

namespace App\Http\Controllers\Operator;

use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\AuditLog;
use App\Models\BackupRequest;
use App\Models\HostBrandAssignment;
use App\Models\ScheduleSlot;
use App\Models\SpecialEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Arr;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class ScheduleController extends Controller
{
    /** How long after saving a slot the change can still be taken back. */
    private const UNDO_MINUTES = 10;

    /**
     * Weekly slots in effect on a date (default today), filterable by brand or host.
     * With `days` (up to 7), every slot in effect on any of the days from `on`.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'on' => 'nullable|date',
            // Up to six weeks, so the month calendar loads in one request
            'days' => 'nullable|integer|between:1,42',
            'brand_id' => 'nullable|uuid',
            'host_id' => 'nullable|uuid',
        ]);

        $from = ($request->date('on') ?? today())->startOfDay();
        $days = $request->integer('days') ?: 1;
        // Backups and events cover at least the week from `on` (the week board), or the whole range when longer
        $until = $from->copy()->addDays(max($days, 7));

        $slots = ScheduleSlot::query()
            ->activeDuring($from, $from->copy()->addDays($days - 1))
            ->with(['assignment.brand:id,name', 'assignment.host.user'])
            ->when($request->brand_id, fn ($q, $id) => $q->whereHas('assignment', fn ($q) => $q->where('brand_id', $id)))
            ->when($request->host_id, fn ($q, $id) => $q->whereHas('assignment', fn ($q) => $q->where('host_id', $id)))
            ->orderBy('day_of_week')
            ->orderBy('start_time')
            ->get();

        // Backups in that range, so the board can mark "covered by B" on those slots
        $backups = BackupRequest::query()
            ->whereIn('status', ['pending', 'open', 'filled'])
            ->whereIn('slot_id', $slots->pluck('id'))
            ->whereDate('backup_date', '>=', $from)
            ->whereDate('backup_date', '<', $until)
            ->with('filler.user')
            ->get()
            ->map(fn (BackupRequest $backup) => $backup->slotMarker());

        // Events replacing the regular schedule in that range (slots on those days don't run)
        $events = SpecialEvent::query()
            ->where('status', 'active')
            ->where('open_full_schedule', true)
            ->when($request->brand_id, fn ($q, $id) => $q->where('brand_id', $id))
            ->whereDate('start_date', '<', $until)
            ->whereDate('end_date', '>=', $from)
            ->get(['id', 'brand_id', 'name', 'start_date', 'end_date']);

        return response()->json(['slots' => $slots, 'backups' => $backups, 'replacing_events' => $events]);
    }

    /**
     * Add a weekly slot, or with `days_of_week` (e.g. every day) one slot per day, all or none.
     * `slot` is the first one, `slots` all of them.
     */
    public function store(Request $request): JsonResponse
    {
        $attributes = $this->validated($request, new ScheduleSlot);
        $days = $this->days($request) ?? [$attributes['day_of_week']];

        $slots = DB::transaction(fn () => collect($days)->map(function (int $day) use ($attributes) {
            $slot = new ScheduleSlot(['slot_type' => 'regular', 'status' => 'active', 'effective_from' => today()]);
            $slot->fill([...$attributes, 'day_of_week' => $day]);

            $this->ensureNoConflicts($slot);
            $slot->save();

            return $this->load($slot);
        }));

        return response()->json([
            'slot' => $slots->first(),
            'slots' => $slots,
            'message' => $slots->count() > 1 ? "{$slots->count()} slot ditambahkan" : 'Slot ditambahkan',
        ], 201);
    }

    /**
     * Clashes a slot would have, checked while the form is being filled in
     * (`ignore_id` = the slot being edited).
     */
    public function conflicts(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'assignment_id' => 'required|uuid|exists:host_brand_assignments,id',
            'day_of_week' => 'required_without:days_of_week|integer|between:1,7',
            'start_time' => 'required|date_format:H:i',
            'end_time' => 'required|date_format:H:i|different:start_time',
            'effective_from' => 'required|date',
            'effective_to' => 'nullable|date',
            'ignore_id' => 'nullable|uuid',
        ]);

        $days = $this->days($request) ?? [$validated['day_of_week']];

        $conflicts = collect($days)
            ->flatMap(fn (int $day) => (new ScheduleSlot([...Arr::except($validated, 'ignore_id'), 'day_of_week' => $day]))->conflicts($validated['ignore_id'] ?? null))
            ->unique('id')
            ->values();
        $hostId = $conflicts->isEmpty() ? null : HostBrandAssignment::find($validated['assignment_id'])->host_id;

        $conflicts = $conflicts->map(fn (ScheduleSlot $other) => [
            'id' => $other->id,
            'host_name' => $other->assignment->host->user->name,
            'brand_name' => $other->assignment->brand->name,
            'same_host' => $other->assignment->host_id === $hostId,
            'day_of_week' => $other->day_of_week,
            'start_time' => $other->start_time,
            'end_time' => $other->end_time,
        ]);

        return response()->json(['conflicts' => $conflicts]);
    }

    /**
     * Who changed the slot and how, including the slots it continues.
     */
    public function history(ScheduleSlot $schedule): JsonResponse
    {
        $history = AuditLog::with('user:id,name')
            ->where('target_table', $schedule->getTable())
            ->whereIn('target_id', $schedule->lineageIds())
            ->latest('created_at')
            ->limit(30)
            ->get(['id', 'user_id', 'action', 'target_id', 'old_value', 'new_value', 'created_at']);

        return response()->json(['history' => $history]);
    }

    /**
     * Edit times, day, host or period. Locked slots are admin-only.
     * With `apply_from` after the slot started, the weeks before stay as they were.
     */
    public function update(Request $request, ScheduleSlot $schedule): JsonResponse
    {
        $this->ensureCanChange($request, $schedule);

        $request->validate(['apply_from' => 'nullable|date|after_or_equal:today']);
        $applyFrom = $request->date('apply_from')?->startOfDay();

        if ($applyFrom && $applyFrom->gt($schedule->effective_from)) {
            return $this->continueFrom($request, $schedule, $applyFrom);
        }

        $schedule->fill($this->validated($request, $schedule));
        $this->ensureNoConflicts($schedule);
        $schedule->save();

        return response()->json(['slot' => $this->load($schedule), 'message' => 'Slot diperbarui']);
    }

    /**
     * Remove a slot from today (or `from`) on; past weeks keep their history.
     */
    public function destroy(Request $request, ScheduleSlot $schedule): JsonResponse
    {
        $this->ensureCanChange($request, $schedule);

        $request->validate(['from' => 'nullable|date|after_or_equal:today']);
        $schedule->retire($request->date('from'));

        return response()->json(['message' => 'Slot dihapus']);
    }

    /**
     * Take back a slot that was just added, or an edit that continued a slot from a
     * later date. Only shortly after saving, and before anyone went live on it.
     */
    public function undo(Request $request, ScheduleSlot $schedule): JsonResponse
    {
        $this->ensureCanChange($request, $schedule);

        $previous = $schedule->previous;
        $tooLate = $schedule->created_at->lt(now()->subMinutes(self::UNDO_MINUTES))
            || Attendance::where('slot_id', $schedule->id)->exists()
            || (! $previous && BackupRequest::where('slot_id', $schedule->id)->exists());

        if ($tooLate) {
            return response()->json(['message' => 'Perubahan ini sudah tidak bisa diurungkan.'], 422);
        }

        DB::transaction(function () use ($schedule, $previous) {
            if ($previous) {
                BackupRequest::where('slot_id', $schedule->id)->update(['slot_id' => $previous->id]);
            }
            $schedule->delete();
            // The earlier slot runs on with the end date it had before the edit
            $previous?->update(['effective_to' => $this->endBeforeEdit($previous, $schedule)]);
        });

        return response()->json(['slot' => $previous ? $this->load($previous) : null, 'message' => 'Perubahan diurungkan']);
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
            'message' => $validated['is_locked'] ? 'Slot dikunci' : 'Kunci slot dibuka',
        ]);
    }

    /**
     * End the slot the day before `$applyFrom` and continue it, with the changes, as a new slot.
     */
    private function continueFrom(Request $request, ScheduleSlot $schedule, Carbon $applyFrom): JsonResponse
    {
        if ($schedule->effective_to && $schedule->effective_to->lt($applyFrom)) {
            throw ValidationException::withMessages(['apply_from' => ['Slot ini sudah berakhir sebelum tanggal itu.']]);
        }

        $next = $schedule->replicate(['crosses_midnight']);
        $next->fill(['previous_slot_id' => $schedule->id, 'effective_from' => $applyFrom->toDateString()]);
        $next->fill(Arr::except($this->validated($request, $next, partial: true), 'effective_from'));

        DB::transaction(function () use ($schedule, $next, $applyFrom) {
            $schedule->update(['effective_to' => $applyFrom->copy()->subDay()]);
            $this->ensureNoConflicts($next);
            $next->save();

            // Backups already arranged from that date on go with the continuing slot
            BackupRequest::where('slot_id', $schedule->id)
                ->whereDate('backup_date', '>=', $applyFrom)
                ->update(['slot_id' => $next->id]);
        });

        return response()->json([
            'slot' => $this->load($next),
            'previous' => $this->load($schedule),
            'message' => 'Slot diperbarui',
        ]);
    }

    /** The end date `$previous` had before `$next` took over from it. */
    private function endBeforeEdit(ScheduleSlot $previous, ScheduleSlot $next): ?string
    {
        $edit = AuditLog::where('target_table', $previous->getTable())
            ->where('target_id', $previous->id)
            ->where('action', 'update')
            ->latest('created_at')
            ->limit(10)
            ->get()
            ->first(fn (AuditLog $log) => array_key_exists('effective_to', $log->new_value ?? []));

        return $edit ? $edit->old_value['effective_to'] ?? null : $next->effective_to?->toDateString();
    }

    /** `$partial`: only the fields that change (editing, also into a continuing slot). */
    private function validated(Request $request, ScheduleSlot $slot, bool $partial = false): array
    {
        $required = $slot->exists || $partial ? 'sometimes' : 'required';

        $validated = $request->validate([
            'assignment_id' => [
                $required,
                Rule::exists('host_brand_assignments', 'id')->where('status', 'active'),
            ],
            'day_of_week' => ($required === 'required' ? 'required_without:days_of_week' : $required).'|integer|between:1,7',
            'start_time' => "$required|date_format:H:i",
            'end_time' => "$required|date_format:H:i",
            'slot_type' => 'sometimes|in:regular,pd',
            'effective_from' => 'sometimes|date',
            'effective_to' => 'sometimes|nullable|date',
        ], [
            'assignment_id.exists' => 'Pilih host yang aktif di brand ini.',
        ]);

        // Cross-field checks against the merged (existing + new) values
        $start = $validated['start_time'] ?? $slot->start_time;
        $end = $validated['end_time'] ?? $slot->end_time;
        if ($start === $end) {
            throw ValidationException::withMessages(['end_time' => ['Jam selesai harus berbeda dari jam mulai.']]);
        }

        $from = $validated['effective_from'] ?? $slot->effective_from?->toDateString();
        $to = array_key_exists('effective_to', $validated) ? $validated['effective_to'] : $slot->effective_to?->toDateString();
        if ($to !== null && $to < $from) {
            throw ValidationException::withMessages(['effective_to' => ['Tanggal akhir harus sama dengan atau setelah tanggal mulai.']]);
        }

        return $validated;
    }

    /** Several days for a new slot (1 = Monday ... 7 = Sunday), sorted; null when only `day_of_week` was sent. */
    private function days(Request $request): ?array
    {
        $validated = $request->validate([
            'days_of_week' => 'sometimes|array|min:1|max:7',
            'days_of_week.*' => 'integer|between:1,7|distinct',
        ]);

        return isset($validated['days_of_week']) ? collect($validated['days_of_week'])->map(fn ($day) => (int) $day)->sort()->values()->all() : null;
    }

    private function ensureNoConflicts(ScheduleSlot $slot): void
    {
        $clash = $slot->conflicts()->first();

        if ($clash) {
            $who = $clash->assignment->host->user->name;
            $brand = $clash->assignment->brand->name;

            throw ValidationException::withMessages([
                'start_time' => ["Bentrok dengan {$who} di {$brand} ({$clash->label()})."],
            ]);
        }
    }

    private function ensureCanChange(Request $request, ScheduleSlot $slot): void
    {
        abort_if(
            $slot->is_locked && ! $request->user()->hasAnyRole(['admin', 'finance']),
            403,
            'Slot ini dikunci. Hanya admin yang bisa mengubahnya.'
        );
    }

    private function load(ScheduleSlot $slot): ScheduleSlot
    {
        return $slot->load(['assignment.brand:id,name', 'assignment.host.user']);
    }
}
