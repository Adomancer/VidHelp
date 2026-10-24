<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Queries every dashboard load runs: reports waiting for review, sessions with a report due,
     * and the channel-post dedupe check (user_id is null there, so the user index can't help).
     */
    public function up(): void
    {
        Schema::table('live_reports', function (Blueprint $table) {
            $table->index(['status', 'submitted_at']);
        });

        Schema::table('attendances', function (Blueprint $table) {
            $table->index('report_due_at');
        });

        Schema::table('notifications', function (Blueprint $table) {
            $table->index(['channel', 'dedupe_key']);
        });
    }

    public function down(): void
    {
        Schema::table('notifications', function (Blueprint $table) {
            $table->dropIndex(['channel', 'dedupe_key']);
        });

        Schema::table('attendances', function (Blueprint $table) {
            $table->dropIndex(['report_due_at']);
        });

        Schema::table('live_reports', function (Blueprint $table) {
            $table->dropIndex(['status', 'submitted_at']);
        });
    }
};
