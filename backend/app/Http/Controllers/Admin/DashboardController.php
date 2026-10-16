<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\DashboardService;
use Illuminate\Http\JsonResponse;

class DashboardController extends Controller
{
    public function __construct(private DashboardService $dashboard) {}

    /**
     * Admin overview: what needs attention, today's sessions, backups without a cover, brand progress, recent hours, people.
     */
    public function index(): JsonResponse
    {
        return response()->json($this->dashboard->admin());
    }
}
