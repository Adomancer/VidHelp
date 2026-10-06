<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\SettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Business rules the admin can change without touching code.
 */
class SettingsController extends Controller
{
    public function __construct(private SettingsService $settings) {}

    public function index(): JsonResponse
    {
        return response()->json(['groups' => $this->settings->all()]);
    }

    public function update(Request $request): JsonResponse
    {
        $validated = $request->validate(['values' => 'required|array']);

        $changed = $this->settings->update($validated['values'], $request->user());

        return response()->json([
            'groups' => $this->settings->all(),
            'message' => match (count($changed)) {
                0 => 'Tidak ada yang berubah.',
                1 => 'Pengaturan disimpan.',
                default => count($changed).' pengaturan disimpan.',
            },
        ]);
    }
}
