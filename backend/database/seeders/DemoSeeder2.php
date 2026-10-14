<?php

namespace Database\Seeders;

use App\Models\BackupRequest;
use App\Models\Brand;
use App\Models\BrandComplaint;
use App\Models\EventSlotClaim;
use App\Models\HostBrandAssignment;
use App\Models\HostProfile;
use App\Models\LiveReport;
use App\Models\PaymentPeriod;
use App\Models\ScheduleSlot;
use App\Models\SpecialEvent;
use App\Models\User;
use App\Models\ViolationType;
use App\Services\AttendanceService;
use App\Services\BackupService;
use App\Services\EventCalendar;
use App\Services\EventService;
use App\Services\PayrollService;
use App\Services\PointService;
use App\Services\RatingService;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * Bulk demo data, to see the app with a real agency's volume: 40 hosts (bulk01@vidhelp.com …
 * bulk40@vidhelp.com, password "password"; the last two have left) on 10 brands, about twelve weeks of live sessions
 * (late check-ins, no-shows, short and late reports reviewed by operators), pay periods paid
 * along the way, kasbon, violations and brand complaints (some reaching an SP), monthly ratings,
 * past and upcoming special events with claimed blocks, past and upcoming backups, two inactive
 * hosts and six sign-ups waiting for approval. Also two operators and a finance user.
 *
 * Run: php artisan db:seed --class=DemoSeeder2 (after the normal seeders). Never in production.
 * It doesn't touch DemoSeeder's data, so both can be loaded. Takes a few minutes.
 *
 * Like DemoSeeder, every past action goes through the real services with the clock set back
 * to its time, so hours, periods, slips and points come out exactly as the app would make them.
 */
class DemoSeeder2 extends Seeder
{
    private const PASSWORD = 'password';

    /** How far back the sessions go. */
    public int $weeks = 12;

    /** Hosts with a weekly schedule; the next STANDBY are on brands without slots (they cover backups and events). */
    public int $scheduledHosts = 34;

    private const STANDBY = 4;

    private const NAMES = [
        'Ayu Kartika', 'Bima Santoso', 'Citra Dewi', 'Dani Firmansyah', 'Eka Wulandari', 'Fajar Nugroho',
        'Gita Permata', 'Hendra Wijaya', 'Indah Sari', 'Joko Susilo', 'Kirana Putri', 'Lukman Hakim',
        'Maya Anggraini', 'Nanda Prasetyo', 'Oki Ramadhan', 'Putri Ayuningtyas', 'Raka Mahendra', 'Salsa Bila',
        'Tegar Wibowo', 'Utari Rahmawati', 'Vina Oktaviani', 'Wahyu Hidayat', 'Yogi Saputra', 'Zahra Amelia',
        'Agus Setiawan', 'Bella Safitri', 'Cahya Purnama', 'Dewi Lestari', 'Erlangga Putra', 'Fitri Handayani',
        'Galih Pratama', 'Hana Pertiwi', 'Irfan Maulana', 'Jihan Aulia', 'Kevin Hartono', 'Laras Ayu',
        'Mega Puspita', 'Nico Saputra', 'Olivia Tanjung', 'Pandu Wicaksono', 'Rina Marlina', 'Sandi Kurniawan',
    ];

    private const SIGNUPS = ['Tiara Anjani', 'Umar Fauzi', 'Vera Novita', 'Wulan Sari', 'Yusuf Hamdani', 'Zaki Firdaus'];

    private const BANKS = ['BCA', 'Mandiri', 'BRI', 'BNI', 'BSI', 'CIMB Niaga'];

    private const BRANDS = [
        'Aruna Skincare', 'Kopi Senja', 'Batik Lestari', 'Dapur Mama Ina', 'Sepatu Langkah',
        'Teh Puan', 'Rumah Hijab', 'Gadget Kita', 'Snack Kriuk', 'Parfum Nusa',
    ];

    /** Live hours a brand can run a slot in (no slot crosses another in the same brand or for the same host). */
    private const BANDS = [
        ['07:00', '10:00'], ['10:00', '12:00'], ['13:00', '15:00'],
        ['15:00', '17:00'], ['17:00', '19:00'], ['19:00', '22:00'],
    ];

    /** @var array<int, HostProfile> host number => profile */
    private array $hosts = [];

    /** @var list<Brand> */
    private array $brands = [];

