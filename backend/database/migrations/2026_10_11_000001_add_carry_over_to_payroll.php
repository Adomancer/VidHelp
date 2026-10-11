<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Hosts are paid only up to the brand's target; the rest of their hours carry to the next
     * period. Backups the requesting host pays for directly stay off payroll. Payments get a
     * transfer reference.
     */
    public function up(): void
    {
        Schema::table('payment_items', function (Blueprint $table) {
            // hours = hours paid in this period (carried in + worked, minus what carried out)
            $table->decimal('carried_in_hours', 8, 2)->default(0)->after('session_count');
            $table->decimal('worked_hours', 8, 2)->default(0)->after('carried_in_hours');
            $table->decimal('carried_out_hours', 8, 2)->default(0)->after('hours');
        });

        // Items locked before carry-over: everything worked was paid
        DB::table('payment_items')->update(['worked_hours' => DB::raw('hours')]);

        Schema::table('payment_periods', function (Blueprint $table) {
            // Backup hours the requesting host paid the cover for: billed to the brand, not on payroll
            $table->decimal('host_paid_hours', 8, 2)->default(0)->after('worked_hours');
        });

        Schema::table('payment_requests', function (Blueprint $table) {
            $table->string('payment_reference', 100)->nullable()->after('paid_at');
        });

        Schema::table('backup_requests', function (Blueprint $table) {
            // When the first sick letter came in; kept when an erased account's letters are deleted
            $table->dateTime('letter_uploaded_at')->nullable()->after('letter_penalty_applied');
        });

        DB::table('attachments')
            ->where('owner_type', 'backup_request')
            ->selectRaw('owner_id, min(created_at) as first_at')
            ->groupBy('owner_id')
            ->get()
            ->each(fn ($row) => DB::table('backup_requests')->where('id', $row->owner_id)->update(['letter_uploaded_at' => $row->first_at]));
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('backup_requests', function (Blueprint $table) {
            $table->dropColumn('letter_uploaded_at');
        });

        Schema::table('payment_requests', function (Blueprint $table) {
            $table->dropColumn('payment_reference');
        });

        Schema::table('payment_periods', function (Blueprint $table) {
            $table->dropColumn('host_paid_hours');
        });

        Schema::table('payment_items', function (Blueprint $table) {
            $table->dropColumn(['carried_in_hours', 'worked_hours', 'carried_out_hours']);
        });
    }
};
