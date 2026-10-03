<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * An edit that applies from a later date ends the slot and starts a new one;
     * the new slot points back to the one it continues, so its history reads as one.
     */
    public function up(): void
    {
        Schema::table('schedule_slots', function (Blueprint $table) {
            $table->foreignUuid('previous_slot_id')->nullable()->after('assignment_id')
                ->constrained('schedule_slots')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('schedule_slots', function (Blueprint $table) {
            $table->dropConstrainedForeignId('previous_slot_id');
        });
    }
};
