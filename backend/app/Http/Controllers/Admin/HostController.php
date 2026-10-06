<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\HostProfile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class HostController extends Controller
{
    /**
     * Full host profile, including decrypted KTP and bank numbers.
     */
    public function show(HostProfile $host): JsonResponse
    {
        return response()->json(['host' => $this->load($host)]);
    }

    /**
     * Admin-only fields: join date, status and rate level. Sending
     * rate_category_id pins the level by hand; sending null returns it to automatic.
     */
    public function update(Request $request, HostProfile $host): JsonResponse
    {
        $validated = $request->validate([
            'phone' => 'sometimes|nullable|digits_between:8,15',
            'guardian_phone' => 'sometimes|nullable|digits_between:8,15',
            'join_date' => 'sometimes|date|before_or_equal:today',
            'rate_category_id' => 'sometimes|nullable|exists:host_rate_categories,id',
        ]);

        if (array_key_exists('rate_category_id', $validated)) {
            $validated['rate_category_overridden'] = $validated['rate_category_id'] !== null;
        }

        $host->fill($validated);
        $host->syncRateCategory(); // no-op when overridden
        $host->save();

        return response()->json(['host' => $this->load($host), 'message' => 'Host diperbarui']);
    }

    /**
     * Stream the KTP photo from private storage.
     */
    public function ktpImage(HostProfile $host): StreamedResponse
    {
        $path = $host->sensitiveData?->ktp_image_path;
        abort_unless($path && Storage::disk('local')->exists($path), 404, 'Belum ada foto KTP.');

        return Storage::disk('local')->response($path);
    }

    private function load(HostProfile $host): HostProfile
    {
        $host->load(['user.roles', 'rateCategory', 'sensitiveData', 'assignments.brand']);
        $host->sensitiveData?->makeVisible(['ktp_number', 'bank_account']);

        return $host;
    }
}
