<?php

namespace App\Http\Controllers\Operator;

use App\Http\Controllers\Controller;
use App\Models\HostBrandAssignment;
use App\Models\HostProfile;
use App\Models\User;
use App\Services\SpreadsheetExport;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class HostController extends Controller
{
    /**
     * Hosts with their rate level and brand assignments. No KTP/bank data.
     */
    public function index(Request $request): JsonResponse
    {
        return response()->json($this->filtered($request)->paginate(20));
    }

    /**
     * The same list (same filters, every page) as an Excel file. No KTP/bank data.
     */
    public function export(Request $request, SpreadsheetExport $export): BinaryFileResponse
    {
        $rows = $this->filtered($request)->get()->map(fn (HostProfile $host) => [
            $host->user->name,
            $host->user->email,
            $host->phone,
            $host->guardian_phone,
            match ($host->status) { 'active' => 'Aktif', 'inactive' => 'Nonaktif', 'archived' => 'Diarsipkan', 'banned' => 'Diblokir', default => $host->status },
            $host->rateCategory?->name,
            $host->join_date?->toDateString(),
            $host->assignments
                ->where('status', 'active')
                ->map(fn (HostBrandAssignment $assignment) => $assignment->brand->name.($assignment->is_leader ? ' (leader)' : ''))
                ->join(', '),
        ]);

        return $export->download('hosts-'.today()->toDateString().'.xlsx', [
            'Host' => [['Nama', 'Email', 'No. HP', 'No. HP wali', 'Status', 'Level tarif', 'Tanggal bergabung', 'Brand'], $rows],
        ]);
    }

    private function filtered(Request $request): Builder
    {
        return HostProfile::query()
            ->with(['user', 'rateCategory:id,name', 'assignments.brand:id,name'])
            ->when($request->search, fn ($q, $search) => $q->whereHas('user', fn ($q) => $q
                ->where('name', 'like', "%{$search}%")
                ->orWhere('email', 'like', "%{$search}%")))
            ->when($request->brand_id, fn ($q, $brandId) => $q->whereHas('assignments', fn ($q) => $q
                ->where('brand_id', $brandId)
                ->where('status', 'active')))
            ->when($request->status, fn ($q, $status) => $q->where('status', $status))
            ->orderBy(
                User::select('name')->whereColumn('users.id', 'host_profiles.user_id')
            );
    }
}
