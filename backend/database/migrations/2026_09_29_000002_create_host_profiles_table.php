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
        Schema::create('host_profiles', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->unique()->constrained()->cascadeOnDelete();
            $table->foreignUuid('rate_category_id')->nullable()->constrained('host_rate_categories')->nullOnDelete();
            $table->boolean('rate_category_overridden')->default(false);
            $table->string('phone', 20)->nullable();
            $table->string('guardian_phone', 20)->nullable();
            $table->date('join_date');
            $table->enum('status', ['active', 'inactive', 'archived', 'banned'])->default('active');
            $table->timestamps();
        });

        Schema::create('host_sensitive_data', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('host_id')->unique()->constrained('host_profiles')->cascadeOnDelete();
            $table->text('ktp_number')->nullable(); // encrypted
            $table->string('ktp_image_path')->nullable(); // private disk
            $table->string('bank_name')->nullable();
            $table->text('bank_account')->nullable(); // encrypted
            $table->string('account_holder_name')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('host_sensitive_data');
        Schema::dropIfExists('host_profiles');
    }
};
