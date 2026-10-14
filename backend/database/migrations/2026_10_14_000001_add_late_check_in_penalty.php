<?php

use App\Models\ViolationType;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Checking in more than 10 minutes late deducts the "Telat" violation automatically.
     */
    public function up(): void
    {
        Schema::table('point_logs', function (Blueprint $table) {
            $table->enum('source', ['internal', 'brand_complaint', 'backup_cancel', 'late_attachment', 'late_check_in'])->change();
        });

        // Operators recorded "Telat" by hand until now; the system applies it from here on
        DB::table('violation_types')
            ->where('name', 'Telat')
            ->whereNull('code')
            ->update(['code' => ViolationType::LATE_CHECK_IN]);
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        DB::table('violation_types')->where('code', ViolationType::LATE_CHECK_IN)->update(['code' => null]);
        DB::table('point_logs')->where('source', 'late_check_in')->update(['source' => 'internal']);

        Schema::table('point_logs', function (Blueprint $table) {
            $table->enum('source', ['internal', 'brand_complaint', 'backup_cancel', 'late_attachment'])->change();
        });
    }
};