    /** @var array<string, User> brand id => its leader's user */
    private array $leaders = [];

    /** @var array<string, list<HostProfile>> brand id => every host on it (scheduled or standby) */
    private array $brandHosts = [];

    /** @var list<ScheduleSlot> */
    private array $slots = [];

    /** @var array<string, BackupRequest> "slot id|date" => a filled backup for that session */
    private array $covers = [];

    /** @var list<string> flagged report ids waiting for an operator */
    private array $toReview = [];

    private User $admin;

    private User $finance;

    /** @var list<User> */
    private array $operators = [];

    /** Sessions the services refused (shouldn't happen; reported at the end). */
    private int $skipped = 0;

    public function run(): void
    {
        if (app()->isProduction()) {
            $this->command->error('DemoSeeder2 does not run in production.');

            return;
        }
        if (User::where('email', 'bulk01@vidhelp.com')->exists()) {
            $this->command->warn('Bulk demo data is already there (bulk01@vidhelp.com exists). Nothing was added.');

            return;
        }

        $this->admin = User::role('admin')->where('status', 'active')->firstOrFail();

        // Never post demo notifications to the real Discord server
        config(['services.discord.bot_token' => null]);

        $today = CarbonImmutable::today();
        $start = $today->subWeeks($this->weeks)->startOfWeek();

        mt_srand(2027);

        DB::transaction(function () use ($start, $today) {
            $this->at($start->subDay()->setTime(9, 0), function () use ($start, $today) {
                $this->createStaff();
                $this->createHosts($today);
                $this->createBrandsAndSchedule($start);
            });

            $this->playPast($start, $today);
            $this->createUpcoming($today);
            $this->createSignups();

            // Levels were set as of the first day; move hosts who passed a year since
            HostProfile::syncAllRateCategories();
        });

        $this->command->info(sprintf(
            'Bulk demo data added: %d hosts, %d brands, %d reports, %d pay periods. Sign in as bulk01@vidhelp.com … with password "password".',
            count($this->hosts), count($this->brands),
            LiveReport::whereIn('brand_id', collect($this->brands)->pluck('id'))->count(),
            PaymentPeriod::whereIn('brand_id', collect($this->brands)->pluck('id'))->count(),
        ));
        $this->command->info('Staff: operator1@vidhelp.com, operator2@vidhelp.com, finance@vidhelp.com (password "password").');
        if ($this->skipped > 0) {
            $this->command->warn("{$this->skipped} demo actions were refused by the app and skipped.");
        }
    }

    private function createStaff(): void
    {
        foreach ([['operator1', 'Operator Satu', 'operator'], ['operator2', 'Operator Dua', 'operator'], ['finance', 'Tim Finance', 'finance']] as [$email, $name, $role]) {
            $user = User::firstOrCreate(['email' => "{$email}@vidhelp.com"], [
                'name' => $name,
                'password' => Hash::make(self::PASSWORD),
                'status' => 'active',
                'signup_source' => 'admin_created',
                'approved_by' => $this->admin->id,
                'approved_at' => now(),
            ]);
            $user->syncRoles([$role]);

            $role === 'finance' ? $this->finance = $user : $this->operators[] = $user;
        }
    }

    /** Scheduled hosts, standby hosts, then two who left (inactive, no schedule). Join dates count back from the real today. */
    private function createHosts(CarbonImmutable $today): void
    {
        $total = $this->scheduledHosts + self::STANDBY + 2;

        for ($number = 1; $number <= $total; $number++) {
            $name = self::NAMES[($number - 1) % count(self::NAMES)];
            $inactive = $number > $this->scheduledHosts + self::STANDBY;
            $months = match (true) {
                $inactive => mt_rand(14, 30),
                $number > $this->scheduledHosts => mt_rand(0, 3),
                default => mt_rand(4, 30),
            };

            $user = User::create([
                'name' => $name,
                'email' => sprintf('bulk%02d@vidhelp.com', $number),
                'password' => Hash::make(self::PASSWORD),
                'status' => 'active', // the profile is made for active hosts; the two who left are switched off below
                'signup_source' => mt_rand(0, 1) ? 'admin_created' : 'self_register',
                'approved_by' => $this->admin->id,
                'approved_at' => now(),
            ]);
            $user->assignRole('host');
            $user->ensureHostProfile();

            $profile = $user->hostProfile;
            $profile->fill([
                'join_date' => $today->subMonths($months)->subDays(mt_rand(0, 27))->toDateString(),
                'phone' => sprintf('0812-7770-%04d', $number),
                'guardian_phone' => sprintf('0813-7770-%04d', $number),
                'status' => $inactive ? 'inactive' : 'active',
            ]);
            $profile->syncRateCategory();
            $profile->save();

            $profile->sensitiveData()->create([
                'ktp_number' => sprintf('32730000000001%02d', $number),
                'bank_name' => self::BANKS[$number % count(self::BANKS)],
                'bank_account' => sprintf('98765400%02d', $number),
                'account_holder_name' => $name,
            ]);

            if ($inactive) {
                $user->update(['status' => 'inactive']);
            } else {
                $this->hosts[$number] = $profile;
            }
        }
    }

