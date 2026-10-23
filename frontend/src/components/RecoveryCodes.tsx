"use client";

import { useState } from "react";
import { Check, Copy, Download, TriangleAlert } from "lucide-react";
import { saveBlob } from "@/lib/api";
import { Button } from "@/components/ui/button";

/** One-time recovery codes, shown once right after they're created. */
export default function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");

  async function copy() {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function download() {
    saveBlob(new Blob([`Kode pemulihan VidHelp\n\n${text}\n\nSetiap kode hanya bisa dipakai sekali.\n`], { type: "text/plain" }), "vidhelp-recovery-codes.txt");
  }

  return (
    <div className="space-y-3 rounded-xl border border-warning/30 bg-warning/5 p-4">
      <p className="flex gap-2 text-sm text-warning">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          Simpan kode pemulihan ini di tempat aman (password manager atau dicatat di kertas). Kalau HP kamu hilang, setiap kode bisa dipakai untuk masuk satu
          kali. <strong>Kode ini tidak akan ditampilkan lagi.</strong>
        </span>
      </p>
      <ul className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-card p-4 font-mono text-sm text-foreground">
        {codes.map((code) => (
          <li key={code} className="text-center tracking-wider">
            {code}
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" onClick={copy}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "Tersalin" : "Salin"}
        </Button>
        <Button type="button" variant="outline" onClick={download}>
          <Download aria-hidden="true" />
          Unduh .txt
        </Button>
      </div>
    </div>
  );
}
