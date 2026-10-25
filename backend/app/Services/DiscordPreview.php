<?php

namespace App\Services;

use App\Models\AppNotification;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Validation\ValidationException;

/**
 * A made-up example of every notification type, sent to a Discord channel or a DM to see
 * how they look. Nothing is saved and nobody is pinged (the pings show without notifying).
 */
class DiscordPreview
{
    public function __construct(private DiscordClient $discord) {}

    /**
     * The Discord channel to post to: "backups", "admin", or the DM of a user who linked Discord.
     */
    public function channelFor(string|User $to): string
    {
        if (! $this->discord->configured()) {
            throw ValidationException::withMessages(['to' => ['Bot Discord belum dikonfigurasi di server.']]);
        }

        if ($to instanceof User) {
            $link = $to->discordLink ?? throw ValidationException::withMessages(['to' => ["{$to->name} belum menghubungkan Discord."]]);

            return $link->dm_channel_id ?? $this->discord->openDm($link->discord_user_id);
        }

        return config("services.discord.channels.{$to}")
            ?? throw ValidationException::withMessages(['to' => ['Channel Discord ini belum diatur di .env.']]);
    }

    /** Post the example of one type. Throws when Discord refuses it. */
    public function send(string $channelId, string $type): void
    {
        $notice = $this->samples()[$type] ?? throw ValidationException::withMessages(['type' => ["Tidak ada contoh untuk {$type}."]]);

        // Staff alerts show the admin role ping they would carry in #admin-alerts
        $roles = $notice->resolvedCategory() === 'admin' ? array_values(array_filter([config('services.discord.roles.admin')])) : [];

        $row = new AppNotification([
            'type' => $notice->type,
            'title' => $notice->title,
            'body' => $notice->body,
            'link' => $notice->link,
            'payload' => array_filter([...$notice->payload(), 'mentions' => $roles ? ['roles' => $roles] : null]),
        ]);
        $row->created_at = now();

        $message = DiscordMessage::for($row);
        $message['content'] = trim("🧪 Contoh `{$type}` ".($message['content'] ?? ''));
        $message['allowed_mentions'] = ['parse' => []];

        $this->discord->postMessage($channelId, $message);
    }

    /** @return list<string> */
    public function types(): array
    {
        return array_keys($this->samples());
    }

