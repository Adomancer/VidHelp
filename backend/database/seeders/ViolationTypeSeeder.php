<?php

namespace Database\Seeders;

use App\Models\ViolationType;
use Illuminate\Database\Seeder;

class ViolationTypeSeeder extends Seeder
{
    /**
     * Starting violation types. Points and rating impact are placeholders the admin
     * sets on the Points page; types with a code are also applied automatically.
     */
    public function run(): void
    {
        $types = [
            ['name' => 'Telat', 'code' => null, 'default_points' => 5, 'rating_impact' => 0.2],
            ['name' => 'Main HP saat live', 'code' => null, 'default_points' => 10, 'rating_impact' => 0.5],
            ['name' => 'Ketiduran', 'code' => null, 'default_points' => 10, 'rating_impact' => 0.5],
            ['name' => 'Batal backup', 'code' => ViolationType::BACKUP_CANCEL, 'default_points' => 10, 'rating_impact' => 0.5],
            ['name' => 'Surat sakit telat', 'code' => ViolationType::LATE_SICK_LETTER, 'default_points' => 5, 'rating_impact' => 0.2],
            ['name' => 'Komplain brand', 'code' => ViolationType::BRAND_COMPLAINT, 'default_points' => 10, 'rating_impact' => 0.5],
        ];

        foreach ($types as $type) {
            ViolationType::firstOrCreate(['name' => $type['name']], $type);
        }
    }
}
