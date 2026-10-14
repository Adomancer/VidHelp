<?php

namespace Database\Seeders;

use App\Models\HostRateCategory;
use Illuminate\Database\Seeder;

class HostRateCategorySeeder extends Seeder
{
    /**
     * Default rate levels, as set by the agency (Oct 2026). Admins can change them on /admin/rates.
     */
    public function run(): void
    {
        $levels = [
            ['name' => 'Di bawah 1 tahun', 'min_tenure_months' => 0, 'rate_per_hour' => 25000],
            ['name' => 'Di atas 1 tahun', 'min_tenure_months' => 12, 'rate_per_hour' => 37500],
        ];

        foreach ($levels as $level) {
            HostRateCategory::firstOrCreate(['name' => $level['name']], $level);
        }
    }
}
