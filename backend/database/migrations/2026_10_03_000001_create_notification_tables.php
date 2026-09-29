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
        // One row per delivery: in-app (web), a Discord channel post, or a Discord DM
        Schema::create('notifications', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->nullable()->constrained()->cascadeOnDelete();
            $table->string('type', 50);
            $table->string('title');
            $table->text('body')->nullable();
            $table->string('link')->nullable();
            $table->json('payload')->nullable();
            $table->enum('channel', ['web', 'discord_channel', 'discord_dm']);
            $table->string('target')->nullable();
            $table->enum('status', ['pending', 'sent', 'failed', 'skipped'])->default('pending');
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->string('error')->nullable();
            $table->dateTime('sent_at')->nullable();
            $table->dateTime('read_at')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'channel', 'read_at']);
            $table->index(['channel', 'status']);
        });

        Schema::create('discord_links', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('discord_user_id')->unique();
            $table->string('discord_username')->nullable();
            $table->string('dm_channel_id')->nullable();
            $table->dateTime('linked_at');
            $table->timestamps();
        });

        // "Nobody applied" alert is sent once per backup request
        Schema::table('backup_requests', function (Blueprint $table) {
            $table->dateTime('no_cover_alerted_at')->nullable()->after('letter_penalty_applied');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('backup_requests', function (Blueprint $table) {
            $table->dropColumn('no_cover_alerted_at');
        });

        Schema::dropIfExists('discord_links');
        Schema::dropIfExists('notifications');
    }
};
