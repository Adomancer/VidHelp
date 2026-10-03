<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Product knowledge: what hosts assigned to the brand need to know before going live.
     */
    public function up(): void
    {
        Schema::table('brands', function (Blueprint $table) {
            $table->text('product_knowledge')->nullable()->after('is_obs');
        });
    }

    public function down(): void
    {
        Schema::table('brands', function (Blueprint $table) {
            $table->dropColumn('product_knowledge');
        });
    }
};
