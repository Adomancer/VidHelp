<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Cancelling a payment request (the old request stays as history), paying kasbon back
     * outside payroll, and recording installments a slip couldn't cover.
     */
    public function up(): void
    {
        // A period can now have several requests over time, at most one of them not cancelled.
        // The plain index goes in first: MySQL needs one for the foreign key before the unique one is dropped.
        Schema::table('payment_requests', function (Blueprint $table) {
            $table->index('payment_period_id');
        });
        Schema::table('payment_requests', function (Blueprint $table) {
            $table->dropUnique(['payment_period_id']);
            $table->enum('status', ['requested', 'processing', 'paid', 'cancelled'])->default('requested')->change();
            $table->dateTime('cancelled_at')->nullable()->after('paid_at');
            $table->foreignUuid('cancelled_by')->nullable()->after('cancelled_at')->constrained('users')->nullOnDelete();
            $table->string('cancel_reason')->nullable()->after('cancelled_by');
        });

        Schema::table('cash_advances', function (Blueprint $table) {
            $table->dateTime('settled_at')->nullable()->after('requested_at');
            $table->foreignUuid('settled_by')->nullable()->after('settled_at')->constrained('users')->nullOnDelete();
            $table->string('settled_note')->nullable()->after('settled_by');
        });

        Schema::table('cash_advance_installments', function (Blueprint $table) {
            // settled: paid back in cash/transfer instead of from a salary slip
            $table->enum('status', ['scheduled', 'deducted', 'skipped', 'settled'])->default('scheduled')->change();
            $table->unsignedSmallInteger('skip_count')->default(0)->after('status');
        });

        Schema::table('salary_slips', function (Blueprint $table) {
            // Installments that were due but didn't fit in this slip (they wait for the next one)
            $table->json('skipped_deductions')->nullable()->after('advance_deduction');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('salary_slips', function (Blueprint $table) {
            $table->dropColumn('skipped_deductions');
        });

        Schema::table('cash_advance_installments', function (Blueprint $table) {
            $table->dropColumn('skip_count');
            $table->enum('status', ['scheduled', 'deducted', 'skipped'])->default('scheduled')->change();
        });

        Schema::table('cash_advances', function (Blueprint $table) {
            $table->dropConstrainedForeignId('settled_by');
            $table->dropColumn(['settled_at', 'settled_note']);
        });

        Schema::table('payment_requests', function (Blueprint $table) {
            $table->dropConstrainedForeignId('cancelled_by');
            $table->dropColumn(['cancelled_at', 'cancel_reason']);
            $table->enum('status', ['requested', 'processing', 'paid'])->default('requested')->change();
            $table->unique('payment_period_id');
        });
        Schema::table('payment_requests', function (Blueprint $table) {
            $table->dropIndex(['payment_period_id']);
        });
    }
};
