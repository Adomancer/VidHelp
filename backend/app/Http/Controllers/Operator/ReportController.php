<?php

namespace App\Http\Controllers\Operator;

use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\LiveReport;
use App\Services\AttendanceService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

class ReportController extends Controller
{
    /** Reports per page: compact rows, so a reviewer sees many at once. */
    private const PER_PAGE = 30;

    public function __construct(private AttendanceService $attendance) {}

    /**
     * Live reports by status, or `missing`: check-ins whose report is overdue. A page at a time,
     * optionally for one session `date` and a host or brand name (`search`). Flagged reports
     * come oldest first (a queue); the rest newest first. `counts` sizes both queues for the tabs.
     */
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'status' => 'nullable|in:flagged,approved,rejected,missing',
            'brand_id' => 'nullable|uuid',
            'date' => 'nullable|date_format:Y-m-d',
            'search' => 'nullable|string|max:100',
        ]);
        $status = $validated['status'] ?? 'flagged';
        $search = $validated['search'] ?? null;
        $matchesSearch = fn ($q) => $q->where(fn ($q) => $q
            ->whereHas('host.user', fn ($q) => $q->where('name', 'like', "%{$search}%"))
            ->orWhereHas('brand', fn ($q) => $q->where('name', 'like', "%{$search}%")));
        $counts = [
            'flagged' => LiveReport::where('status', 'flagged')->count(),
            'missing' => $this->overdue()->count(),
        ];

        if ($status === 'missing') {
            $missing = $this->overdue()
                ->when($validated['brand_id'] ?? null, fn ($q, $id) => $q->where('brand_id', $id))
                ->when($validated['date'] ?? null, fn ($q, $date) => $q->whereDate('session_date', $date))
                ->when($search, $matchesSearch)
                ->with(['brand:id,name', 'host.user'])
                ->latest('scheduled_start_at')
                ->paginate(self::PER_PAGE);

            return response()->json([...$missing->toArray(), 'counts' => $counts]);
        }

        $reports = LiveReport::where('status', $status)
            ->when($validated['brand_id'] ?? null, fn ($q, $id) => $q->where('brand_id', $id))
            ->when($validated['date'] ?? null, fn ($q, $date) => $q->whereHas('attendance', fn ($q) => $q->whereDate('session_date', $date)))
            ->when($search, $matchesSearch)
            ->with(['brand:id,name', 'host.user', 'attendance', 'reviewer:id,name', 'workSession'])
            ->orderBy('submitted_at', $status === 'flagged' ? 'asc' : 'desc')
            ->paginate(self::PER_PAGE)
            ->through(fn (LiveReport $report) => [
                ...$report->toArray(),
                'scheduled_hours' => $report->attendance->scheduledHours(),
                'attended_hours' => $report->attendance->attendedHours(),
            ]);

        return response()->json([...$reports->toArray(), 'metrics' => array_keys(config('vidhelp.report_metrics')), 'counts' => $counts]);
    }

    /** Check-ins whose report is past its deadline and still not sent. */
    private function overdue(): Builder
    {
        return Attendance::whereDoesntHave('report')->where('report_due_at', '<', now());
    }

    /**
     * Accept a report; `duration_hours` is what gets paid (defaults to what the host reported).
     */
    public function approve(Request $request, LiveReport $report): JsonResponse
    {
        $validated = $request->validate([
            'duration_hours' => 'nullable|numeric|gt:0|max:24',
            'review_note' => 'nullable|string|max:255',
        ]);

        // Paid hours: at most the schedule plus the time check-out stays open (a typo like 20 for 2,0 would be paid)
        $report->load('attendance');
        $hours = round((float) ($validated['duration_hours'] ?? $report->duration_hours), 2);
        $maxHours = round($report->attendance->scheduledHours() + config('vidhelp.attendance.check_out_closes_minutes') / 60, 2);
        if ($hours <= 0 || $hours > $maxHours) {
            $label = rtrim(rtrim(number_format($maxHours, 2, ',', ''), '0'), ',');
            throw ValidationException::withMessages(['duration_hours' => ["Durasi harus lebih dari 0 dan paling lama {$label} jam untuk sesi ini."]]);
        }

        $this->attendance->approve($report, $request->user(), $hours, $validated['review_note'] ?? null);

        return response()->json(['message' => 'Laporan disetujui']);
    }

    public function reject(Request $request, LiveReport $report): JsonResponse
    {
        $validated = $request->validate(['review_note' => 'required|string|max:255']);

        $this->attendance->reject($report, $request->user(), $validated['review_note']);

        return response()->json(['message' => 'Laporan ditolak']);
    }
}
