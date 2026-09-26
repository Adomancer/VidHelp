<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class FinanceController extends Controller
{
    /**
     * Finance overview — revenue, expenses, profit/loss.
     * TODO: Implement with actual finance models.
     */
    public function index(): JsonResponse
    {
        return response()->json([
            'message' => 'Finance module — to be implemented',
            'overview' => [
                'total_revenue' => 0,
                'total_expenses' => 0,
                'net_profit' => 0,
                'period' => 'monthly',
            ],
        ]);
    }

    /**
     * Payroll summary for hosts.
     * TODO: Implement with salary/commission models.
     */
    public function payroll(): JsonResponse
    {
        return response()->json([
            'message' => 'Payroll module — to be implemented',
            'payroll' => [],
        ]);
    }
}
