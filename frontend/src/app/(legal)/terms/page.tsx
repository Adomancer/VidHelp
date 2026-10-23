import type { Metadata } from "next";
import Link from "next/link";
import { LegalDoc, Section } from "@/components/LegalDoc";
import { legal } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Ketentuan Layanan - VidHelp",
  description: "Ketentuan penggunaan aplikasi VidHelp dan bot Discord VidHelp.",
};

export default function TermsPage() {
  return (
    <LegalDoc title="Ketentuan Layanan" effectiveDate={legal.effectiveDate}>
      <p>
        Ketentuan ini berlaku untuk penggunaan VidHelp, yaitu aplikasi web manajemen agensi host live streaming beserta bot Discord VidHelp. Dengan membuat
        akun, masuk, atau menghubungkan Discord ke VidHelp, kamu menyetujui ketentuan ini dan{" "}
        <Link href="/privacy" className="font-medium text-primary underline-offset-4 hover:underline">
          Kebijakan Privasi
        </Link>{" "}
        kami.
      </p>

      <Section title="1. Layanan">
        <p>
          VidHelp adalah alat internal untuk host, operator, admin, dan finance agensi. Isinya jadwal live, absensi, laporan live, backup, poin, dan gaji. Akun
          baru baru bisa dipakai setelah disetujui admin.
        </p>
      </Section>

      <Section title="2. Akun">
        <ul>
          <li>Kamu bertanggung jawab menjaga kerahasiaan kata sandi dan kode verifikasi dua langkah kamu.</li>
          <li>Data yang kamu isi, seperti profil, rekening, dan laporan live, harus benar dan milik kamu sendiri.</li>
          <li>Satu akun hanya untuk satu orang. Jangan meminjamkan akun ke orang lain.</li>
        </ul>
      </Section>

      <Section title="3. Bot Discord">
        <ul>
          <li>Menghubungkan Discord itu opsional. VidHelp tetap bisa dipakai tanpa Discord.</li>
          <li>Setelah terhubung, kamu akan ditambahkan ke server Discord agensi, dan bot akan mengirim notifikasi VidHelp sebagai DM dan di channel server.</li>
          <li>Kamu bisa mematikan kategori notifikasi tertentu. Beberapa notifikasi penting, misalnya soal akun kamu, tetap dikirim.</li>
          <li>Kamu bisa memutuskan Discord kapan saja dari halaman profil atau akun di VidHelp.</li>
          <li>
            Penggunaan Discord juga tunduk pada{" "}
            <a href="https://discord.com/terms" target="_blank" rel="noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">
              Ketentuan Layanan
            </a>{" "}
            dan{" "}
            <a href="https://discord.com/guidelines" target="_blank" rel="noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">
              Pedoman Komunitas
            </a>{" "}
            Discord.
          </li>
        </ul>
      </Section>

      <Section title="4. Yang tidak boleh dilakukan">
        <ul>
          <li>Memalsukan check-in, laporan live, atau data jam kerja</li>
          <li>Mencoba mengakses akun atau data orang lain</li>
          <li>Mengganggu, membobol, atau membebani sistem VidHelp maupun bot Discord-nya</li>
          <li>Menyebarkan data pribadi pengguna lain yang kamu lihat di VidHelp</li>
        </ul>
      </Section>

      <Section title="5. Penonaktifan akun">
        <p>
          Admin bisa menonaktifkan, mengarsipkan, atau menghapus akun yang melanggar ketentuan ini atau yang sudah tidak bekerja sama dengan agensi. Akses ke
          bot Discord ikut berhenti.
        </p>
      </Section>

      <Section title="6. Batasan tanggung jawab">
        <p>
          VidHelp disediakan &quot;sebagaimana adanya&quot;. Kami berusaha agar layanan dan notifikasi selalu berjalan, tetapi tidak bisa menjamin semuanya
          bebas gangguan. Misalnya, DM Discord bisa gagal terkirim jika kamu menutup DM dari server. Jadwal dan informasi resmi tetap mengacu ke aplikasi
          VidHelp.
        </p>
      </Section>

      <Section title="7. Perubahan ketentuan">
        <p>
          Ketentuan ini bisa diperbarui. Tanggal di bagian atas halaman menunjukkan versi terbaru. Jika kamu tetap memakai VidHelp setelah ada perubahan, kamu
          dianggap menyetujui ketentuan yang baru.
        </p>
      </Section>

      <Section title="8. Hukum yang berlaku">
        <p>Ketentuan ini tunduk pada hukum Republik Indonesia.</p>
      </Section>

      <Section title="9. Kontak">
        <p>
          Pertanyaan tentang ketentuan ini bisa dikirim ke{" "}
          <a href={`mailto:${legal.contactEmail}`} className="font-medium text-primary underline-offset-4 hover:underline">
            {legal.contactEmail}
          </a>
          .
        </p>
      </Section>
    </LegalDoc>
  );
}
