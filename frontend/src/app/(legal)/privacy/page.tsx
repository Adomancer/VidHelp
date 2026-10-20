import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc, Section } from "@/components/LegalDoc";
import { legal } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Kebijakan Privasi - VidHelp",
  description: "Data apa yang dikumpulkan VidHelp dan bot Discord VidHelp, dan bagaimana data itu digunakan.",
};

export default function PrivacyPage() {
  return (
    <LegalDoc title="Kebijakan Privasi" effectiveDate={legal.effectiveDate}>
      <p>
        Kebijakan ini menjelaskan data apa yang dikumpulkan oleh VidHelp, yaitu aplikasi web manajemen agensi host live streaming beserta
        bot Discord VidHelp, untuk apa data itu digunakan, dan apa hak kamu atas data tersebut. Dengan memakai VidHelp, kamu menyetujui
        kebijakan ini.
      </p>

      <Section title="1. Data yang kami kumpulkan">
        <ul>
          <li>
            <strong>Akun:</strong> nama, alamat email, kata sandi (disimpan dalam bentuk hash, bukan teks asli), foto profil, dan ID Google
            jika kamu masuk dengan Google.
          </li>
          <li>
            <strong>Profil host:</strong> nomor HP, nomor HP wali, dan tanggal bergabung.
          </li>
          <li>
            <strong>Data sensitif:</strong> nomor KTP dan data rekening bank (nama bank, nomor rekening, nama pemilik) untuk keperluan
            pembayaran. Data ini hanya bisa dilihat oleh admin dan finance.
          </li>
          <li>
            <strong>Data kerja:</strong> jadwal, ketersediaan, check-in dan check-out, laporan live, jam kerja, backup, poin, rating, dan
            catatan pelanggaran.
          </li>
          <li>
            <strong>Data keuangan:</strong> perhitungan gaji, slip gaji, dan kasbon.
          </li>
          <li>
            <strong>Keamanan:</strong> pengaturan verifikasi dua langkah, waktu login terakhir, dan log audit perubahan data.
          </li>
        </ul>
      </Section>

      <Section title="2. Bot Discord VidHelp">
        <p>
          Menghubungkan akun Discord itu opsional. Kalau kamu memilih &quot;Hubungkan Discord&quot;, kamu akan diarahkan ke halaman izin
          resmi Discord, dan VidHelp meminta izin berikut:
        </p>
        <ul>
          <li>
            <strong>identify:</strong> untuk membaca ID dan nama pengguna Discord kamu.
          </li>
          <li>
            <strong>guilds.join:</strong> untuk menambahkan kamu ke server Discord agensi, supaya bot bisa mengirim pesan langsung (DM) ke
            kamu.
          </li>
        </ul>
        <p>Yang kami simpan dari Discord:</p>
        <ul>
          <li>ID pengguna Discord dan nama tampilan atau username kamu</li>
          <li>ID channel DM antara bot dan kamu</li>
          <li>Kategori notifikasi yang kamu matikan, dan apakah Discord sedang menolak DM ke kamu</li>
          <li>Waktu akun Discord kamu dihubungkan</li>
        </ul>
        <p>
          Token akses dari Discord hanya dipakai sekali untuk menambahkan kamu ke server, dan tidak disimpan. Bot{" "}
          <strong>tidak</strong> membaca isi pesan, daftar server, atau teman kamu, dan tidak menyimpan pesan yang kamu kirim di Discord.
        </p>
        <p>
          Bot mengirim notifikasi dari VidHelp, misalnya pengingat jadwal, info backup, status akun, dan link atur ulang kata sandi yang kamu minta, sebagai DM ke kamu atau sebagai pesan di
          channel server agensi. Riwayat pengiriman notifikasi (judul, isi, waktu, dan status terkirim) disimpan di VidHelp.
        </p>
        <p>
          Saat kamu memakai command bot seperti /jadwal, /backup, /poin, atau /gaji, bot memakai ID Discord kamu untuk mencari akun VidHelp
          yang terhubung. Jawabannya hanya terlihat oleh kamu. Command /clear hanya bisa dipakai pengurus server yang punya izin mengelola pesan.
          Bot menghapus pesan di channel itu memakai ID pesan saja, tanpa membaca atau menyimpan isinya.
        </p>
        <p>
          Kamu bisa memutuskan Discord kapan saja dari halaman profil atau akun di VidHelp. Data penghubung Discord kamu langsung dihapus, dan bot berhenti mengirim
          DM.
        </p>
      </Section>

      <Section title="3. Cara kami menggunakan data">
        <ul>
          <li>Menjalankan VidHelp: mengatur jadwal, absensi, laporan live, backup, dan penilaian host</li>
          <li>Menghitung dan membayar gaji</li>
          <li>Mengirim notifikasi di aplikasi, lewat email, dan lewat Discord</li>
          <li>Menjaga keamanan akun dan mencatat siapa mengubah apa</li>
        </ul>
        <p>Kami tidak menjual data kamu dan tidak memakainya untuk iklan.</p>
      </Section>

      <Section title="4. Siapa yang bisa melihat data">
        <p>
          Di dalam agensi, akses dibatasi sesuai peran (admin, operator, finance, host). Host hanya melihat data miliknya sendiri. Di luar agensi,
          data hanya diproses oleh layanan yang kami perlukan untuk menjalankan VidHelp:
        </p>
        <ul>
          <li>
            <strong>Discord:</strong> untuk mengirim notifikasi, jika kamu menghubungkan akun Discord
          </li>
          <li>
            <strong>Google:</strong> untuk masuk dengan akun Google, jika kamu memilihnya
          </li>
          <li>
            <strong>Penyedia hosting dan email:</strong> tempat aplikasi dan database berjalan, dan pengirim email
          </li>
        </ul>
        <p>Kami juga bisa membuka data jika diwajibkan oleh hukum.</p>
      </Section>

      <Section title="5. Penyimpanan dan keamanan">
        <p>
          Data disimpan selama akun kamu aktif. Akses admin dan finance wajib memakai verifikasi dua langkah, dan perubahan data penting
          dicatat di log audit. Jika akun dihapus permanen, data pribadi kamu dianonimkan, tetapi catatan jam kerja dan riwayat gaji tetap
          disimpan untuk keperluan pembukuan.
        </p>
      </Section>

      <Section title="6. Hak kamu">
        <p>Sesuai Undang-Undang Pelindungan Data Pribadi (UU No. 27 Tahun 2022), kamu berhak untuk:</p>
        <ul>
          <li>Melihat data pribadi kamu di aplikasi</li>
          <li>Meminta koreksi data yang salah</li>
          <li>Memutuskan akun Discord kapan saja</li>
          <li>Meminta akun dan data pribadi kamu dihapus</li>
        </ul>
        <p>Untuk permintaan ini, hubungi admin agensi atau email di bawah.</p>
      </Section>

      <Section title="7. Perubahan kebijakan">
        <p>
          Kebijakan ini bisa diperbarui. Tanggal di bagian atas halaman menunjukkan versi terbaru. Perubahan besar akan kami umumkan di
          aplikasi.
        </p>
      </Section>

      <Section title="8. Kontak">
        <p>
          Pertanyaan tentang privasi bisa dikirim ke{" "}
          <a href={`mailto:${legal.contactEmail}`} className="font-medium text-primary underline-offset-4 hover:underline">
            {legal.contactEmail}
          </a>
          . Lihat juga{" "}
          <Link href="/terms" className="font-medium text-primary underline-offset-4 hover:underline">
            Ketentuan Layanan
          </Link>
          .
        </p>
      </Section>
    </LegalDoc>
  );
}
