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
        Schema::create('schedule_slots', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('assignment_id')->constrained('host_brand_assignments')->cascadeOnDelete();
            $table->unsignedTinyInteger('day_of_week'); // ISO: 1 = Monday ... 7 = Sunday
            $table->enum('slot_type', ['regular', 'pd'])->default('regular');
            $table->time('start_time');
            $table->time('end_time');
            $table->boolean('crosses_midnight')->default(false);
            $table->boolean('is_locked')->default(false);
            $table->enum('status', ['active', 'inactive'])->default('active');
            $table->date('effective_from');
            $table->date('effective_to')->nullable();
            $table->timestamps();

            $table->index(['day_of_week', 'status']);
        });

        Schema::create('host_availability', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('host_id')->constrained('host_profiles')->cascadeOnDelete();
            $table->unsignedTinyInteger('day_of_week'); // ISO: 1 = Monday ... 7 = Sunday
            $table->time('available_from');
            $table->time('available_to'); // may be earlier than available_from (past midnight)
            $table->string('note')->nullable();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('host_availability');
        Schema::dropIfExists('schedule_slots');
    }
};
