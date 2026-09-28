<?php

namespace App\Http\Controllers\Host;

use App\Http\Controllers\Controller;
use App\Models\HostProfile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class AvailabilityController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        return response()->json(['availability' => $this->profile($request)->availability]);
    }

    /**
     * Replace all my availability ranges at once.
     */
    public function update(Request $request): JsonResponse
    {
        $profile = $this->profile($request);

        $validated = $request->validate([
            'ranges' => 'present|array|max:50',
            'ranges.*.day_of_week' => 'required|integer|between:1,7',
            'ranges.*.available_from' => 'required|date_format:H:i',
            'ranges.*.available_to' => 'required|date_format:H:i',
            'ranges.*.note' => 'nullable|string|max:255',
        ]);

        foreach ($validated['ranges'] as $index => $range) {
            if ($range['available_from'] === $range['available_to']) {
                throw ValidationException::withMessages(["ranges.$index.available_to" => ['End time must differ from start time.']]);
            }
        }

        DB::transaction(function () use ($profile, $validated) {
            $profile->availability()->delete();
            $profile->availability()->createMany($validated['ranges']);
        });

        return response()->json(['availability' => $profile->availability()->get(), 'message' => 'Availability saved']);
    }

    private function profile(Request $request): HostProfile
    {
        return $request->user()->hostProfile ?? abort(404, 'You do not have a host profile.');
    }
}
