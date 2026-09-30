<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Requests open straight away (no approval of the absence itself); the admin
     * decides on the applicants instead. A request can name the hosts who may cover it.
     */
    public function up(): void
    {
        Schema::table('backup_requests', function (Blueprint $table) {
            // open = every host may apply; direct = only the nominees
            $table->enum('request_type', ['open', 'direct'])->default('open')->after('reason');
            $table->dropColumn(['auto_approved', 'auto_open_at']);
        });

        Schema::create('backup_nominees', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('backup_request_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('nominee_host_id')->constrained('host_profiles')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['backup_request_id', 'nominee_host_id']);
        });

        // "pending" used to mean "absence not approved yet"; now it means "applicants wait for a decision"
        DB::table('backup_requests')
            ->where('status', 'pending')
            ->whereNotExists(fn ($q) => $q->from('backup_applications')
                ->whereColumn('backup_applications.backup_request_id', 'backup_requests.id')
                ->where('backup_applications.status', 'applied'))
            ->update(['status' => 'open']);
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('backup_nominees');

        Schema::table('backup_requests', function (Blueprint $table) {
            $table->dropColumn('request_type');
            $table->boolean('auto_approved')->default(false);
            $table->dateTime('auto_open_at')->nullable();
        });
    }
};
