<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Pay, kasbon and point history used to go with a deleted host, brand or user. Nothing in
     * the app hard-deletes them (users are soft-deleted, erasing only anonymises), so a delete
     * from tinker or a future feature now fails instead of wiping that history.
     *
     * [table, column, referenced table]
     */
    private const KEYS = [
        ['payment_periods', 'brand_id', 'brands'],
        ['payment_items', 'host_id', 'host_profiles'],
        ['hour_adjustments', 'host_id', 'host_profiles'],
        ['cash_advances', 'host_id', 'host_profiles'],
        ['salary_slips', 'host_id', 'host_profiles'],
        ['work_sessions', 'host_id', 'host_profiles'],
        ['point_logs', 'host_id', 'host_profiles'],
        ['host_profiles', 'user_id', 'users'],
    ];

    public function up(): void
    {
        foreach (self::KEYS as [$table, $column, $references]) {
            Schema::table($table, function (Blueprint $blueprint) use ($column, $references) {
                $blueprint->dropForeign([$column]);
                $blueprint->foreign($column)->references('id')->on($references)->restrictOnDelete();
            });
        }
    }

    public function down(): void
    {
        foreach (self::KEYS as [$table, $column, $references]) {
            Schema::table($table, function (Blueprint $blueprint) use ($column, $references) {
                $blueprint->dropForeign([$column]);
                $blueprint->foreign($column)->references('id')->on($references)->cascadeOnDelete();
            });
        }
    }
};