    /**
     * 4-6 weekly lines per brand (2-4 days each, in one of the BANDS). Every scheduled host gets
     * at least one line, some get a second (often on another brand). Standby hosts join brands
     * without slots. A brand's target is 1.5-3 weeks of its schedule.
     */
    private function createBrandsAndSchedule(CarbonImmutable $start): void
    {
        $brandBusy = [];
        $hostBusy = [];
        $lines = [];

        foreach (self::BRANDS as $index => $name) {
            $this->brands[] = Brand::create([
                'name' => $name,
                'product_knowledge' => "Produk unggulan {$name}: sebutkan promo hari ini, garansi, dan cara checkout di keranjang kuning.",
                'target_hours_per_period' => 1, // set below from the schedule
                'payroll_start_date' => $start->toDateString(),
                'status' => 'active',
            ]);
            for ($line = 0; $line < 4 + $index % 3; $line++) {
                $lines[] = $index;
            }
        }

        $scheduled = range(1, $this->scheduledHosts);
        shuffle($lines);

        foreach ($lines as $position => $brandIndex) {
            // The first lines go to each host once; the rest to random hosts
            $candidates = $position < count($scheduled) ? [$scheduled[$position], ...$scheduled] : $this->shuffled($scheduled);

            foreach ($candidates as $number) {
                if ($this->addLine($brandIndex, $number, $brandBusy, $hostBusy, $start)) {
                    break;
                }
            }
        }

        foreach ($this->brands as $brand) {
            $weekly = collect($this->slots)
                ->filter(fn (ScheduleSlot $slot) => $slot->assignment->brand_id === $brand->id)
                ->sum(fn (ScheduleSlot $slot) => $this->slotHours($slot));
            $brand->update(['target_hours_per_period' => max(10, (int) round($weekly * mt_rand(15, 30) / 10 / 5) * 5)]);
        }

        // Standby hosts: on 2-3 brands each, no slots
        for ($number = $this->scheduledHosts + 1; $number <= $this->scheduledHosts + self::STANDBY; $number++) {
            foreach (array_slice($this->shuffled(array_keys($this->brands)), 0, mt_rand(2, 3)) as $brandIndex) {
                $this->assign($brandIndex, $number);
            }
        }
    }

    /** Try to give host `$number` a line on the brand; false if no band/days fit both. */
    private function addLine(int $brandIndex, int $number, array &$brandBusy, array &$hostBusy, CarbonImmutable $start): bool
    {
        for ($attempt = 0; $attempt < 30; $attempt++) {
            $band = mt_rand(0, count(self::BANDS) - 1);
            $days = array_slice($this->shuffled(range(1, 7)), 0, mt_rand(2, 4));
            sort($days);

            $free = collect($days)->every(fn (int $day) => ! isset($brandBusy[$brandIndex][$day][$band]) && ! isset($hostBusy[$number][$day][$band]));
            if (! $free) {
                continue;
            }

            $assignment = $this->assign($brandIndex, $number);
            [$from, $to] = self::BANDS[$band];

            foreach ($days as $day) {
                $brandBusy[$brandIndex][$day][$band] = true;
                $hostBusy[$number][$day][$band] = true;

                $slot = ScheduleSlot::create([
                    'assignment_id' => $assignment->id,
                    'day_of_week' => $day,
                    'start_time' => $from,
                    'end_time' => $to,
                    'effective_from' => $start->toDateString(),
                    'status' => 'active',
                ]);
                $this->slots[] = $slot->setRelation('assignment', $assignment);
            }

            return true;
        }

        return false;
    }

