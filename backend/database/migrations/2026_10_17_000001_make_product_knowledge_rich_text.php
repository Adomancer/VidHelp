<?php

use App\Services\RichText;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Product knowledge becomes formatted text (HTML): more room, and the plain text saved so far
     * converted (WA's *bold*, lists, paragraphs, links).
     */
    public function up(): void
    {
        Schema::table('brands', function (Blueprint $table) {
            $table->mediumText('product_knowledge')->nullable()->change();
        });

        DB::table('brands')->whereNotNull('product_knowledge')->get(['id', 'product_knowledge'])
            ->each(fn ($brand) => DB::table('brands')->where('id', $brand->id)->update([
                'product_knowledge' => RichText::normalize($brand->product_knowledge),
            ]));
    }

    public function down(): void
    {
        Schema::table('brands', function (Blueprint $table) {
            $table->text('product_knowledge')->nullable()->change();
        });
    }
};
