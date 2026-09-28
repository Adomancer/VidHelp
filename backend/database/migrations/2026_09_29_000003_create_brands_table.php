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
        Schema::create('brands', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('name')->unique();
            $table->boolean('is_obs')->default(false);
            $table->unsignedSmallInteger('target_hours_per_period');
            $table->unsignedSmallInteger('payment_cycle_days');
            $table->enum('status', ['active', 'inactive'])->default('active');
            $table->timestamps();
        });

        Schema::create('host_brand_assignments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('host_id')->constrained('host_profiles')->cascadeOnDelete();
            $table->foreignUuid('brand_id')->constrained()->cascadeOnDelete();
            $table->boolean('is_leader')->default(false);
            $table->enum('status', ['active', 'inactive', 'banned'])->default('active');
            $table->timestamps();

            $table->unique(['host_id', 'brand_id']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('host_brand_assignments');
        Schema::dropIfExists('brands');
    }
};