    /** The host's assignment on the brand (the brand's first host becomes its leader). */
    private function assign(int $brandIndex, int $number): HostBrandAssignment
    {
        $brand = $this->brands[$brandIndex];
        $host = $this->hosts[$number];
        $leader = ! isset($this->leaders[$brand->id]) && $number <= $this->scheduledHosts;

        $assignment = HostBrandAssignment::firstOrCreate(
            ['host_id' => $host->id, 'brand_id' => $brand->id],
            ['is_leader' => $leader, 'status' => 'active'],
        );

        if ($assignment->wasRecentlyCreated) {
            $this->brandHosts[$brand->id][] = $host;
            if ($leader) {
                $this->leaders[$brand->id] = $host->user;
            }
        }

        return $assignment;
    }

    /**
     * Day by day to now. Mornings: new events, backups for three days ahead, report reviews.
     * Then the day's sessions that have ended. Nights: kasbon, violations, monthly ratings, pay periods.
     */
    private function playPast(CarbonImmutable $start, CarbonImmutable $today): void
    {
        $events = $this->plannedEvents($start, $today);

        for ($day = $start, $offset = 0; $day->lte($today); $day = $day->addDay(), $offset++) {
            $this->at($day->setTime(8, 0), function () use ($day, $today, $events) {
                foreach ($events as $plan) {
                    if ($plan['create_on']->equalTo($day)) {
                        $this->createEvent($plan);
                    }
                }
                if ($day->addDays(3)->lt($today)) {
                    $this->arrangeBackups($day->addDays(3));
                }
                $this->reviewReports($today);
            });

            foreach ($events as $plan) {
                if ($plan['create_on']->addDay()->equalTo($day)) {
                    $this->claimBlocks(SpecialEvent::where('name', $plan['name'])->firstOrFail(), $day->setTime(9, 0), $plan['fill']);
                }
            }

            $this->playSessions($day);

            $this->at($day->setTime(23, 30), function () use ($day, $today, $offset) {
                if ($offset > 0 && $offset % 9 === 0) {
                    $this->recordKasbon();
                }
                $this->recordViolations($day);
                if ($day->day === 1 && $offset > 0) {
                    $this->rateMonth($day->subMonth()->format('Y-m'));
                }
                app(PointService::class)->penalizeLateSickLetters();
                $this->settlePeriods($today);
            });
        }
    }

    /** Every session of the day that has ended: regular slots, covers and event blocks. */
    private function playSessions(CarbonImmutable $day): void
    {
        $calendar = app(EventCalendar::class);
        $sessions = [];

        foreach ($this->slots as $slot) {
            if (! $slot->runsOn($day) || $calendar->replacing($slot->assignment->brand_id, $day)) {
                continue;
            }
            [$from, $to] = $slot->occurrenceOn($day);
            $cover = $this->covers[$slot->id.'|'.$day->toDateString()] ?? null;

            $sessions[] = $cover
                ? [$cover->filler, $from, $to, fn (AttendanceService $a, HostProfile $h) => $a->checkIn($h, null, null, $cover->id), false]
                : [$slot->assignment->host, $from, $to, fn (AttendanceService $a, HostProfile $h) => $a->checkIn($h, $slot->id, $day->toDateString(), null), true];
        }

        EventSlotClaim::active()->whereDate('start_at', $day)->with('host')->get()->each(function (EventSlotClaim $claim) use (&$sessions) {
            $sessions[] = [$claim->host, $claim->start_at->toImmutable(), $claim->end_at->toImmutable(), fn (AttendanceService $a, HostProfile $h) => $a->checkIn($h, null, null, null, $claim->id), false];
        });

        usort($sessions, fn (array $a, array $b) => $a[1] <=> $b[1]);

        foreach ($sessions as [$host, $from, $to, $checkIn, $mayMiss]) {
            if ($to->gte(now())) {
                continue;
            }
            // A few regular sessions are missed altogether
            if ($mayMiss && mt_rand(1, 100) <= 3) {
                continue;
            }
            $this->playSession($host, $from, $to, $checkIn);
        }
    }