    /**
     * One example notice per type, with the fields the real one has.
     *
     * @return array<string, Notice>
     */
    public function samples(): array
    {
        $start = CarbonImmutable::tomorrow()->setTime(14, 0);
        $end = $start->addHours(2);
        $autoFill = $start->subMinutes((int) config('vidhelp.backup.auto_fill_before_minutes'));
        $brand = 'Brand Contoh';
        $text = "{$brand} · {$start->translatedFormat('D j M H:i')}–{$end->format('H:i')}";
        $window = Notice::window($start, $end);
        $requester = 'Nina Putri';
        $cover = 'Rina Sari';
        $period = $start->subDays(30)->translatedFormat('j M').' – '.$start->subDay()->translatedFormat('j M Y');

        $backup = fn (string $type, string $title) => Notice::make($type, $title)->brand($brand)->field('Waktu', $window, inline: false);

        $samples = [
            Notice::make('signup_pending', 'Pendaftar baru: Dewi Lestari')
                ->body('dewi@contoh.com menunggu persetujuan.')
                ->field('Nama', 'Dewi Lestari')->field('Email', 'dewi@contoh.com')->field('Daftar lewat', 'Google')
                ->link('/admin/users', 'Tinjau pendaftar'),
            Notice::make('account_approved', 'Akunmu sudah disetujui')
                ->body('Selamat datang di VidHelp! Kamu sudah bisa masuk.')
                ->field('Disetujui oleh', 'Admin')
                ->link('/host/dashboard', 'Mulai'),

            Notice::make('profile_change_requested', "Perubahan data: {$requester}")
                ->body('No. HP, Nomor rekening. Setujui atau tolak di halaman Host.')
                ->field('Host', $requester)->field('Data yang diubah', 'No. HP, Nomor rekening', inline: false)
                ->link('/admin/hosts?changes=pending', 'Tinjau perubahan'),
            Notice::make('profile_change_approved', 'Perubahan data disetujui')
                ->body('Data pribadimu sudah diperbarui.')
                ->field('Data yang diubah', 'No. HP, Nomor rekening', inline: false)->field('Disetujui oleh', 'Admin')
                ->link('/host/profile', 'Lihat profil'),
            Notice::make('profile_change_rejected', 'Perubahan data ditolak')
                ->body('Rekening tidak sesuai nama.')
                ->field('Data yang diubah', 'Nomor rekening', inline: false)->field('Ditolak oleh', 'Admin')
                ->field('Catatan', 'Rekening tidak sesuai nama.', inline: false)
                ->link('/host/profile', 'Perbaiki data'),
            Notice::make('discord_linked', 'Discord terhubung ke akunmu')
                ->body('Discord Samuel sekarang menerima notifikasi dan link atur ulang kata sandi akunmu. Kalau bukan kamu yang menghubungkannya, putuskan Discord itu dan ganti kata sandimu.')
                ->field('Discord', 'Samuel')
                ->link('/host/profile', 'Buka pengaturan akun'),

            Notice::make('report_flagged', "Laporan perlu dicek: {$requester}")
                ->body("{$brand}, {$start->translatedFormat('D j M H:i')}: dikirim terlambat, waktu lebih singkat dari jadwal.")
                ->brand($brand)
                ->field('Host', $requester)->field('Durasi dilaporkan', '1,5 jam')
                ->field('Sesi', $window, inline: false)
                ->field('Check-in', '14:07')->field('Check-out', '15:35')
                ->field('Alasan', "• dikirim terlambat\n• waktu lebih singkat dari jadwal", inline: false)
                ->link('/operator/reports', 'Cek laporan'),
            Notice::make('report_rejected', 'Laporan live kamu ditolak')
                ->body("{$brand}, {$start->translatedFormat('D j M H:i')}: Screenshot GMV tidak terbaca.")
                ->brand($brand)
                ->field('Sesi', $window, inline: false)->field('Durasi dilaporkan', '2 jam')->field('Ditolak oleh', 'Operator')
                ->field('Catatan', 'Screenshot GMV tidak terbaca.', inline: false)
                ->link('/host/live', 'Buka laporan'),

            $backup('backup_opened', "Butuh backup: {$brand}")
                ->body("{$start->translatedFormat('D j M H:i')}–{$end->format('H:i')} · untuk {$requester}. Daftar di tab Backup.")
                ->field('Untuk', $requester)->field('Dipilih otomatis', Notice::time($autoFill), inline: false)
                ->link('/host/backups', 'Daftar di VidHelp'),
            $backup('backup_asked', "Minta digantikan: {$requester} di {$brand}")
                ->body("{$start->translatedFormat('D j M H:i')}–{$end->format('H:i')}. Hanya host yang diminta yang bisa mendaftar.")
                ->field('Untuk', $requester)->field('Yang diminta', "{$cover}, Maya Anggraini")
                ->field('Dipilih otomatis', Notice::time($autoFill), inline: false)
                ->link('/host/backups', 'Daftar di VidHelp'),
            $backup('backup_applied', "{$cover} ingin menggantikan {$requester}")
                ->body("{$text}. Setujui atau tolak sebelum {$autoFill->translatedFormat('D j M H:i')}, atau pendaftar terbaik dipilih otomatis.")
                ->field('Pendaftar', $cover)->field('Menggantikan', $requester)->field('Brand', 'Brand sendiri')
                ->field('Poin', 92)->field('Rating terakhir', '4/5')
                ->field('Putuskan sebelum', Notice::time($autoFill), inline: false)
                ->link('/operator/backups', 'Tinjau pendaftar'),
            $backup('backup_picked', "Kamu menggantikan di {$brand}")
                ->body("{$text}, untuk {$requester}.")
                ->field('Untuk', $requester)->field('Dipilih oleh', 'Admin')
                ->link('/host/schedule', 'Lihat jadwal'),
            $backup('backup_covered', 'Backup kamu sudah ada penggantinya')
                ->body("{$cover} menggantikan {$text}.")
                ->field('Pengganti', $cover)->field('Dipilih oleh', 'Admin')
                ->link('/host/backups', 'Lihat backup'),
            $backup('backup_filled', "Backup terisi: {$brand}")
                ->body("{$cover} menggantikan {$requester}.")
                ->field('Pengganti', $cover)->field('Untuk', $requester)
                ->link('/host/backups'),
            $backup('backup_not_picked', "Kamu tidak terpilih menggantikan di {$brand}")
                ->body("{$text}, untuk {$requester}.")
                ->field('Untuk', $requester)
                ->link('/host/backups', 'Cari backup lain'),
            $backup('backup_reopened', 'Permintaan backup kamu dibuka lagi')
                ->body("{$text}: pendaftar tidak disetujui. Host lain masih bisa mendaftar.")
                ->field('Pendaftar yang ditolak', $cover)
                ->link('/host/backups', 'Lihat permintaan'),
            $backup('backup_unassigned', "Kamu tidak lagi menggantikan di {$brand}")
                ->body("{$start->translatedFormat('D j M H:i')}–{$end->format('H:i')}: admin mencabut penugasanmu. Kamu libur di sesi ini.")
                ->field('Untuk', $requester)
                ->link('/host/schedule', 'Lihat jadwal'),
            $backup('backup_cancelled', "Backup dibatalkan: {$brand}")
                ->body("{$text}: {$requester} tidak lagi butuh pengganti.")
                ->field('Untuk', $requester)->field('Pengganti', $cover)
                ->link('/host/backups'),
            $backup('backup_auto_picked', "Otomatis memilih {$cover}")
                ->body("Menggantikan {$requester} pada {$text}; tidak ada keputusan sebelum batas waktu.")
                ->field('Pengganti', $cover)->field('Untuk', $requester)
                ->link('/operator/backups', 'Lihat backup'),
            $backup('backup_no_cover', "Tidak ada yang bisa menggantikan {$requester}")
                ->body("{$text} segera dimulai dan belum ada host yang memenuhi syarat mendaftar. Tunjuk pengganti secara manual.")
                ->field('Untuk', $requester)->field('Pendaftar', 'Belum ada')
                ->link('/operator/backups', 'Tunjuk pengganti'),
            $backup('backup_decision_due', "Pendaftar backup {$requester} belum diputuskan")
                ->body("{$brand}: 2 pendaftar menunggu. Yang terbaik dipilih otomatis pukul {$autoFill->format('H:i')}.")
                ->field('Untuk', $requester)->field('Pendaftar', 2)
                ->field('Dipilih otomatis', Notice::time($autoFill), inline: false)
                ->link('/operator/backups', 'Putuskan sekarang'),

            Notice::make('event_opened', "Event baru: PD 11.11 ({$brand})")
                ->body("{$start->translatedFormat('j M')} – {$start->addDay()->translatedFormat('j M')}, 10:00–22:00. Ambil blokmu di menu Event (maks 2).")
                ->brand($brand)
                ->field('Tanggal', $start->translatedFormat('l, j F Y').' – '.$start->addDay()->translatedFormat('l, j F Y'), inline: false)
                ->field('Jam harian', '10:00–22:00')->field('Panjang blok', '120 menit')->field('Maks per host', '2 blok')
                ->link('/host/events', 'Ambil blok'),
            Notice::make('event_updated', "Jadwal event berubah: PD 11.11 ({$brand})")
                ->body("Sekarang {$start->translatedFormat('j M')} – {$start->addDay()->translatedFormat('j M')}, 10:00–23:00, blok 120 menit. Blok yang sudah kamu ambil tetap milikmu.")
                ->brand($brand)
                ->field('Tanggal', "{$start->translatedFormat('j M')} – {$start->addDay()->translatedFormat('j M')}")
                ->field('Jam harian', '10:00–23:00')->field('Panjang blok', '120 menit')
                ->link('/host/events', 'Lihat blok'),
            Notice::make('event_deleted', "Event dihapus: PD 11.11 ({$brand})")
                ->body('Event ini dihapus admin, jadi blok yang kamu ambil di event ini ikut dilepas.')
                ->brand($brand)
                ->link('/host/events', 'Lihat event lain'),

            Notice::make('period_ready', "Target 100 jam {$brand} tercapai")
                ->body("{$period}: 100 jam bisa ditagihkan. Ajukan pembayaran ke brand.")
                ->brand($brand)
                ->field('Periode', $period)->field('Jam ditagihkan', '100 / 100 jam')
                ->field('Pindah ke periode berikutnya', '4,5 jam')->field('Ditutup oleh', 'Otomatis (target tercapai)')
                ->link('/host/pay', 'Ajukan pembayaran'),
            Notice::make('payment_requested', "Pembayaran {$brand} diajukan")
                ->body("{$requester} mengajukan 100 jam untuk {$period}. Tandai lunas setelah brand membayar.")
                ->brand($brand)
                ->field('Periode', $period)->field('Jam ditagihkan', '100 jam')->field('Diajukan oleh', $requester)
                ->link('/admin/payroll', 'Tandai lunas'),
            Notice::make('slip_ready', "Slip gaji siap: {$brand}")
                ->body("Gaji bersih Rp 1.850.000 untuk {$period}.")
                ->brand($brand)
                ->field('Periode', $period)->field('Jam dibayar', '42 jam')
                ->field('Gaji kotor', 'Rp 2.100.000')->field('Potongan kasbon', 'Rp 250.000')->field('Gaji bersih', 'Rp 1.850.000')
                ->link('/host/pay', 'Lihat slip'),

            Notice::make('points_deducted', '-10 poin: Telat')
                ->body('Telat 25 menit. Poinmu sekarang 80.')
                ->field('Pelanggaran', 'Telat')->field('Perubahan', '-10 poin')->field('Poin sekarang', 80)
                ->field('Alasan', 'Telat 25 menit', inline: false)->field('SP berikutnya', 'SP1 di 75 poin')
                ->link('/host/rating', 'Lihat poin'),
            Notice::make('sp_issued', 'Kamu mendapat SP1')
                ->body('Poin turun ke 75 atau di bawahnya.')
                ->field('Level', 'SP1')->field('Poin sekarang', 72)
                ->field('Alasan', 'Poin turun ke 75 atau di bawahnya.', inline: false)
                ->link('/host/rating', 'Lihat poin dan SP'),

            Notice::make('reminder_live_soon', "Live di {$brand} mulai pukul {$start->format('H:i')}")
                ->body('Jangan lupa check-in. Check-in dibuka '.config('vidhelp.attendance.check_in_opens_minutes').' menit sebelum mulai.')
                ->brand($brand)
                ->field('Waktu', $window, inline: false)->field('Sesi', 'Jadwal rutin')
                ->link('/host/live', 'Check-in sekarang'),
            Notice::make('reminder_check_in', "Kamu belum check-in di {$brand}")
                ->body("Sesi sudah mulai pukul {$start->format('H:i')}. Check-in lebih dari ".config('vidhelp.attendance.late_after_minutes').' menit setelah mulai dihitung telat.')
                ->brand($brand)
                ->field('Waktu', $window, inline: false)->field('Sesi', "Menggantikan {$requester}")
                ->link('/host/live', 'Check-in sekarang'),
            Notice::make('reminder_report_due', "Laporan live {$brand} belum dikirim")
                ->body("Kirim sebelum {$end->addDay()->translatedFormat('D j M H:i')}. Laporan yang terlambat ditandai dan dicek admin.")
                ->brand($brand)
                ->field('Sesi', $window, inline: false)->field('Batas kirim', Notice::time($end->addDay()), inline: false)
                ->link('/host/live', 'Kirim laporan'),
            Notice::make('reminder_sick_letter', "Surat sakit untuk {$brand} belum diunggah")
                ->body("Unggah sebelum {$start->addDay()->translatedFormat('D j M H:i')}. Kalau terlambat, poinmu dipotong dan kamu membayar penggantimu sendiri.")
                ->brand($brand)
                ->field('Sesi', $window, inline: false)->field('Batas unggah', Notice::time($start->addDay()), inline: false)
                ->link('/host/backups', 'Unggah surat'),
        ];

        return collect($samples)->keyBy(fn (Notice $notice) => $notice->type)->all();
    }
}
