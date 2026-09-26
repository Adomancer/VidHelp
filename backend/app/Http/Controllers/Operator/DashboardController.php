<?php

namespace App\Http\Controllers\Operator;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DashboardController extends Controller
{
    /**
     * Operator overview dashboard.
     */
    public function index(): JsonResponse
    {
        $stats = [
            'total_hosts' => User::role('host')->count(),
            'active_hosts' => User::role('host')->where('is_active', true)->count(),
            // TODO: Add schedule stats when schedule model exists
            'today_schedules' => 0,
            'pending_backups' => 0,
        ];

        return response()->json(['stats' => $stats]);
    }
}
