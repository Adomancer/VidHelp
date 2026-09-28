<?php

namespace App\Http\Controllers\Operator;

use App\Http\Controllers\Controller;
use App\Models\HostBrandAssignment;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class AssignmentController extends Controller
{
    /**
     * Put a host on a brand.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'host_id' => 'required|exists:host_profiles,id',
            'brand_id' => [
                'required',
                Rule::exists('brands', 'id')->where('status', 'active'),
                Rule::unique('host_brand_assignments')->where('host_id', $request->host_id),
            ],
            'is_leader' => 'sometimes|boolean',
        ], [
            'brand_id.unique' => 'This host is already assigned to that brand.',
            'brand_id.exists' => 'Choose an active brand.',
        ]);

        $assignment = $this->save(new HostBrandAssignment(['status' => 'active']), $validated);

        return response()->json(['assignment' => $assignment->load('brand'), 'message' => 'Host assigned'], 201);
    }

    /**
     * Change leader flag or status (inactive/banned instead of deleting, to keep history).
     */
    public function update(Request $request, HostBrandAssignment $assignment): JsonResponse
    {
        $validated = $request->validate([
            'is_leader' => 'sometimes|boolean',
            'status' => 'sometimes|in:active,inactive,banned',
        ]);

        $assignment = $this->save($assignment, $validated);

        return response()->json(['assignment' => $assignment->load('brand'), 'message' => 'Assignment updated']);
    }

    /**
     * A brand has at most one leader, and only an active assignment can lead.
     */
    private function save(HostBrandAssignment $assignment, array $attributes): HostBrandAssignment
    {
        return DB::transaction(function () use ($assignment, $attributes) {
            $assignment->fill($attributes);

            if ($assignment->status !== 'active') {
                $assignment->is_leader = false;
            }

            $assignment->save();

            if ($assignment->is_leader) {
                HostBrandAssignment::where('brand_id', $assignment->brand_id)
                    ->whereKeyNot($assignment->getKey())
                    ->update(['is_leader' => false]);
            }

            return $assignment;
        });
    }
}
