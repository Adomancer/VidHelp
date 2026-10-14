<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\HostProfile;
use App\Models\HostRating;
use App\Models\PointLog;
use App\Models\WarningLetter;
use App\Services\RatingService;
use App\Services\SpreadsheetExport;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class RatingController extends Controller
{
    private const SOURCE_LABELS = [
        'internal' => 'Pelanggaran',
        'brand_complaint' => 'Komplain brand',
        'backup_cancel' => 'Membatalkan backup (otomatis)',
        'late_attachment' => 'Surat sakit terlambat (otomatis)',
        'late_check_in' => 'Telat check-in (otomatis)',
    ];

    public function __construct(private RatingService $ratings)
    {
    }

    /**
     * Every active host for a month (default this month): suggestion, violations, current rating.
     */
    public function index(Request $request): JsonResponse
    {
        $month = $this->month($request);

        return response()->json(['month' => $month, 'scale' => config('vidhelp.rating'), 'hosts' => $this->rows($month)]);
    }

    /**
     * The month as Excel: ratings, plus the point history and SP letters of that month.
     */
    public function export(Request $request, SpreadsheetExport $export): BinaryFileResponse
    {
        $month = $this->month($request);
        $first = CarbonImmutable::parse("{$month}-01");
        $range = [$first->toDateString(), $first->endOfMonth()->toDateString()];

        $ratings = $this->rows($month)->map(fn (array $row) => [
            $row['name'],
            $row['violations'],
            $row['suggested'],
            $row['rating']?->rating,
            $row['rating']?->note,
            $row['rating']?->rater?->name,
        ]);

        $logs = PointLog::query()
            ->whereBetween('occurred_on', $range)
            ->with(['host.user:id,name', 'violationType:id,name', 'recorder:id,name', 'brandComplaint.brand:id,name'])
            ->orderBy('occurred_on')
            ->oldest()
            ->get()
            ->map(fn (PointLog $log) => [
                $log->occurred_on->toDateString(),
                $log->host->user->name,
                $this->logLabel($log),
                $log->points_change,
                $log->reason,
                $log->recorder?->name ?? 'Otomatis',
                $log->voided_at ? 'Ya' : 'Tidak',
            ]);

        $letters = WarningLetter::query()
            ->whereBetween('issued_at', [$first->startOfDay(), $first->endOfMonth()->endOfDay()])
            ->with(['host.user:id,name', 'issuer:id,name'])
            ->orderBy('issued_at')
            ->get()
            ->map(fn (WarningLetter $letter) => [
                $letter->issued_at->format('Y-m-d H:i'),
                $letter->host->user->name,
                "SP{$letter->level}",
                $letter->reason,
                $letter->issuer?->name ?? 'Otomatis',
                $letter->voided_at ? 'Ya' : 'Tidak',
            ]);

        return $export->download("ratings-{$month}.xlsx", [
            'Rating' => [['Host', 'Pelanggaran', 'Saran', 'Rating', 'Catatan', 'Dinilai oleh'], $ratings],
            'Riwayat poin' => [['Tanggal', 'Host', 'Jenis', 'Poin', 'Alasan', 'Dicatat oleh', 'Dibatalkan'], $logs],
            'Riwayat SP' => [['Terbit', 'Host', 'Level', 'Alasan', 'Diterbitkan oleh', 'Dibatalkan'], $letters],
        ]);
    }

    /**
     * One host's full point and SP history across all periods, newest first.
     */
    public function history(HostProfile $host): JsonResponse
    {
        return response()->json([
            'logs' => $host->pointLogs()
                ->with(['violationType:id,name', 'recorder:id,name', 'brandComplaint.brand:id,name'])
                ->latest('occurred_on')
                ->latest()
                ->get(),
            'warning_letters' => $host->warningLetters()->with('issuer:id,name')->latest('issued_at')->get(),
        ]);
    }

    public function upsert(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'host_id' => 'required|exists:host_profiles,id',
            'month_year' => 'required|date_format:Y-m',
            'rating' => 'required|numeric|min:'.config('vidhelp.rating.min').'|max:'.config('vidhelp.rating.max'),
            'note' => 'nullable|string|max:255',
        ]);

        $rating = $this->ratings->rate(
            HostProfile::findOrFail($validated['host_id']),
            $validated['month_year'],
            (float) $validated['rating'],
            $validated['note'] ?? null,
            $request->user(),
        );

        return response()->json(['rating' => $rating, 'message' => 'Rating disimpan']);
    }

    private function month(Request $request): string
    {
        $request->validate(['month' => 'nullable|date_format:Y-m']);

        return $request->month ?? now()->format('Y-m');
    }

    private function rows(string $month): Collection
    {
        $first = CarbonImmutable::parse("{$month}-01");

        $ratings = HostRating::where('month_year', $month)->with('rater:id,name')->get()->keyBy('host_id');
        $violations = PointLog::counting()
            ->whereNotNull('violation_type_id')
            ->whereBetween('occurred_on', [$first->toDateString(), $first->endOfMonth()->toDateString()])
            ->selectRaw('host_id, count(*) as total')->groupBy('host_id')->pluck('total', 'host_id');

        return HostProfile::query()
            ->where('status', 'active')
            ->whereHas('user', fn ($q) => $q->where('status', 'active'))
            ->with('user')
            ->get()
            ->map(fn (HostProfile $host) => [
                'host_id' => $host->id,
                'name' => $host->user->name,
                'avatar_url' => $host->user->avatar_url,
                'violations' => (int) ($violations[$host->id] ?? 0),
                'suggested' => $this->ratings->suggested($host, $month),
                'rating' => $ratings->get($host->id),
            ])
            ->sortBy('name')
            ->values();
    }

    private function logLabel(PointLog $log): string
    {
        $label = $log->violationType->name ?? self::SOURCE_LABELS[$log->source];

        return $log->brandComplaint ? "{$label} · {$log->brandComplaint->brand->name}" : $label;
    }
}
