<?php

namespace App\Http\Controllers\Operator;

use App\Http\Controllers\Controller;
use App\Models\BackupRequest;
use App\Models\ScheduleSlot;
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
            'active_hosts' => User::role('host')->where('status', 'active')->count(),
            'today_schedules' => ScheduleSlot::activeOn(today())->where('day_of_week', today()->dayOfWeekIso)->count(),
            'pending_backups' => BackupRequest::where('status', 'pending')->where('end_at', '>', now())->count(),
        ];

        return response()->json(['stats' => $stats]);
    }
}
