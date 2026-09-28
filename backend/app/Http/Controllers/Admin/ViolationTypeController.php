<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\ViolationType;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class ViolationTypeController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(['violation_types' => ViolationType::orderBy('name')->get()]);
    }

    public function store(Request $request): JsonResponse
    {
        $type = ViolationType::create($this->validated($request));

        return response()->json(['violation_type' => $type, 'message' => 'Violation type added'], 201);
    }

    /**
     * The system code of built-in types can't be changed; switch one off with is_active.
     */
    public function update(Request $request, ViolationType $violationType): JsonResponse
    {
        $violationType->update($this->validated($request, $violationType));

        return response()->json(['violation_type' => $violationType, 'message' => 'Violation type updated']);
    }

    private function validated(Request $request, ?ViolationType $type = null): array
    {
        $required = $type ? 'sometimes' : 'required';

        return $request->validate([
            'name' => [$required, 'string', 'max:100', Rule::unique('violation_types')->ignore($type)],
            'default_points' => "$required|integer|min:0|max:100",
            'rating_impact' => "$required|numeric|min:0|max:4",
            'is_active' => 'sometimes|boolean',
        ]);
    }
}
