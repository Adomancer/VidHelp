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
        Schema::create('special_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('brand_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->date('start_date');
            $table->date('end_date');
            $table->time('daily_start_time');
            $table->time('daily_end_time'); // may be earlier than the start: runs past midnight
            $table->unsignedSmallInteger('block_minutes');
            $table->boolean('open_full_schedule')->default(false);
            $table->unsignedSmallInteger('max_slots_per_host');
            $table->enum('status', ['active', 'cancelled'])->default('active');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['brand_id', 'start_date', 'end_date']);
        });

        Schema::create('event_slot_claims', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('event_id')->constrained('special_events')->cascadeOnDelete();
            $table->foreignUuid('host_id')->constrained('host_profiles')->cascadeOnDelete();
            $table->dateTime('start_at');
            $table->dateTime('end_at');
            $table->enum('status', ['active', 'overridden', 'cancelled'])->default('active');
            $table->foreignUuid('claimed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('claimed_at');
            $table->timestamps();

            $table->index(['event_id', 'start_at', 'status']);
            $table->index(['host_id', 'status', 'start_at']);
        });

        // Event blocks are checked in like any session, without a weekly slot
        Schema::table('attendances', function (Blueprint $table) {
            $table->uuid('slot_id')->nullable()->change();
            $table->foreignUuid('event_claim_id')->nullable()->unique()->after('backup_request_id')
                ->constrained('event_slot_claims')->nullOnDelete();
        });

        Schema::table('work_sessions', function (Blueprint $table) {
            $table->enum('session_type', ['regular', 'backup', 'event', 'double', 'disrupted', 'adjustment'])
                ->default('regular')->change();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('work_sessions', function (Blueprint $table) {
            $table->enum('session_type', ['regular', 'backup', 'double', 'disrupted', 'adjustment'])->default('regular')->change();
        });

        Schema::table('attendances', function (Blueprint $table) {
            $table->dropConstrainedForeignId('event_claim_id');
        });

        Schema::dropIfExists('event_slot_claims');
        Schema::dropIfExists('special_events');
    }
};
