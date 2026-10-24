<?php

namespace App\Http\Controllers\Operator;

use App\Http\Controllers\Controller;
use App\Models\Attachment;
use App\Models\Brand;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Throwable;

/**
 * A brand's product knowledge, however the brand sends it: text (often pasted from WA) and
 * files (PDF, screenshots, Office docs). Hosts read it on their Brand page before going live.
 */
class BrandKnowledgeController extends Controller
{
    /** Files a brand's product knowledge can hold. */
    public const MAX_FILES = 30;

    /** PDF and images open in the browser; Office files download. */
    public const MIMES = 'pdf,jpg,jpeg,png,webp,doc,docx,xls,xlsx,ppt,pptx';

    public function show(Brand $brand): JsonResponse
    {
        return response()->json([
            'brand' => $brand->only('id', 'name', 'product_knowledge'),
            'files' => $brand->attachments()->get(),
        ]);
    }

    public function update(Request $request, Brand $brand): JsonResponse
    {
        $brand->update($request->validate(['product_knowledge' => 'present|nullable|string|max:60000']));

        return response()->json(['brand' => $brand->only('id', 'name', 'product_knowledge'), 'message' => 'Product knowledge disimpan']);
    }

    /** Add one file (the page uploads several one by one). */
    public function upload(Request $request, Brand $brand): JsonResponse
    {
        $request->validate(['file' => 'required|file|mimes:'.self::MIMES.'|max:20480']);

        $this->ensureRoomForAnother($brand);

        $file = $request->file('file');
        $path = $file->store("brand-knowledge/{$brand->id}", 'local');

        try {
            $attachment = DB::transaction(function () use ($request, $brand, $file, $path) {
                // The page uploads in parallel: counted again under a lock so uploads can't pass the limit together
                Brand::whereKey($brand->id)->lockForUpdate()->first();
                $this->ensureRoomForAnother($brand);

                return $brand->attachments()->create([
                    'file_path' => $path,
                    'original_name' => $file->getClientOriginalName(),
                    'mime_type' => $file->getMimeType(),
                    'size_kb' => (int) ceil($file->getSize() / 1024),
                    'uploaded_by' => $request->user()->id,
                ]);
            });
        } catch (Throwable $e) {
            Storage::disk('local')->delete($path);
            throw $e;
        }

        return response()->json(['file' => $attachment, 'message' => 'File diunggah'], 201);
    }

    private function ensureRoomForAnother(Brand $brand): void
    {
        if ($brand->attachments()->count() >= self::MAX_FILES) {
            throw ValidationException::withMessages([
                'file' => ['Maksimal '.self::MAX_FILES.' file per brand. Hapus file lama dulu.'],
            ]);
        }
    }

    public function file(Brand $brand, Attachment $attachment): StreamedResponse
    {
        return self::stream($brand, $attachment);
    }

    public function destroy(Brand $brand, Attachment $attachment): JsonResponse
    {
        self::ensureBelongs($brand, $attachment);

        Storage::disk('local')->delete($attachment->file_path);
        $attachment->delete();

        return response()->json(['message' => 'File dihapus']);
    }

    /** Send a product knowledge file inline, so PDFs and images open in the browser. */
    public static function stream(Brand $brand, Attachment $attachment): StreamedResponse
    {
        self::ensureBelongs($brand, $attachment);
        abort_unless(Storage::disk('local')->exists($attachment->file_path), 404, 'File tidak ditemukan.');

        return Storage::disk('local')->response($attachment->file_path, $attachment->original_name);
    }

    private static function ensureBelongs(Brand $brand, Attachment $attachment): void
    {
        abort_unless($attachment->owner_type === $brand->getMorphClass() && $attachment->owner_id === $brand->id, 404);
    }
}
