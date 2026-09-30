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
      Hosts post requests straight to the board; approve or reject who applies to cover them.
      {settings && (
        <>
          {" "}
          If nobody decides, the best applicant is approved {formatDuration(settings["backup.auto_fill_before_minutes"] / 60)} before
          the session. Hosts must ask {formatDuration(settings["backup.request_min_hours_before"])} ahead; for anything closer, request it
          for them here.
        </>
      )}
    </p>
  );
}
