"use client";

import { useState } from "react";

/** One-time recovery codes, shown once right after they're created. */
export default function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");

  async function copy() {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
  }

  function download() {
    const url = URL.createObjectURL(new Blob([`Kode pemulihan VidHelp\n\n${text}\n\nSetiap kode hanya bisa dipakai sekali.\n`], { type: "text/plain" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: "vidhelp-recovery-codes.txt" });
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-yellow-100">
        Simpan kode pemulihan ini di tempat aman (password manager atau dicatat di kertas). Kalau HP kamu hilang, setiap kode bisa dipakai
        untuk masuk satu kali. <strong>Kode ini tidak akan ditampilkan lagi.</strong>
      </p>
      <ul className="grid grid-cols-2 gap-2 p-4 rounded-xl bg-slate-950 border border-slate-700 font-mono text-sm text-white">
        {codes.map((code) => (
          <li key={code} className="text-center">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button type="button" onClick={copy} className="flex-1 px-3 py-2 rounded-lg border border-slate-700 text-sm text-gray-200 hover:bg-slate-800">
          {copied ? "Tersalin ✓" : "Salin"}
        </button>
        <button type="button" onClick={download} className="flex-1 px-3 py-2 rounded-lg border border-slate-700 text-sm text-gray-200 hover:bg-slate-800">
          Unduh .txt
        </button>
      </div>
    </div>
  );
}
