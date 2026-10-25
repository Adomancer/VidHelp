<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Event check-ins used to keep any backup id the client sent, which marked that backup as
     * started (staff then couldn't cancel or unassign it). An event block is never a backup.
     */
    public function up(): void
    {
        DB::table('attendances')
            ->whereNotNull('event_claim_id')
            ->whereNotNull('backup_request_id')
            ->update(['backup_request_id' => null]);
    }

    /**
     * The cleared ids were never valid, so there is nothing to put back.
     */
    public function down(): void {}
};
