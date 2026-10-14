<?php

namespace Database\Seeders;

use App\Models\BackupRequest;
use App\Models\Brand;
use App\Models\HostBrandAssignment;
use App\Models\HostProfile;
use App\Models\HostRateCategory;
use App\Models\PaymentPeriod;
use App\Models\ScheduleSlot;
use App\Models\User;
use App\Services\AttendanceService;
use App\Services\BackupService;
use App\Services\PayrollService;
use Carbon\Carbon;
use Carbon\CarbonImmutable;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * Demo data to click through the app: five hosts (host1@vidhelp.com … host5@vidhelp.com,
 * password "password"), two brands with weekly schedules, about seven weeks of live
 * sessions, a late check-in (points deducted), pay periods that close on the brand's target hours
 * (paid; Glow Skincare's latest requested by its leader Ayu; Kopi Nusantara's latest usually still
 * waiting for its leader Rizky to request; one running each), a kasbon, and backups to decide.
 *
 * Run: php artisan db:seed --class=DemoSeeder (after the normal seeders). Never in production.
 *
 * Past sessions go through the real services with the clock set back to their time,
 * so reports, paid hours, periods and slips come out exactly as the app would make them.
 */
class DemoSeeder extends Seeder
{
    private const PASSWORD = 'password';

    /** host number => name, months since joining (sets the rate level), bank */
    private const HOSTS = [
        1 => ['name' => 'Ayu Lestari', 'months' => 14, 'bank' => 'BCA'],
        2 => ['name' => 'Dimas Pratama', 'months' => 5, 'bank' => 'Mandiri'],
        3 => ['name' => 'Sinta Maharani', 'months' => 8, 'bank' => 'BRI'],
        4 => ['name' => 'Rizky Saputra', 'months' => 2, 'bank' => 'BNI'],
        5 => ['name' => 'Nadia Putri', 'months' => 1, 'bank' => 'BCA'],
    ];

    /** brand => [host number, ISO weekdays, start, end, leader] */
    private const SCHEDULE = [
        'Glow Skincare' => [
            [1, [1, 3, 5], '10:00', '12:00', true],
            [2, [2, 4], '13:00', '15:00', false],
            [3, [6], '19:00', '21:00', false],
        ],
        'Kopi Nusantara' => [
            [3, [1, 3], '19:00', '21:00', false],
            [4, [2, 4, 6], '10:00', '12:00', true],
            [5, [1, 2, 3, 4, 5], '15:00', '17:00', false],
        ],
    ];

    /** @var array<int, HostProfile> */
    private array $hosts = [];

    /** @var array<string, Brand> */
    private array $brands = [];

    /** @var array<string, User> brand name => its leader's user (the PIC who requests payment) */
    private array $leaders = [];

    /** @var array<int, list<ScheduleSlot>> host number => their slots */
    private array $slots = [];

    private User $admin;

    public function run(AttendanceService $attendance, PayrollService $payroll, BackupService $backups): void
    {
        if (app()->isProduction()) {
            $this->command->error('DemoSeeder does not run in production.');

            return;
        }
        if (User::where('email', 'host1@vidhelp.com')->exists()) {
            $this->command->warn('Demo data is already there (host1@vidhelp.com exists). Nothing was added.');

            return;
        }

        $this->admin = User::role('admin')->where('status', 'active')->firstOrFail();

        // Never post demo notifications to the real Discord server
        config(['services.discord.bot_token' => null]);

        // Payroll starts on the Monday about six weeks ago; a period ends when its target hours are reached
        $today = CarbonImmutable::today();
        $start = $today->subWeeks(6)->startOfWeek();

        mt_srand(2026);

        DB::transaction(function () use ($attendance, $payroll, $backups, $start, $today) {
            // Rates are seeded as Rp 0 placeholders; demo pay (and the kasbon limit) needs real-looking ones
            foreach (['Magang' => 20000, 'Baru' => 25000, 'Di atas 1 tahun' => 30000] as $name => $rate) {
                HostRateCategory::where('name', $name)->where('rate_per_hour', 0)->update(['rate_per_hour' => $rate]);
            }

            $this->at($start->subDay()->setTime(9, 0), function () use ($start, $today) {
                $this->createHosts($today);
                $this->createBrandsAndSchedule($start);
            });

            $this->playPastSessions($attendance, $payroll, $start, $today);
            $this->createBackups($backups);
        });

        $this->command->info('Demo data added. Sign in as host1@vidhelp.com … host5@vidhelp.com with password "password".');
        $this->command->info('Brand leaders (PIC): host1 (Glow Skincare), host4 (Kopi Nusantara, a period waiting for its request).');
    }

