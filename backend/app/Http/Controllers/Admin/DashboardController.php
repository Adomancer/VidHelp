<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DashboardController extends Controller
{
    /**
     * Admin overview dashboard.
     */
    public function index(): JsonResponse
    {
        $stats = [
            'total_hosts' => User::role('host')->count(),
            'active_hosts' => User::role('host')->where('status', 'active')->count(),
            'total_operators' => User::role('operator')->count(),
            'total_users' => User::count(),
        ];

        return response()->json(['stats' => $stats]);
    }
}
