"use client";

import { settingsApi } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { useApiData } from "@/lib/useApiData";
import { useAuth } from "./AuthProvider";

/** Intro for the backup desk, with the timings from Settings. */
export default function BackupTimingNote() {
  const { token } = useAuth();
  const settings = useApiData("public-settings", () => settingsApi.public(token)).data?.settings;

  return (
    <p className="text-sm text-gray-400 mt-1">
      Host langsung memasang permintaan di papan backup; setujui atau tolak host yang mendaftar untuk menggantikan.
      {settings && (
        <>
          {" "}
          Kalau belum ada keputusan, pendaftar terbaik otomatis disetujui {formatDuration(settings["backup.auto_fill_before_minutes"] / 60)} sebelum
          sesi dimulai. Host harus mengajukan paling lambat {formatDuration(settings["backup.request_min_hours_before"])} sebelumnya; kalau lebih mepet, ajukan
          untuk mereka di sini.
        </>
      )}
    </p>
  );
}
