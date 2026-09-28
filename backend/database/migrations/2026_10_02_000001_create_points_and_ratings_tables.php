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
        Schema::create('violation_types', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('name')->unique();
            $table->string('code', 50)->nullable()->unique(); // set on types the system applies itself
            $table->unsignedSmallInteger('default_points');
            $table->decimal('rating_impact', 3, 2)->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('brand_complaints', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('host_id')->constrained('host_profiles')->cascadeOnDelete();
            $table->foreignUuid('brand_id')->constrained();
            $table->text('description');
            $table->foreignUuid('recorded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('point_logs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('host_id')->constrained('host_profiles')->cascadeOnDelete();
            $table->foreignUuid('violation_type_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('brand_complaint_id')->nullable()->constrained()->nullOnDelete();
            $table->enum('source', ['internal', 'brand_complaint', 'backup_cancel', 'late_attachment']);
            $table->smallInteger('points_change'); // negative = deduction
            $table->string('reason')->nullable();
            $table->foreignUuid('recorded_by')->nullable()->constrained('users')->nullOnDelete(); // null = system
            $table->date('period_start');
            $table->date('occurred_on');
            $table->dateTime('voided_at')->nullable();
            $table->foreignUuid('voided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['host_id', 'period_start']);
        });

        Schema::create('point_balances', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('host_id')->constrained('host_profiles')->cascadeOnDelete();
            $table->date('period_start');
            $table->date('period_end');
            $table->smallInteger('opening_points');
            $table->smallInteger('current_points');
            $table->timestamps();

            $table->unique(['host_id', 'period_start']);
        });

        Schema::create('warning_letters', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('host_id')->constrained('host_profiles')->cascadeOnDelete();
            $table->foreignUuid('point_log_id')->nullable()->constrained()->nullOnDelete();
            $table->unsignedTinyInteger('level'); // 1 = SP1, 2 = SP2, 3 = SP3
            $table->date('period_start');
            $table->string('reason');
            $table->foreignUuid('issued_by')->nullable()->constrained('users')->nullOnDelete(); // null = automatic
            $table->dateTime('issued_at');
            $table->dateTime('voided_at')->nullable();
            $table->foreignUuid('voided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('host_ratings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('host_id')->constrained('host_profiles')->cascadeOnDelete();
            $table->char('month_year', 7); // "2026-10"
            $table->decimal('rating', 2, 1);
            $table->decimal('suggested_rating', 2, 1)->nullable();
            $table->string('note')->nullable();
            $table->foreignUuid('rated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['host_id', 'month_year']);
        });

        Schema::table('backup_requests', function (Blueprint $table) {
            $table->boolean('letter_penalty_applied')->default(false)->after('counts_toward_quota');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('backup_requests', function (Blueprint $table) {
            $table->dropColumn('letter_penalty_applied');
        });

        Schema::dropIfExists('host_ratings');
        Schema::dropIfExists('warning_letters');
        Schema::dropIfExists('point_balances');
        Schema::dropIfExists('point_logs');
        Schema::dropIfExists('brand_complaints');
        Schema::dropIfExists('violation_types');
    }
};
