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
        // Authenticator-app 2FA (admins). users.two_factor_enabled mirrors is_enabled.
        Schema::create('two_factor_auth', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->text('secret_key_encrypted');
            $table->json('recovery_codes_hash')->nullable();
            $table->boolean('is_enabled')->default(false);
            $table->dateTime('enabled_at')->nullable();
            // Last 30-second step a code was accepted for, so the same code can't be used twice
            $table->unsignedBigInteger('last_used_step')->nullable();
            $table->timestamps();
        });

        // Who did what, when, from where. Rows are never edited.
        Schema::create('audit_logs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('action', 50);
            $table->string('target_table', 100)->nullable();
            $table->uuid('target_id')->nullable();
            $table->string('target_label')->nullable();
            $table->json('old_value')->nullable();
            $table->json('new_value')->nullable();
            $table->string('ip_address', 45)->nullable();
            $table->string('user_agent')->nullable();
            $table->dateTime('created_at')->index();

            $table->index(['target_table', 'target_id']);
            $table->index(['user_id', 'created_at']);
            $table->index('action');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('audit_logs');
        Schema::dropIfExists('two_factor_auth');
    }
};
