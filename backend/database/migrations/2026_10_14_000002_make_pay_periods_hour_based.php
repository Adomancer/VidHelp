<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A brand's pay period no longer lasts a set number of days: it runs until the brand's
     * target hours are reached (or an admin closes it early), then the next one starts.
     */
    public function up(): void
    {
        Schema::table('payment_periods', function (Blueprint $table) {
            // Null while the period is still running
            $table->date('period_end')->nullable()->change();
            $table->dateTime('closed_at')->nullable()->after('status');
            // Null = closed by reaching the target; set = closed early by this admin/finance user
            $table->foreignUuid('closed_by')->nullable()->after('closed_at')->constrained('users')->nullOnDelete();
        });

        // Running periods keep going until their target is reached
        DB::table('payment_periods')->where('status', 'in_progress')->update(['period_end' => null]);
        DB::table('payment_periods')->whereNot('status', 'in_progress')->update(['closed_at' => DB::raw('updated_at')]);

        Schema::table('brands', function (Blueprint $table) {
            $table->dropColumn('payment_cycle_days');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('brands', function (Blueprint $table) {
            $table->unsignedSmallInteger('payment_cycle_days')->default(30)->after('target_hours_per_period');
        });

        DB::table('payment_periods')->whereNull('period_end')->update(['period_end' => DB::raw('period_start')]);

        Schema::table('payment_periods', function (Blueprint $table) {
            $table->dropConstrainedForeignId('closed_by');
            $table->dropColumn('closed_at');
            $table->date('period_end')->nullable(false)->change();
        });
    }
};
