<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // Categories the user doesn't want as Discord DMs; when Discord last refused a DM to them
        Schema::table('discord_links', function (Blueprint $table) {
            $table->json('muted_categories')->nullable()->after('dm_channel_id');
            $table->dateTime('dm_blocked_at')->nullable()->after('muted_categories');
        });

        // A reminder is sent once per user and key (e.g. "live_soon:<slot>:<date>")
        Schema::table('notifications', function (Blueprint $table) {
            $table->string('dedupe_key', 150)->nullable()->after('type');
            $table->index(['user_id', 'dedupe_key']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('notifications', function (Blueprint $table) {
            $table->dropIndex(['user_id', 'dedupe_key']);
            $table->dropColumn('dedupe_key');
        });

        Schema::table('discord_links', function (Blueprint $table) {
            $table->dropColumn(['muted_categories', 'dm_blocked_at']);
        });
    }
};
