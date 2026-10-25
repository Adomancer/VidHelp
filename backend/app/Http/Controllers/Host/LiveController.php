<?php

namespace App\Http\Controllers\Host;

use App\Http\Controllers\Controller;
use App\Models\Attendance;
use App\Models\HostProfile;
use App\Services\AttendanceService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LiveController extends Controller
{
    public function __construct(private AttendanceService $attendance) {}

    /**
     * My sessions from yesterday to tomorrow (check in/out, write report), plus
     * older sessions from the last week still missing a report.
     */
    public function index(Request $request): JsonResponse
    {
        $host = $this->host($request);

        $sessions = $this->attendance->sessions($host, now()->subDay(), now()->addDay());

        $missing = Attendance::where('host_id', $host->id)
            ->whereDoesntHave('report')
            ->where('scheduled_end_at', '<=', now()->subDay())
            ->where('scheduled_end_at', '>', now()->subWeek())
            ->with('brand:id,name')
            ->orderBy('scheduled_start_at')
            ->get();

        return response()->json([
            'sessions' => $sessions,
            'missing_reports' => $missing,
            'metrics' => array_keys(config('vidhelp.report_metrics')),
        ]);
    }

    public function checkIn(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'slot_id' => 'required_without:event_claim_id|nullable|uuid',
            'date' => 'required_without:event_claim_id|nullable|date_format:Y-m-d',
            'backup_request_id' => 'nullable|uuid',
            'event_claim_id' => 'nullable|uuid',
        ]);

        $attendance = $this->attendance->checkIn(
            $this->host($request),
            $validated['slot_id'] ?? null,
            $validated['date'] ?? null,
            $validated['backup_request_id'] ?? null,
            $validated['event_claim_id'] ?? null,
        );

        $message = $attendance->late_minutes > 0
            ? "Berhasil check-in, tapi telat {$attendance->late_minutes} menit; poin Telat dipotong. Selamat live!"
            : 'Berhasil check-in. Selamat live!';

        return response()->json(['attendance' => $attendance, 'message' => $message], 201);
    }

    public function checkOut(Request $request, Attendance $attendance): JsonResponse
    {
        $this->ensureMine($request, $attendance);

        $this->attendance->checkOut($attendance);

        return response()->json(['attendance' => $attendance, 'message' => 'Berhasil check-out. Jangan lupa kirim laporanmu.']);
    }

    /**
     * Send the live report. Auto-approved if it matches the schedule, otherwise flagged for review.
     */
    public function report(Request $request, Attendance $attendance): JsonResponse
    {
        $this->ensureMine($request, $attendance);

        $metricRules = collect(config('vidhelp.report_metrics'))->mapWithKeys(fn ($rule, $key) => ["metrics.$key" => $rule])->all();

        $validated = $request->validate([
            'session_count' => 'required|integer|min:1|max:50',
            'duration_hours' => 'required|numeric|min:0.01|max:24',
            'metrics' => 'nullable|array',
            ...$metricRules,
            'notes' => 'nullable|string|max:2000',
        ]);
        $validated['metrics'] = array_intersect_key($validated['metrics'] ?? [], config('vidhelp.report_metrics'));
        $validated['duration_hours'] = round((float) $validated['duration_hours'], 2); // as stored (decimal 5,2)

        $report = $this->attendance->submitReport($attendance->load('report'), $validated);

        return response()->json([
            'report' => $report,
            'message' => $report->status === 'approved'
                ? 'Laporan disetujui. Jam ini dihitung untuk gajimu.'
                : 'Laporan terkirim. Operator akan mengeceknya.',
        ]);
    }

    private function host(Request $request): HostProfile
    {
        return $request->user()->hostProfile ?? abort(404, 'Kamu tidak punya profil host.');
    }

    private function ensureMine(Request $request, Attendance $attendance): void
    {
        abort_unless($attendance->host_id === $this->host($request)->id, 403, 'Ini bukan sesimu.');
    }
}
