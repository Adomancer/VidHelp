import PayrollDesk from "@/components/PayrollDesk";
import PageHeader from "@/components/PageHeader";

export default function AdminPayrollPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Penggajian"
        description="Setiap jam live yang disetujui masuk ke periode pembayaran brand-nya. Saat periode berakhir, ajukan pembayaran (mengunci jam dan tarif, serta menghasilkan laporan brand), lalu tandai lunas untuk membuat slip gaji yang sudah dipotong kasbon."
      />
      <PayrollDesk />
    </div>
  );
}
