<?php

namespace App\Http\Controllers;

use App\Services\SettingsService;
use Illuminate\Http\JsonResponse;

/**
 * The few rule numbers every signed-in user sees in help texts (backup timings, quota).
 */
class SettingsController extends Controller
{
    public function __construct(private SettingsService $settings) {}

    public function index(): JsonResponse
    {
        return response()->json(['settings' => $this->settings->publicValues()]);
    }
}
