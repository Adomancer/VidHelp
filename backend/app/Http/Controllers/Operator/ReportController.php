<?php

namespace App\Http\Controllers\Operator;

use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\LiveReport;
use App\Services\AttendanceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ReportController extends Controller
{
    public function __construct(private AttendanceService $attendance)
    {
    }

    /**
     * Live reports by status, or `missing`: check-ins whose report is overdue.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'status' => 'nullable|in:flagged,approved,rejected,missing',
            'brand_id' => 'nullable|uuid',
        ]);
        $status = $request->status ?? 'flagged';

        if ($status === 'missing') {
            $missing = Attendance::whereDoesntHave('report')
                ->where('report_due_at', '<', now())
                ->when($request->brand_id, fn ($q, $id) => $q->where('brand_id', $id))
                ->with(['brand:id,name', 'host.user'])
                ->latest('scheduled_start_at')
                ->limit(100)
                ->get();

            return response()->json(['attendances' => $missing]);
        }

        $reports = LiveReport::where('status', $status)
            ->when($request->brand_id, fn ($q, $id) => $q->where('brand_id', $id))
            ->with(['brand:id,name', 'host.user', 'attendance', 'reviewer:id,name', 'workSession'])
            ->latest('submitted_at')
            ->limit(100)
            ->get()
            ->map(fn (LiveReport $report) => [
                ...$report->toArray(),
                'scheduled_hours' => $report->attendance->scheduledHours(),
                'attended_hours' => $report->attendance->attendedHours(),
            ]);

        return response()->json(['reports' => $reports, 'metrics' => array_keys(config('vidhelp.report_metrics'))]);
    }

    /**
     * Accept a report; `duration_hours` is what gets paid (defaults to what the host reported).
     */
    public function approve(Request $request, LiveReport $report): JsonResponse
    {
        $validated = $request->validate([
            'duration_hours' => 'nullable|numeric|min:0|max:24',
            'review_note' => 'nullable|string|max:255',
        ]);

        $this->attendance->approve(
            $report->load('attendance'),
            $request->user(),
            round((float) ($validated['duration_hours'] ?? $report->duration_hours), 2),
            $validated['review_note'] ?? null,
        );

        return response()->json(['message' => 'Report approved']);
    }

    public function reject(Request $request, LiveReport $report): JsonResponse
    {
        $validated = $request->validate(['review_note' => 'required|string|max:255']);

        $this->attendance->reject($report, $request->user(), $validated['review_note']);

        return response()->json(['message' => 'Report rejected']);
    }
}
