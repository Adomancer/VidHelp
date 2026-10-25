<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * 2026_10_24_000002 made work_sessions.host_id restrict deleting a host, but on MySQL the
     * delete still went through: it cascaded to the host's attendances, from them to their live
     * reports and from those to the paid work sessions, and InnoDB lets a row the same delete
     * removes pass its RESTRICT check. Every step of that chain restricts now, so a host (or a
     * report) with attendance and pay history can't be deleted. Nothing in the app deletes them.
     *
     * [table, column, referenced table]
     */
    private const KEYS = [
        ['attendances', 'host_id', 'host_profiles'],
        ['live_reports', 'host_id', 'host_profiles'],
        ['live_reports', 'attendance_id', 'attendances'],
        ['work_sessions', 'live_report_id', 'live_reports'],
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