    /** Accounts are created as of the first period; join dates count back from the real today. */
    private function createHosts(CarbonImmutable $today): void
    {
        foreach (self::HOSTS as $number => $host) {
            $user = User::create([
                'name' => $host['name'],
                'email' => "host{$number}@vidhelp.com",
                'password' => Hash::make(self::PASSWORD),
                'status' => 'active',
                'signup_source' => 'admin_created',
                'approved_by' => $this->admin->id,
                'approved_at' => now(),
            ]);
            $user->assignRole('host');
            $user->ensureHostProfile();

            $profile = $user->hostProfile;
            $profile->fill([
                'join_date' => $today->subMonths($host['months'])->toDateString(),
                'phone' => sprintf('0812-5550-%04d', $number),
                'guardian_phone' => sprintf('0813-5550-%04d', $number),
            ]);
            $profile->syncRateCategory();
            $profile->save();

            $profile->sensitiveData()->create([
                'ktp_number' => sprintf('32010000000000%02d', $number),
                'bank_name' => $host['bank'],
                'bank_account' => sprintf('12345600%02d', $number),
                'account_holder_name' => $host['name'],
            ]);

            $this->hosts[$number] = $profile;
        }
    }

    private function createBrandsAndSchedule(CarbonImmutable $start): void
    {
        // About two weeks of their schedule each (12 and 20 hours a week)
        $targets = ['Glow Skincare' => 24, 'Kopi Nusantara' => 40];

        foreach (self::SCHEDULE as $brandName => $rows) {
            $brand = Brand::create([
                'name' => $brandName,
                'target_hours_per_period' => $targets[$brandName],
                'payroll_start_date' => $start->toDateString(),
                'status' => 'active',
            ]);
            $this->brands[$brandName] = $brand;

            foreach ($rows as [$number, $days, $from, $to, $leader]) {
                $assignment = HostBrandAssignment::create([
                    'host_id' => $this->hosts[$number]->id,
                    'brand_id' => $brand->id,
                    'is_leader' => $leader,
                    'status' => 'active',
                ]);
                if ($leader) {
                    $this->leaders[$brandName] = $this->hosts[$number]->user;
                }

                foreach ($days as $day) {
                    $this->slots[$number][] = ScheduleSlot::create([
                        'assignment_id' => $assignment->id,
                        'day_of_week' => $day,
                        'start_time' => $from,
                        'end_time' => $to,
                        'effective_from' => $start->toDateString(),
                        'status' => 'active',
                    ]);
                }
            }
        }
    }

    /**
     * Day by day from the first period to now: every session that has ended is checked in,
     * checked out and reported; pay periods are closed, requested and paid along the way.
     */
    private function playPastSessions(AttendanceService $attendance, PayrollService $payroll, CarbonImmutable $start, CarbonImmutable $today): void
    {
        // Dimas borrows on day 15
        $kasbonDay = 15;

        $lastAyu = $this->lastOccurrence(1, $today);
        $lastDimas = $this->lastOccurrence(2, $today);
        $lastRizky = $this->lastOccurrence(4, $today);

        for ($day = $start, $offset = 0; $day->lte($today); $day = $day->addDay(), $offset++) {
            $occurrences = collect($this->slots)
                ->flatMap(fn (array $slots, int $number) => collect($slots)->map(fn (ScheduleSlot $slot) => [$number, $slot]))
                ->filter(fn (array $pair) => $pair[1]->runsOn($day))
                ->map(fn (array $pair) => [...$pair, ...$pair[1]->occurrenceOn($day)])
                ->filter(fn (array $item) => $item[3]->lt(now()))
                ->sortBy(fn (array $item) => $item[2]);

            foreach ($occurrences as [$number, $slot, $sessionStart, $sessionEnd]) {
                $key = $slot->id.'|'.$day->toDateString();

                // Rizky's latest session: nobody checked in (shows as missed)
                if ($key === $lastRizky) {
                    continue;
                }

                // Nadia checks in 14 minutes late once: the "Telat" points are deducted; her hours still pass
                // (within the tolerance), so the periods close on the same days as without it
                $late = $number === 5 && $offset === 30;
                $checkInAt = $late ? $sessionStart->addMinutes(14) : $sessionStart->subMinutes(mt_rand(1, 8));

                $record = $this->at($checkInAt, fn () => $attendance->checkIn($this->hosts[$number], $slot->id, $day->toDateString(), null));
                $this->at($sessionEnd->addMinutes(mt_rand(0, 3)), fn () => $attendance->checkOut($record));

                // Ayu's latest session: checked out but no report yet (overdue)
                if ($key === $lastAyu) {
                    continue;
                }

                // Dimas's latest session: reported 30 minutes short, so it waits for review
                $hours = round($sessionStart->diffInMinutes($sessionEnd) / 60, 2);
                $reported = $key === $lastDimas ? $hours - 0.5 : $hours;

                $this->at($sessionEnd->addMinutes(mt_rand(10, 50)), fn () => $attendance->submitReport($record, [
                    'session_count' => 1,
                    'duration_hours' => $reported,
                    'metrics' => [
                        'gmv' => mt_rand(15, 60) * 100000,
                        'orders' => mt_rand(20, 140),
                        'viewers' => mt_rand(300, 3200),
                    ],
                    'notes' => null,
                ]));
            }

            $this->at($day->setTime(10, 0), function () use ($payroll, $offset, $kasbonDay, $today) {
                if ($offset === $kasbonDay) {
                    // Dimas borrows Rp 300.000 (his limit: 4 h a week × 52/12 × Rp 25.000 ≈ Rp 433.000), paid back in 3 installments
                    $payroll->recordAdvance($this->hosts[2], [
                        'type' => 'loan',
                        'total_amount' => 300000,
                        'installment_count' => 3,
                        'notes' => 'Biaya kos (demo)',
                    ], $this->admin);
                }
                $this->settlePeriods($payroll, $today);
            });
        }
    }

