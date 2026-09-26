<?php

namespace App\Http\Controllers\Operator;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class BackupHostController extends Controller
{
    /**
     * List available backup hosts.
     * TODO: Implement with backup host assignment logic.
     */
    public function index(): JsonResponse
    {
        return response()->json([
            'message' => 'Backup host listing — to be implemented',
            'backup_hosts' => [],
        ]);
    }

    /**
     * Assign a backup host to a schedule.
     */
    public function assign(Request $request): JsonResponse
    {
        return response()->json([
            'message' => 'Backup host assignment — to be implemented',
        ]);
    }
}