    private function playSession(HostProfile $host, CarbonImmutable $from, CarbonImmutable $to, callable $checkIn): void
    {
        $late = mt_rand(1, 100) <= 4;
        $checkInAt = $late ? $from->addMinutes(mt_rand(11, 35)) : $from->subMinutes(mt_rand(1, 10));

        try {
            $record = $this->at($checkInAt, fn () => $checkIn(app(AttendanceService::class), $host));
        } catch (ValidationException) {
            $this->skipped++;

            return;
        }

        $noCheckOut = mt_rand(1, 100) === 1;
        if (! $noCheckOut) {
            $this->at($to->addMinutes(mt_rand(0, 4)), fn () => app(AttendanceService::class)->checkOut($record));
        }

        // Sessions of the last two days: some reports are still missing
        $recent = $to->gt(now()->subDays(2));
        if ($recent && mt_rand(1, 100) <= 12) {
            return;
        }

        $hours = round($from->diffInMinutes($to) / 60, 2);
        $short = mt_rand(1, 100) <= 3;
        $lateReport = ! $recent && mt_rand(1, 100) <= 2;
        $submitAt = $lateReport ? $to->addHours(26) : $to->addMinutes(mt_rand(10, 90));
        if ($submitAt->gte(now())) {
            return;
        }

        $report = $this->at($submitAt, fn () => app(AttendanceService::class)->submitReport($record, [
            'session_count' => 1,
            'duration_hours' => $short ? max(0.5, $hours - mt_rand(2, 4) * 0.25) : $hours,
            'metrics' => [
                'gmv' => mt_rand(8, 90) * 100000,
                'orders' => mt_rand(10, 220),
                'viewers' => mt_rand(150, 6500),
            ],
            'notes' => $short ? 'Koneksi sempat putus, live dihentikan lebih awal.' : null,
        ]));

        if ($report->status === 'flagged') {
            $this->toReview[] = $report->id;
        }
    }

    /**
     * Operators go through flagged reports the day after; the last three days stay in the queue.
     * Most are approved with the reported hours, some rejected.
     */
    private function reviewReports(CarbonImmutable $today): void
    {
        $this->toReview = array_values(array_filter($this->toReview, function (string $id) use ($today) {
            $report = LiveReport::with('attendance')->findOrFail($id);
            $sessionDay = CarbonImmutable::parse($report->attendance->session_date);

            if ($sessionDay->gte(today()) || $sessionDay->gte($today->subDays(3))) {
                return true;
            }

            $operator = $this->operators[mt_rand(0, count($this->operators) - 1)];
            $attendance = app(AttendanceService::class);

            if (mt_rand(1, 100) <= 85) {
                $attendance->approve($report, $operator, (float) $report->duration_hours, 'Dicek dengan rekaman live, jam sesuai laporan.');
            } else {
                $attendance->reject($report, $operator, 'Tidak ada bukti live di jam tersebut.');
            }

            return false;
        }));
    }

    /**
     * A few hosts ask for a backup for a session three days ahead (as the app requires ≥ 24 h);
     * hosts from the brand apply and an admin picks one the same day. No applicant → cancelled.
     */
    private function arrangeBackups(CarbonImmutable $date): void
    {
        $backups = app(BackupService::class);
        $calendar = app(EventCalendar::class);

        foreach ($this->slots as $slot) {
            if (! $slot->runsOn($date) || mt_rand(1, 100) > 4 || $calendar->replacing($slot->assignment->brand_id, $date)) {
                continue;
            }

            $owner = $slot->assignment->host;
            $sick = mt_rand(1, 4) === 1;

            try {
                $request = $backups->create($slot, $date->toDateString(), [
                    'reason_type' => $sick ? 'sick' : 'permit',
                    'reason' => $sick ? 'Demam' : ['Acara keluarga', 'Ujian kampus', 'Urusan kampus', 'Pulang kampung'][mt_rand(0, 3)],
                ], $owner->user, byStaff: false);
            } catch (ValidationException) {
                $this->skipped++;

                continue;
            }

            $applied = 0;
            foreach ($this->shuffled($this->brandHosts[$slot->assignment->brand_id]) as $host) {
                if ($host->id === $owner->id || $applied >= mt_rand(1, 3)) {
                    continue;
                }
                try {
                    $backups->apply($request, $host);
                    $applied++;
                } catch (ValidationException) {
                    // busy then, or over the quota
                }
            }

            $this->at(now()->toImmutable()->setTime(15, 0), function () use ($backups, $request, $slot, $date) {
                $request = BackupRequest::findOrFail($request->id);
                $picked = $backups->rankedApplicants($request)->first();

                if (! $picked) {
                    $backups->close($request, 'cancelled');

                    return;
                }
                try {
                    $this->covers[$slot->id.'|'.$date->toDateString()] = $backups->fill($request, $picked->applicant, $this->admin)->load('filler');
                } catch (ValidationException) {
                    $backups->close($request, 'cancelled');
                }
            });
        }
    }

