<?php

namespace Database\Seeders;

use App\Models\HostRateCategory;
use Illuminate\Database\Seeder;

class HostRateCategorySeeder extends Seeder
{
    /**
     * Default rate levels. Rates are placeholders; set the real ones on /admin/rates.
     */
    public function run(): void
    {
        $levels = [
            ['name' => 'Magang', 'min_tenure_months' => 0],
            ['name' => 'Baru', 'min_tenure_months' => 3],
            ['name' => 'Di atas 1 tahun', 'min_tenure_months' => 12],
        ];

        foreach ($levels as $level) {
            HostRateCategory::firstOrCreate(['name' => $level['name']], $level + ['rate_per_hour' => 0]);
        }
    }
}