    /**
     * The brand's PIC requests payment the day after a period reaches its target (unless a report
     * still needs review); the brand pays two days later, except for requests from the last week.
     * Kopi Nusantara's PIC hasn't requested a period that closed in the last week yet, so it waits.
     */
    private function settlePeriods(PayrollService $payroll, CarbonImmutable $today): void
    {
        foreach ($this->brands as $name => $brand) {
            $brand->paymentPeriods()->where('status', 'waiting_payment')->whereDate('period_end', '<', today())->orderBy('period_start')->get()
                ->reject(fn (PaymentPeriod $period) => $name === 'Kopi Nusantara' && $period->period_end->gte($today->subWeek()))
                ->each(function (PaymentPeriod $period) use ($payroll, $name) {
                    try {
                        $payroll->requestPayment($period, $this->leaders[$name]);
                    } catch (ValidationException) {
                        // Waits, as in the app, e.g. for a flagged report
                    }
                });

            $brand->paymentPeriods()->where('status', 'requested')->get()
                ->filter(fn (PaymentPeriod $period) => $period->locked_at->lte(now()->subDays(2)) && $period->locked_at->lt($today->subWeek()))
                ->each(fn (PaymentPeriod $period) => $payroll->markPaid($period));
        }
    }

    /**
     * Backups in the coming days, made as the app would (real clock):
     * an open request with two applicants, a request to named hosts, and one already covered.
     */
    private function createBackups(BackupService $backups): void
    {
        // Nadia (Kopi, Tue 15-17): open to everyone; Dimas and Sinta offer to cover
        $open = $backups->create($this->nextSlot(5, 2), $this->nextDate(2), ['reason_type' => 'permit', 'reason' => 'Acara keluarga'], $this->hosts[5]->user, byStaff: false);
        $backups->apply($open, $this->hosts[2]);
        $backups->apply($open, $this->hosts[3]);

        // Ayu (Glow, Wed 10-12): asks Dimas and Sinta by name
        $backups->create($this->nextSlot(1, 3), $this->nextDate(3), ['reason_type' => 'permit', 'reason' => 'Ujian kampus'], $this->hosts[1]->user, byStaff: false, nomineeIds: [$this->hosts[2]->id, $this->hosts[3]->id]);

        // Rizky (Kopi, Thu 10-12): sick, Nadia applied and the admin approved her
        $filled = $backups->create($this->nextSlot(4, 4), $this->nextDate(4), ['reason_type' => 'sick', 'reason' => 'Demam'], $this->hosts[4]->user, byStaff: false);
        $backups->apply($filled, $this->hosts[5]);
        $backups->fill(BackupRequest::findOrFail($filled->id), $this->hosts[5], $this->admin);
    }

    /** The host's slot on that ISO weekday. */
    private function nextSlot(int $number, int $weekday): ScheduleSlot
    {
        return collect($this->slots[$number])->first(fn (ScheduleSlot $slot) => $slot->day_of_week === $weekday);
    }

    /** The next date on that ISO weekday, at least two days away (so it is clearly upcoming). */
    private function nextDate(int $weekday): string
    {
        $date = CarbonImmutable::today()->addDays(2);
        while ($date->dayOfWeekIso !== $weekday) {
            $date = $date->addDay();
        }

        return $date->toDateString();
    }

    /** "slot id|date" of the host's most recent session that has already ended. */
    private function lastOccurrence(int $number, CarbonImmutable $today): ?string
    {
        for ($day = $today; $day->gte($today->subDays(8)); $day = $day->subDay()) {
            foreach ($this->slots[$number] as $slot) {
                if ($slot->runsOn($day) && $slot->occurrenceOn($day)[1]->lt(now())) {
                    return $slot->id.'|'.$day->toDateString();
                }
            }
        }

        return null;
    }

    /** Run `$callback` with the app's clock set to `$time`. */
    private function at(CarbonImmutable $time, callable $callback): mixed
    {
        Carbon::setTestNow($time);
        CarbonImmutable::setTestNow($time);

        try {
            return $callback();
        } finally {
            Carbon::setTestNow();
            CarbonImmutable::setTestNow();
        }
    }
}
