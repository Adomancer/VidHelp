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
        Schema::create('backup_requests', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('slot_id')->constrained('schedule_slots')->cascadeOnDelete();
            $table->foreignUuid('brand_id')->constrained();
            $table->foreignUuid('requesting_host_id')->constrained('host_profiles')->cascadeOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->date('backup_date');
            $table->dateTime('start_at');
            $table->dateTime('end_at');
            $table->enum('reason_type', ['sick', 'permit', 'other']);
            $table->text('reason')->nullable();
            $table->enum('status', ['pending', 'open', 'filled', 'cancelled', 'rejected'])->default('pending');
            $table->foreignUuid('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('approved_at')->nullable();
            $table->boolean('auto_approved')->default(false);
            $table->dateTime('auto_open_at')->nullable();
            $table->dateTime('auto_fill_at');
            $table->boolean('auto_filled')->default(false);
            $table->boolean('counts_toward_quota')->default(false);
            $table->foreignUuid('filled_by_host_id')->nullable()->constrained('host_profiles')->nullOnDelete();
            $table->dateTime('filled_at')->nullable();
            $table->dateTime('cancelled_at')->nullable();
            $table->timestamps();

            $table->index(['status', 'start_at']);
        });

        Schema::create('backup_applications', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('backup_request_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('applicant_host_id')->constrained('host_profiles')->cascadeOnDelete();
            $table->enum('status', ['applied', 'approved', 'rejected', 'withdrawn', 'cancelled'])->default('applied');
            $table->boolean('penalty_applied')->default(false);
            $table->dateTime('decided_at')->nullable();
            $table->timestamps();

            $table->unique(['backup_request_id', 'applicant_host_id']);
        });

        Schema::create('backup_quotas', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('host_id')->constrained('host_profiles')->cascadeOnDelete();
            $table->char('month_year', 7); // "2026-09"
            $table->unsignedSmallInteger('quota_used')->default(0);
            $table->unsignedSmallInteger('quota_max');
            $table->timestamps();

            $table->unique(['host_id', 'month_year']);
        });

        Schema::create('attachments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuidMorphs('owner'); // owner_type: backup_request, ...
            $table->string('file_path');
            $table->string('original_name')->nullable();
            $table->string('mime_type', 100);
            $table->unsignedInteger('size_kb');
            $table->foreignUuid('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('attachments');
        Schema::dropIfExists('backup_quotas');
        Schema::dropIfExists('backup_applications');
        Schema::dropIfExists('backup_requests');
    }
};
