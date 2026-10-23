"use client";

import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { Button } from "@/components/ui/button";
import FinanceReportDialog from "./FinanceReportDialog";
import FormAlert from "./FormAlert";
import ToggleGroup from "./ToggleGroup";
import { Kasbon } from "./payroll/Kasbon";
import { Periods } from "./payroll/Periods";
import { useCanManageFinance } from "./payroll/shared";

/**
 * Admin payroll: payment periods per brand (lock, pay, slips) and kasbon.
 * The tab, period filter, search, page, open period and kasbon filter live in the URL, so a refresh,
 * a shared link or coming back from a slip shows the same view.
 */
export default function PayrollDesk() {
  const [tab, setTab] = useQueryState("tab", parseAsStringLiteral(["periods", "kasbon"] as const).withDefault("periods"));
  const canManage = useCanManageFinance();
  const [reporting, setReporting] = useState(false);

  return (
    <div className="space-y-5">
      {!canManage && (
        <FormAlert tone="info">
          Mode lihat saja. Menutup periode, mengajukan pembayaran, menandai lunas, penyesuaian jam, dan kasbon hanya bisa dilakukan oleh akun Finance.
        </FormAlert>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          label="Bagian penggajian"
          options={[
            ["periods", "Periode pembayaran"],
            ["kasbon", "Kasbon"],
          ] as const}
          value={tab}
          onChange={(next) => void setTab(next)}
        />
        <Button type="button" variant="outline" onClick={() => setReporting(true)}>
          <FileSpreadsheet aria-hidden="true" />
          Unduh laporan
        </Button>
      </div>
      {tab === "periods" ? <Periods /> : <Kasbon />}
      {reporting && <FinanceReportDialog onClose={() => setReporting(false)} />}
    </div>
  );
}
