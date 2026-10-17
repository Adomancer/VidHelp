<?php

namespace App\Http\Controllers\Host;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Operator\BrandKnowledgeController;
use App\Models\Attachment;
use App\Models\BackupRequest;
use App\Models\Brand;
use App\Models\EventSlotClaim;
use App\Models\HostProfile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Symfony\Component\HttpFoundation\StreamedResponse;

class BrandController extends Controller
{
    /**
     * The brands I'm actively assigned to, then the other brands I go live for soon (a backup I
     * cover or an event block I took), each with its product knowledge. `via`: assigned, backup or event.
     */
    public function index(Request $request): JsonResponse
    {
        $profile = $request->user()->hostProfile;

        if (! $profile) {
            return response()->json(['brands' => []]);
        }

        $assigned = $this->assignedIds($profile);
        $covers = $this->coverIds($profile)->diff($assigned);
        $events = $this->eventIds($profile)->diff($assigned)->diff($covers);
        $via = $assigned->mapWithKeys(fn ($id) => [$id => 'assigned'])
            ->union($covers->mapWithKeys(fn ($id) => [$id => 'backup']))
            ->union($events->mapWithKeys(fn ($id) => [$id => 'event']));

        $brands = Brand::query()
            ->whereIn('id', $via->keys())
            ->where('status', 'active')
            ->with('attachments')
            ->get(['id', 'name', 'is_obs', 'product_knowledge'])
            ->map(fn (Brand $brand) => [
                ...$brand->withoutRelations()->toArray(),
                'files' => $brand->attachments,
                'via' => $via[$brand->id],
            ])
            ->sortBy([['via', 'asc'], ['name', 'asc']])
            ->values();

        return response()->json(['brands' => $brands]);
    }

    /**
     * One brand's product knowledge, e.g. opened from a session: a brand I'm assigned to, or one
     * I cover a backup or took an event block for (until a day after it ended).
     */
    public function show(Request $request, Brand $brand): JsonResponse
    {
        $this->ensureLivesFor($request, $brand);

        return response()->json(['brand' => [...$brand->only('id', 'name', 'is_obs', 'product_knowledge'), 'files' => $brand->attachments()->get()]]);
    }

    /** One of the brand's product knowledge files (PDFs and images open in the browser). */
    public function file(Request $request, Brand $brand, Attachment $attachment): StreamedResponse
    {
        $this->ensureLivesFor($request, $brand);

        return BrandKnowledgeController::stream($brand, $attachment);
    }

    /** A brand I'm assigned to, or cover a backup or took an event block for. */
    private function ensureLivesFor(Request $request, Brand $brand): void
    {
        $profile = $request->user()->hostProfile;

        abort_unless(
            $profile && ($this->assignedIds($profile)->contains($brand->id)
                || $this->coverIds($profile)->contains($brand->id)
                || $this->eventIds($profile)->contains($brand->id)),
            403,
            'Kamu tidak live untuk brand ini.'
        );
    }

    /** @return Collection<int, string> */
    private function assignedIds(HostProfile $profile): Collection
    {
        return $profile->assignments()->where('status', 'active')->pluck('brand_id');
    }

    /** Brands of the backups I cover that haven't ended more than a day ago. */
    private function coverIds(HostProfile $profile): Collection
    {
        return BackupRequest::where('filled_by_host_id', $profile->id)
            ->where('status', 'filled')
            ->where('end_at', '>', now()->subDay())
            ->distinct()
            ->pluck('brand_id');
    }

    /** Brands of the event blocks I took that haven't ended more than a day ago. */
    private function eventIds(HostProfile $profile): Collection
    {
        return EventSlotClaim::active()
            ->where('host_id', $profile->id)
            ->where('end_at', '>', now()->subDay())
            ->with('event:id,brand_id')
            ->get()
            ->pluck('event.brand_id')
            ->unique()
            ->values();
    }
}