    /** @return list<array<string, mixed>> past events: when they're made, run, and how full they get */
    private function plannedEvents(CarbonImmutable $start, CarbonImmutable $today): array
    {
        $plans = [
            // Replaces the brand's schedule for two days; hosts fill most blocks
            ['offset' => 30, 'brand' => 0, 'name' => 'PD Aruna', 'days' => 2, 'from' => '10:00', 'to' => '22:00', 'block' => 120, 'full' => true, 'max' => 3, 'fill' => 90],
            // Runs beside the regular schedule; only the free hours are blocks
            ['offset' => 45, 'brand' => 1, 'name' => 'Double Date Kopi Senja', 'days' => 1, 'from' => '17:00', 'to' => '23:00', 'block' => 60, 'full' => false, 'max' => 2, 'fill' => 70],
            ['offset' => 60, 'brand' => 6, 'name' => 'Flash Sale Rumah Hijab', 'days' => 3, 'from' => '19:00', 'to' => '23:00', 'block' => 120, 'full' => false, 'max' => 2, 'fill' => 60],
        ];

        return collect($plans)
            ->map(fn (array $plan) => [...$plan, 'starts' => $start->addDays($plan['offset']), 'create_on' => $start->addDays($plan['offset'] - 7)])
            ->filter(fn (array $plan) => $plan['starts']->addDays($plan['days'])->lt($today))
            ->values()
            ->all();
    }

    private function createEvent(array $plan): void
    {
        app(EventService::class)->create([
            'brand_id' => $this->brands[$plan['brand']]->id,
            'name' => $plan['name'],
            'start_date' => $plan['starts']->toDateString(),
            'end_date' => $plan['starts']->addDays($plan['days'] - 1)->toDateString(),
            'daily_start_time' => $plan['from'],
            'daily_end_time' => $plan['to'],
            'block_minutes' => $plan['block'],
            'open_full_schedule' => $plan['full'],
            'max_slots_per_host' => $plan['max'],
        ], $this->operators[0]);
    }

    /** The brand's hosts take free blocks in turn until about `$fill` % are taken. */
    private function claimBlocks(SpecialEvent $event, CarbonImmutable $at, int $fill): void
    {
        $this->at($at, function () use ($event, $fill) {
            $service = app(EventService::class);
            $total = count($event->blocks());

            foreach ($this->shuffled($this->brandHosts[$event->brand_id]) as $host) {
                foreach ($this->shuffled(range(1, $event->max_slots_per_host)) as $_) {
                    if (EventSlotClaim::active()->where('event_id', $event->id)->count() >= $total * $fill / 100) {
                        return;
                    }
                    $free = collect($service->blocks($event, $host))->where('state', 'free')->values();
                    if ($free->isEmpty()) {
                        break;
                    }
                    try {
                        $service->claim($event, $host, $free[mt_rand(0, $free->count() - 1)]['start_at'], $host->user);
                    } catch (ValidationException) {
                        break;
                    }
                }
            }
        });
    }

    /** Two or three hosts take kasbon within their limit (30-70 % of what's left), paid back over 1-4 periods. */
    private function recordKasbon(): void
    {
        $payroll = app(PayrollService::class);

        foreach (array_slice($this->shuffled(range(1, $this->scheduledHosts)), 0, mt_rand(2, 3)) as $number) {
            $available = $payroll->advanceLimit($this->hosts[$number])['available'];
            $amount = (int) floor($available * mt_rand(3, 7) / 10 / 50000) * 50000;
            if ($amount < 100000) {
                continue;
            }

            $loan = mt_rand(0, 1) === 1;
            $payroll->recordAdvance($this->hosts[$number], [
                'type' => $loan ? 'loan' : 'early_payment',
                'total_amount' => $amount,
                'installment_count' => $loan ? mt_rand(2, 4) : 1,
                'notes' => $loan ? ['Biaya kos', 'Servis motor', 'Biaya kuliah', 'Keperluan keluarga'][mt_rand(0, 3)] : 'Gajian dimajukan',
            ], $this->finance);
        }
    }

