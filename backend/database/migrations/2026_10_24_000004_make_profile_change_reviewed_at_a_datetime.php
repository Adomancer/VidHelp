<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * App date-times are dateTime columns (MySQL timestamp shifts with the session time zone
     * and ends in 2038); this one was created as a timestamp.
     */
    public function up(): void
    {
        Schema::table('profile_change_requests', function (Blueprint $table) {
            $table->dateTime('reviewed_at')->nullable()->change();
        });
    }

    public function down(): void
    {
        Schema::table('profile_change_requests', function (Blueprint $table) {
            $table->timestamp('reviewed_at')->nullable()->change();
        });
    }
};
