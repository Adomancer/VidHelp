<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\ProfileChangeRequest;
use App\Services\ProfileChangeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Hosts' requests to add or change their personal data: what is saved now next to what they
 * asked for (full KTP and bank numbers, admins only), then approve or reject.
 */
class ProfileChangeController extends Controller
{
    public function __construct(private ProfileChangeService $changes) {}

    /**
     * `status`: pending (default, oldest first) or decided (latest 50).
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate(['status' => 'nullable|in:pending,decided']);
        $pending = ($request->status ?? 'pending') === 'pending';

        $requests = ProfileChangeRequest::query()
            ->with(['host.user', 'host.sensitiveData', 'reviewer:id,name'])
            ->when($pending, fn ($q) => $q->where('status', 'pending')->oldest())
            ->when(! $pending, fn ($q) => $q->whereIn('status', ['approved', 'rejected'])->latest('reviewed_at')->limit(50))
            ->get()
            ->map(function (ProfileChangeRequest $change) {
                $current = $this->changes->current($change->host);

                return [
                    'id' => $change->id,
                    'status' => $change->status,
                    'version' => $change->version(),
                    'host' => [
                        'id' => $change->host->id,
                        'name' => $change->host->user->name,
                        'email' => $change->host->user->email,
                        'avatar_url' => $change->host->user->avatar_url,
                    ],
                    'fields' => array_map(fn (array $line) => [...$line, 'current' => $current[$line['field']] ?? null], $change->lines(full: true)),
                    'created_at' => $change->created_at,
                    'reviewed_at' => $change->reviewed_at,
                    'reviewer' => $change->reviewer?->name,
                    'review_note' => $change->review_note,
                ];
            });

        return response()->json([
            'requests' => $requests,
            'pending_count' => $pending ? $requests->count() : ProfileChangeRequest::where('status', 'pending')->count(),
        ]);
    }

    /**
     * `version`: the one the admin reviewed (from the list); refused if the host changed the request since.
     */
    public function approve(Request $request, ProfileChangeRequest $change): JsonResponse
    {
        $validated = $request->validate(['version' => 'required|string']);

        $this->changes->approve($change, $request->user(), $validated['version']);

        return response()->json(['message' => 'Perubahan data disetujui']);
    }

    public function reject(Request $request, ProfileChangeRequest $change): JsonResponse
    {
        $validated = $request->validate(['note' => 'required|string|max:255'], ['note.required' => 'Tulis alasannya supaya host tahu apa yang perlu diperbaiki.']);

        $this->changes->reject($change, $request->user(), $validated['note']);

        return response()->json(['message' => 'Perubahan data ditolak']);
    }
}
