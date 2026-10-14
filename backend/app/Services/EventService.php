<?php

namespace App\Services;

use App\Models\Attendance;
use App\Models\EventSlotClaim;
use App\Models\HostProfile;
use App\Models\SpecialEvent;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Special events: creating them, the block grid, and claiming / assigning / releasing blocks.
 */
class EventService
{
    public function __construct(private HostCalendar $calendar, private Notifier $notifier)
    {
    }

    public function create(array $attributes, User $by): SpecialEvent
    {
        $this->ensureNoOverlap($attributes['brand_id'], $attributes['start_date'], $attributes['end_date']);

        $event = SpecialEvent::create([...$attributes, 'status' => 'active', 'created_by' => $by->id])->load('brand');

        $days = $event->start_date->translatedFormat('j M').($event->end_date->equalTo($event->start_date) ? '' : ' – '.$event->end_date->translatedFormat('j M'));
        $hosts = $this->notifier->hosts($event->brand_id);
        $notice = Notice::make('event_opened', "Event baru: {$event->name} ({$event->brand->name})")
            ->body("{$days}, {$event->daily_start_time}–{$event->daily_end_time}. Ambil blokmu di menu Event (maks {$event->max_slots_per_host}).")
            ->brand($event->brand->name)
            ->field('Tanggal', $event->start_date->translatedFormat('l, j F Y').($event->end_date->equalTo($event->start_date) ? '' : ' – '.$event->end_date->translatedFormat('l, j F Y')), inline: false)
            ->field('Jam harian', "{$event->daily_start_time}–{$event->daily_end_time}")
            ->field('Panjang blok', "{$event->block_minutes} menit")
            ->field('Maks per host', "{$event->max_slots_per_host} blok")
            ->link('/host/events', 'Ambil blok');
        $this->notifier->toUsers($hosts, $notice);
        $this->notifier->toChannel('backups', $notice->mention($hosts));

        return $event;
    }

    /** Only settings that don't move existing blocks can change. */
    public function update(SpecialEvent $event, array $attributes): SpecialEvent
    {
        $event->update($attributes);

        return $event;
    }

    public function cancel(SpecialEvent $event): void
    {
        DB::transaction(function () use ($event) {
            $event->update(['status' => 'cancelled']);
            $event->claims()->active()->update(['status' => 'cancelled']);
        });
    }

    /**
     * Every block with who holds it. With a host `$viewer`, also whether they can claim it:
     * mine | taken | past | unavailable (brand's regular schedule) | busy (the host) | free.
     *
     * @return list<array<string, mixed>>
     */
    public function blocks(SpecialEvent $event, ?HostProfile $viewer = null): array
    {
        $blocks = $event->blocks();
        if ($blocks === []) {
            return [];
        }

        $claims = $event->claims()->active()->with('host.user')->get()
            ->keyBy(fn (EventSlotClaim $claim) => $claim->start_at->format('Y-m-d H:i'));

        $from = $blocks[0][0];
        $to = end($blocks)[1];
        $brandBusy = $event->open_full_schedule ? collect() : $this->calendar->brandIntervals($event->brand_id, $from, $to);
        $hostBusy = $viewer ? $this->calendar->hostIntervals($viewer, $from, $to) : collect();

        return array_map(function (array $block) use ($claims, $brandBusy, $hostBusy, $viewer) {
            [$start, $end] = $block;
            $claim = $claims->get($start->format('Y-m-d H:i'));
            $reason = null;

            if ($claim) {
                $state = $viewer && $claim->host_id === $viewer->id ? 'mine' : 'taken';
            } elseif ($start->lte(now())) {
                $state = 'past';
            } elseif ($reason = $this->calendar->reasonIn($brandBusy, $start, $end)) {
                $state = 'unavailable';
            } elseif ($viewer && ($reason = $this->calendar->reasonIn($hostBusy, $start, $end))) {
                $state = 'busy';
            } else {
                $state = 'free';
            }

            return [
                'start_at' => $start,
                'end_at' => $end,
                'state' => $state,
                'reason' => $reason,
                'claim' => $claim ? [
                    'id' => $claim->id,
                    'host_id' => $claim->host_id,
                    'host_name' => $claim->host->user->name,
                ] : null,
            ];
        }, $blocks);
    }

