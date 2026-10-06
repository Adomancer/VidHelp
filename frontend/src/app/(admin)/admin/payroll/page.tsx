import PayrollDesk from "@/components/PayrollDesk";

export default function AdminPayrollPage() {
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-heading">Penggajian</h1>
        <p className="text-sm text-muted mt-1">
          Setiap jam live yang disetujui masuk ke periode pembayaran brand-nya. Saat periode berakhir: ajukan pembayaran (mengunci jam dan tarif, serta
          menghasilkan laporan brand), lalu tandai lunas untuk membuat slip gaji yang sudah dipotong kasbon.
        </p>
      </div>
      <PayrollDesk />
    </div>
  );
}
