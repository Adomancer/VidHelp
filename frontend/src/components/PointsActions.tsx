"use client";

import { useState } from "react";
import { FileSpreadsheet, ListChecks } from "lucide-react";
import { errorMessage, pointsApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useAuth } from "./AuthProvider";
import Dialog from "./Dialog";
import { notify } from "./Toast";
import ViolationTypesEditor from "./ViolationTypesEditor";

/** "Unduh Excel": the current points period (balances, history, SP letters, violation types). */
export function PointsExportButton() {
  const { token } = useAuth();
  const [exporting, setExporting] = useState(false);

  async function download() {
    setExporting(true);
    try {
      await pointsApi.exportPoints(token);
    } catch (caught) {
      notify({ text: errorMessage(caught), tone: "error" });
    } finally {
      setExporting(false);
    }
  }

  return (
    <Button type="button" variant="outline" onClick={download} disabled={exporting} title="Saldo poin, riwayat poin, SP, dan jenis pelanggaran periode ini">
      <FileSpreadsheet aria-hidden="true" />
      {exporting ? "Menyiapkan…" : "Unduh Excel"}
    </Button>
  );
}

/** Admin: the violation types, in a side panel over the points page. */
export function ViolationTypesButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <ListChecks aria-hidden="true" />
        Jenis pelanggaran
      </Button>
      {open && (
        <Dialog
          title="Jenis pelanggaran"
          description="Poin dipotong dari saldo 3 bulanan; dampak rating menurunkan saran rating bulanan. Jenis bertanda “otomatis” juga diterapkan oleh sistem."
          placement="side"
          size="lg"
          onClose={() => setOpen(false)}
        >
          <ViolationTypesEditor plain />
        </Dialog>
      )}
    </>
  );
}