    /**
     * Give a block to a host. A host claiming for themselves must be on the brand and under
     * the event's limit; an admin/operator (`$asManager`) can assign anyone and take over a
     * block someone else holds.
     */
    public function claim(SpecialEvent $event, HostProfile $host, CarbonInterface $start, User $by, bool $asManager = false): EventSlotClaim
    {
        return DB::transaction(function () use ($event, $host, $start, $by, $asManager) {
            // One claim at a time per event, so two hosts can't take the same block
            $event = SpecialEvent::lockForUpdate()->findOrFail($event->id);

            if ($event->status !== 'active') {
                $this->fail('Event ini sudah dibatalkan.');
            }

            [$blockStart, $blockEnd] = $event->blockAt($start) ?? $this->fail("Itu bukan salah satu blok event ini.");

            if (($asManager ? $blockEnd : $blockStart)->lte(now())) {
                $this->fail($asManager ? 'Blok ini sudah selesai.' : 'Blok ini sudah dimulai.');
            }

            if (! $asManager) {
                $onBrand = $host->assignments()->where('brand_id', $event->brand_id)->where('status', 'active')->exists();
                if (! $onBrand) {
                    $this->fail("Hanya host {$event->brand->name} yang bisa mengambil blok ini.");
                }

                $held = EventSlotClaim::active()->where('event_id', $event->id)->where('host_id', $host->id)->count();
                if ($held >= $event->max_slots_per_host) {
                    $this->fail("Kamu sudah mengambil maksimal {$event->max_slots_per_host} blok untuk event ini.");
                }
            }

            $current = EventSlotClaim::active()->where('event_id', $event->id)->where('start_at', $blockStart)->first();
            if ($current?->host_id === $host->id) {
                $this->fail('Blok ini sudah dipegang host tersebut.');
            }
            if ($current && ! $asManager) {
                $this->fail('Blok ini sudah diambil orang lain.');
            }

            if (! $event->open_full_schedule) {
                $brandBusy = $this->calendar->brandIntervals($event->brand_id, $blockStart, $blockEnd);
                if ($reason = $this->calendar->reasonIn($brandBusy, $blockStart, $blockEnd)) {
                    $this->fail($reason);
                }
            }

            if ($reason = $this->calendar->busyReason($host, $blockStart, $blockEnd)) {
                $this->fail($reason);
            }

            $current?->update(['status' => 'overridden']);

            return EventSlotClaim::create([
                'event_id' => $event->id,
                'host_id' => $host->id,
                'start_at' => $blockStart,
                'end_at' => $blockEnd,
                'status' => 'active',
                'claimed_by' => $by->id,
                'claimed_at' => now(),
            ]);
        });
    }

    /**
     * Give a block back. Hosts can until it starts; admins/operators until it ends.
     */
    public function release(EventSlotClaim $claim, bool $asManager = false): void
    {
        if ($claim->status !== 'active') {
            $this->fail('Blok ini sudah tidak dipegang siapa pun.');
        }
        if (($asManager ? $claim->end_at : $claim->start_at)->lte(now())) {
            $this->fail($asManager ? 'Blok ini sudah selesai.' : 'Blok ini sudah dimulai.');
        }
        if (Attendance::where('event_claim_id', $claim->id)->exists()) {
            $this->fail('Host sudah check-in untuk blok ini.');
        }

        $claim->update(['status' => 'cancelled']);
    }

    private function ensureNoOverlap(string $brandId, string $startDate, string $endDate, ?string $exceptId = null): void
    {
        $clash = SpecialEvent::where('brand_id', $brandId)
            ->where('status', 'active')
            ->when($exceptId, fn ($q) => $q->whereKeyNot($exceptId))
            ->whereDate('start_date', '<=', $endDate)
            ->whereDate('end_date', '>=', $startDate)
            ->first();

        if ($clash) {
            throw ValidationException::withMessages(['start_date' => ["{$clash->name} sudah berjalan untuk brand ini di sebagian hari tersebut."]]);
        }
    }

    private function fail(string $message): never
    {
        throw ValidationException::withMessages(['start_at' => [$message]]);
    }
}
