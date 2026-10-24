<?php

namespace App\Http\Controllers\Operator;

use App\Http\Controllers\Controller;
use App\Models\Brand;
use App\Models\HostBrandAssignment;
use App\Services\AccountService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class AssignmentController extends Controller
{
    public function __construct(private AccountService $accounts) {}

    /**
     * Put a host on a brand.
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'host_id' => ['required', Rule::exists('host_profiles', 'id')->where('status', 'active')],
            'brand_id' => [
                'required',
                Rule::exists('brands', 'id')->where('status', 'active'),
                Rule::unique('host_brand_assignments')->where('host_id', $request->host_id),
            ],
            'is_leader' => 'sometimes|boolean',
        ], [
            'brand_id.unique' => 'Host ini sudah ditugaskan ke brand itu.',
            'brand_id.exists' => 'Pilih brand yang aktif.',
            'host_id.exists' => 'Pilih host yang aktif.',
        ]);

        $assignment = $this->save(new HostBrandAssignment(['status' => 'active']), $validated);

        return response()->json(['assignment' => $assignment->load('brand'), 'message' => 'Host ditugaskan'], 201);
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

        return response()->json(['assignment' => $assignment->load('brand'), 'message' => 'Penugasan diperbarui']);
    }

    /**
     * A brand has at most one leader, and only an active assignment can lead. A host who leaves
     * (or is banned from) a brand comes off its schedule and gives up what they had coming there.
     */
    private function save(HostBrandAssignment $assignment, array $attributes): HostBrandAssignment
    {
        [$assignment, $leftBrand] = DB::transaction(function () use ($assignment, $attributes) {
            // One change per brand at a time, so two hosts made leader at once can't both stay leader
            Brand::whereKey($attributes['brand_id'] ?? $assignment->brand_id)->lockForUpdate()->first();

            $assignment->fill($attributes);

            if ($assignment->status !== 'active') {
                $assignment->is_leader = false;
            }

            $leftBrand = $assignment->exists && $assignment->isDirty('status') && $assignment->status !== 'active';
            $assignment->save();

            // A host who leaves a brand stops appearing on its schedule from today
            if ($leftBrand) {
                $assignment->slots()->where('status', 'active')->get()->each->retire();
            }

            if ($assignment->is_leader) {
                HostBrandAssignment::where('brand_id', $assignment->brand_id)
                    ->whereKeyNot($assignment->getKey())
                    ->update(['is_leader' => false]);
            }

            return [$assignment, $leftBrand];
        });

        // Backups, covers, applications and event blocks on this brand (they notify people)
        if ($leftBrand) {
            $this->accounts->takeOffBrand($assignment->host, $assignment->brand_id);
        }

        return $assignment;
    }
}
