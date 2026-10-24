<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Deleting a slot used to delete its attendances (and through them live reports and paid
     * work sessions) and its backup requests. A slot that was used is now kept (made inactive),
     * and the database refuses to delete it.
     */
    public function up(): void
    {
        Schema::table('attendances', function (Blueprint $table) {
            $table->dropForeign(['slot_id']);
            $table->foreign('slot_id')->references('id')->on('schedule_slots')->restrictOnDelete();
        });

        Schema::table('backup_requests', function (Blueprint $table) {
            $table->dropForeign(['slot_id']);
            $table->foreign('slot_id')->references('id')->on('schedule_slots')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('attendances', function (Blueprint $table) {
            $table->dropForeign(['slot_id']);
            $table->foreign('slot_id')->references('id')->on('schedule_slots')->cascadeOnDelete();
        });

        Schema::table('backup_requests', function (Blueprint $table) {
            $table->dropForeign(['slot_id']);
            $table->foreign('slot_id')->references('id')->on('schedule_slots')->cascadeOnDelete();
        });
    }
};
