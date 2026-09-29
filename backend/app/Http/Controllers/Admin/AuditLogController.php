<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The audit trail: who changed what, and every sign-in.
 */
class AuditLogController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'action' => 'nullable|string|max:50',
            'target_table' => 'nullable|string|max:100',
            'target_id' => 'nullable|uuid',
            'user_id' => 'nullable|uuid',
            'search' => 'nullable|string|max:100',
            'from' => 'nullable|date',
            'to' => 'nullable|date|after_or_equal:from',
        ]);

        $logs = AuditLog::with('user:id,name,email')
            ->when($filters['action'] ?? null, fn ($q, $action) => $q->where('action', $action))
            ->when($filters['target_table'] ?? null, fn ($q, $table) => $q->where('target_table', $table))
            ->when($filters['target_id'] ?? null, fn ($q, $id) => $q->where('target_id', $id))
            ->when($filters['user_id'] ?? null, fn ($q, $id) => $q->where('user_id', $id))
            ->when($filters['from'] ?? null, fn ($q, $from) => $q->where('created_at', '>=', $from.' 00:00:00'))
            ->when($filters['to'] ?? null, fn ($q, $to) => $q->where('created_at', '<=', $to.' 23:59:59'))
            ->when($filters['search'] ?? null, fn ($q, $search) => $q->where(fn ($q) => $q
                ->where('target_label', 'like', "%{$search}%")
                ->orWhere('ip_address', 'like', "%{$search}%")
                ->orWhereHas('user', fn ($q) => $q->where('name', 'like', "%{$search}%")->orWhere('email', 'like', "%{$search}%"))))
            ->latest('created_at')
            ->paginate(50);

        return response()->json([
            'logs' => $logs,
            'actions' => AuditLog::distinct()->orderBy('action')->pluck('action'),
            'target_tables' => AuditLog::whereNotNull('target_table')->distinct()->orderBy('target_table')->pluck('target_table'),
        ]);
    }
}
