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
        Schema::table('brands', function (Blueprint $table) {
            // Start of the first payment period; later periods follow back to back per cycle
            $table->date('payroll_start_date')->nullable()->after('payment_cycle_days');
        });

        Schema::create('payment_periods', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('brand_id')->constrained()->cascadeOnDelete();
            $table->date('period_start');
            $table->date('period_end');
            $table->unsignedSmallInteger('target_hours');
            $table->decimal('worked_hours', 8, 2)->default(0);
            $table->decimal('achieved_hours', 8, 2)->default(0);
            $table->decimal('carried_in_hours', 8, 2)->default(0);
            $table->decimal('carried_out_hours', 8, 2)->default(0);
            $table->enum('status', ['in_progress', 'waiting_payment', 'requested', 'paid'])->default('in_progress');
            $table->dateTime('locked_at')->nullable();
            $table->timestamps();

            $table->unique(['brand_id', 'period_start']);
        });

        Schema::table('work_sessions', function (Blueprint $table) {
            $table->foreign('payment_period_id')->references('id')->on('payment_periods')->nullOnDelete();
        });

        Schema::create('payment_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('payment_period_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('host_id')->constrained('host_profiles')->cascadeOnDelete();
            $table->unsignedSmallInteger('session_count');
            $table->decimal('hours', 8, 2);
            $table->decimal('rate_per_hour', 12, 2);
            $table->decimal('amount', 14, 2);
            $table->timestamps();

            $table->unique(['payment_period_id', 'host_id']);
        });

        Schema::create('hour_adjustments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('payment_period_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('host_id')->constrained('host_profiles')->cascadeOnDelete();
            $table->smallInteger('sessions_added')->default(0);
            $table->decimal('hours_added', 8, 2)->default(0);
            $table->string('notes');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('payment_requests', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('payment_period_id')->unique()->constrained()->cascadeOnDelete();
            $table->foreignUuid('requested_by')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('requested_at');
            $table->enum('status', ['requested', 'processing', 'paid'])->default('requested');
            $table->string('exported_report_url')->nullable();
            $table->dateTime('paid_at')->nullable();
            $table->timestamps();
        });

        Schema::create('cash_advances', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('host_id')->constrained('host_profiles')->cascadeOnDelete();
            $table->foreignUuid('brand_id')->nullable()->constrained()->nullOnDelete();
            $table->enum('type', ['early_payment', 'loan']);
            $table->decimal('total_amount', 14, 2);
            $table->unsignedSmallInteger('installment_count');
            $table->string('notes')->nullable();
            $table->enum('status', ['unpaid', 'in_progress', 'paid'])->default('unpaid');
            $table->foreignUuid('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->dateTime('requested_at');
            $table->timestamps();
        });

        Schema::create('salary_slips', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('host_id')->constrained('host_profiles')->cascadeOnDelete();
            $table->foreignUuid('payment_period_id')->constrained()->cascadeOnDelete();
            $table->decimal('gross_amount', 14, 2);
            $table->decimal('advance_deduction', 14, 2)->default(0);
            $table->decimal('net_amount', 14, 2);
            $table->string('pdf_path')->nullable();
            $table->dateTime('generated_at');
            $table->dateTime('sent_at')->nullable();
            $table->timestamps();

            $table->unique(['host_id', 'payment_period_id']);
        });

        Schema::create('cash_advance_installments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('cash_advance_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('payment_period_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('salary_slip_id')->nullable()->constrained()->nullOnDelete();
            $table->unsignedSmallInteger('seq');
            $table->decimal('amount', 14, 2);
            $table->foreignUuid('deducted_brand_id')->nullable()->constrained('brands')->nullOnDelete();
            $table->enum('status', ['scheduled', 'deducted', 'skipped'])->default('scheduled');
            $table->dateTime('deducted_at')->nullable();
            $table->timestamps();

            $table->unique(['cash_advance_id', 'seq']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('cash_advance_installments');
        Schema::dropIfExists('salary_slips');
        Schema::dropIfExists('cash_advances');
        Schema::dropIfExists('payment_requests');
        Schema::dropIfExists('hour_adjustments');
        Schema::dropIfExists('payment_items');

        Schema::table('work_sessions', function (Blueprint $table) {
            $table->dropForeign(['payment_period_id']);
        });

        Schema::dropIfExists('payment_periods');

        Schema::table('brands', function (Blueprint $table) {
            $table->dropColumn('payroll_start_date');
        });
    }
};
