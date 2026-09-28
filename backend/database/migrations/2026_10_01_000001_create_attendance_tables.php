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
        Schema::create('attendances', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('host_id')->constrained('host_profiles')->cascadeOnDelete();
            $table->foreignUuid('slot_id')->constrained('schedule_slots')->cascadeOnDelete();
            $table->foreignUuid('backup_request_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('brand_id')->constrained();
            $table->date('session_date');
            $table->dateTime('scheduled_start_at');
            $table->dateTime('scheduled_end_at');
            $table->dateTime('check_in_at');
            $table->dateTime('check_out_at')->nullable();
            $table->dateTime('report_due_at');
            $table->timestamps();

            // One check-in per host per session occurrence
            $table->unique(['host_id', 'slot_id', 'session_date']);
        });

        Schema::create('live_reports', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('attendance_id')->unique()->constrained()->cascadeOnDelete();
            $table->foreignUuid('host_id')->constrained('host_profiles')->cascadeOnDelete();
            $table->foreignUuid('brand_id')->constrained();
            $table->unsignedSmallInteger('session_count')->default(1);
            $table->decimal('duration_hours', 5, 2);
            $table->json('metrics')->nullable();
            $table->text('notes')->nullable();
            $table->enum('status', ['submitted', 'flagged', 'approved', 'rejected'])->default('submitted');
            $table->json('flag_reasons')->nullable();
            $table->dateTime('submitted_at');
            $table->foreignUuid('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('reviewed_at')->nullable();
            $table->string('review_note')->nullable();
            $table->timestamps();
        });

        Schema::create('work_sessions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('live_report_id')->unique()->constrained()->cascadeOnDelete();
            $table->foreignUuid('host_id')->constrained('host_profiles')->cascadeOnDelete();
            $table->foreignUuid('brand_id')->constrained();
            $table->uuid('payment_period_id')->nullable()->index(); // FK added with the payroll module
            $table->date('session_date');
            $table->dateTime('start_at');
            $table->dateTime('end_at');
            $table->decimal('duration_hours', 5, 2);
            $table->enum('session_type', ['regular', 'backup', 'double', 'disrupted', 'adjustment'])->default('regular');
            $table->enum('status', ['normal', 'flagged', 'carried_over'])->default('normal');
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index(['host_id', 'session_date']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('work_sessions');
        Schema::dropIfExists('live_reports');
        Schema::dropIfExists('attendances');
    }
};