    /** Now and then an operator records a violation or a brand complaint (a few hosts collect several). */
    private function recordViolations(CarbonImmutable $day): void
    {
        $points = app(PointService::class);
        $operator = $this->operators[mt_rand(0, count($this->operators) - 1)];
        // Hosts 1-4 slip more often, so some reach an SP
        $pick = fn () => $this->hosts[mt_rand(1, 3) === 1 ? mt_rand(1, 4) : mt_rand(1, $this->scheduledHosts)];

        if (mt_rand(1, 100) <= 22) {
            $type = ViolationType::where('name', mt_rand(0, 1) ? 'Main HP saat live' : 'Ketiduran')->first();
            if ($type) {
                $points->deduct($pick(), $type, 'internal', 'Tercatat saat monitoring live.', $operator, extra: ['occurred_on' => $day->toDateString()]);
            }
        }

        if (mt_rand(1, 100) <= 6 && ($type = ViolationType::forCode(ViolationType::BRAND_COMPLAINT))) {
            $host = $pick();
            $brandId = $host->assignments()->value('brand_id');
            $complaint = BrandComplaint::create([
                'host_id' => $host->id,
                'brand_id' => $brandId,
                'description' => ['Salah sebut harga promo.', 'Produk tidak dijelaskan sesuai brief.', 'Live mulai terlambat tanpa kabar.'][mt_rand(0, 2)],
                'recorded_by' => $operator->id,
            ]);
            $points->deduct($host, $type, 'brand_complaint', $complaint->description, $operator, extra: [
                'brand_complaint_id' => $complaint->id,
                'occurred_on' => $day->toDateString(),
            ]);
        }
    }

    /** The admin rates every active host for the month that just ended, near the suggestion. */
    private function rateMonth(string $month): void
    {
        $ratings = app(RatingService::class);

        foreach ($this->hosts as $host) {
            $suggested = $ratings->suggested($host, $month);
            $rating = max(1, min(5, $suggested + mt_rand(-4, 2) / 10));
            $note = $rating >= 4.5 ? 'Konsisten dan disukai brand.' : ($rating < 3.5 ? 'Perlu perbaikan disiplin.' : null);
            $ratings->rate($host, $month, $rating, $note, $this->admin);
        }
    }

    /**
     * Leaders request payment the day after a period reaches its target (unless a report still
     * needs review); finance marks it paid two days later, except requests from the last week.
     * Two brands' leaders haven't requested their latest closed period yet.
     */
    private function settlePeriods(CarbonImmutable $today): void
    {
        $payroll = app(PayrollService::class);

        foreach ($this->brands as $index => $brand) {
            $brand->paymentPeriods()->where('status', 'waiting_payment')->whereDate('period_end', '<', today())->orderBy('period_start')->get()
                ->reject(fn (PaymentPeriod $period) => $index >= 8 && $period->period_end->gte($today->subWeek()))
                ->each(function (PaymentPeriod $period) use ($payroll, $brand) {
                    try {
                        $payroll->requestPayment($period, $this->leaders[$brand->id]);
                    } catch (ValidationException) {
                        // Waits, as in the app, e.g. for a flagged report
                    }
                });

            $brand->paymentPeriods()->where('status', 'requested')->get()
                ->filter(fn (PaymentPeriod $period) => $period->locked_at->lte(now()->subDays(2)) && $period->locked_at->lt($today->subWeek()))
                ->each(fn (PaymentPeriod $period) => $payroll->markPaid($period, sprintf('TRF-%s-%04d', now()->format('ymd'), mt_rand(1, 9999))));
        }
    }

    /**
     * Real clock: an event about to run with claims, one with no claims yet, a cancelled one,
     * then backups in the coming days (open with applicants, asked of named hosts, filled).
     */
    private function createUpcoming(CarbonImmutable $today): void
    {
        $events = app(EventService::class);
        $soon = $events->create([
            'brand_id' => $this->brands[2]->id,
            'name' => 'PD Batik Lestari',
            'start_date' => $today->addDays(3)->toDateString(),
            'end_date' => $today->addDays(4)->toDateString(),
            'daily_start_time' => '10:00',
            'daily_end_time' => '22:00',
            'block_minutes' => 180,
            'open_full_schedule' => true,
            'max_slots_per_host' => 2,
        ], $this->operators[0]);
        $this->claimBlocks($soon, CarbonImmutable::now(), 60);

        $events->create([
            'brand_id' => $this->brands[3]->id,
            'name' => 'Double Date Dapur Mama Ina',
            'start_date' => $today->addDays(10)->toDateString(),
            'end_date' => $today->addDays(10)->toDateString(),
            'daily_start_time' => '19:00',
            'daily_end_time' => '01:00',
            'block_minutes' => 60,
            'open_full_schedule' => false,
            'max_slots_per_host' => 2,
        ], $this->operators[1]);

        $events->cancel($events->create([
            'brand_id' => $this->brands[4]->id,
            'name' => 'Promo Akhir Bulan Sepatu Langkah',
            'start_date' => $today->addDays(6)->toDateString(),
            'end_date' => $today->addDays(6)->toDateString(),
            'daily_start_time' => '13:00',
            'daily_end_time' => '17:00',
            'block_minutes' => 120,
            'open_full_schedule' => false,
            'max_slots_per_host' => 1,
        ], $this->admin));

        $backups = app(BackupService::class);
        $made = 0;

        foreach ($this->shuffled($this->slots) as $slot) {
            if ($made >= 9) {
                break;
            }
            $date = $this->nextDate($slot->day_of_week);
            $owner = $slot->assignment->host;
            $others = collect($this->brandHosts[$slot->assignment->brand_id])->reject(fn (HostProfile $host) => $host->id === $owner->id)->values();
            if ($others->count() < 2) {
                continue;
            }

            try {
                $kind = $made % 3; // 0 open + applicants, 1 named hosts, 2 filled
                $nominees = $kind === 1 ? $others->shuffle()->take(2)->pluck('id')->all() : [];
                $request = $backups->create($slot, $date, [
                    'reason_type' => $kind === 2 ? 'sick' : 'permit',
                    'reason' => $kind === 2 ? 'Tifus, rawat jalan' : 'Wisuda kakak',
                ], $owner->user, byStaff: false, nomineeIds: $nominees);

                if ($kind !== 1) {
                    foreach ($others->shuffle()->take(mt_rand(1, 3)) as $host) {
                        try {
                            $backups->apply($request, $host);
                        } catch (ValidationException) {
                        }
                    }
                }
                if ($kind === 2 && ($picked = $backups->rankedApplicants($request->fresh())->first())) {
                    $backups->fill(BackupRequest::findOrFail($request->id), $picked->applicant, $this->admin);
                }
                $made++;
            } catch (ValidationException) {
                // That host was already busy or covered then; try another slot
            }
        }

    }

    /** Self-registered hosts waiting for an admin. */
    private function createSignups(): void
    {
        foreach (self::SIGNUPS as $index => $name) {
            User::create([
                'name' => $name,
                'email' => sprintf('daftar%02d@vidhelp.com', $index + 1),
                'password' => Hash::make(self::PASSWORD),
                'status' => 'pending',
                'signup_source' => 'self_register',
            ])->assignRole('host');
        }
    }

    private function slotHours(ScheduleSlot $slot): float
    {
        [$from, $to] = $slot->weekRange();

        return ($to - $from) / 60;
    }

    /** The next date on that ISO weekday, at least two days away. */
    private function nextDate(int $weekday): string
    {
        $date = CarbonImmutable::today()->addDays(2);
        while ($date->dayOfWeekIso !== $weekday) {
            $date = $date->addDay();
        }

        return $date->toDateString();
    }

    /** A shuffled copy, using the seeded generator so every run makes the same data. */
    private function shuffled(array $items): array
    {
        $items = array_values($items);
        for ($i = count($items) - 1; $i > 0; $i--) {
            $j = mt_rand(0, $i);
            [$items[$i], $items[$j]] = [$items[$j], $items[$i]];
        }

        return $items;
    }

    /** Run `$callback` with the app's clock set to `$time` (calls may nest). */
    private function at(CarbonImmutable $time, callable $callback): mixed
    {
        $previous = CarbonImmutable::hasTestNow() ? CarbonImmutable::getTestNow() : null;
        Carbon::setTestNow($time);
        CarbonImmutable::setTestNow($time);

        try {
            return $callback();
        } finally {
            Carbon::setTestNow($previous);
            CarbonImmutable::setTestNow($previous);
        }
    }
}
