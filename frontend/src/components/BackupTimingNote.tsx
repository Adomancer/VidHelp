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
      Approve absence requests, then pick who covers them.
      {settings && (
        <>
          {" "}
          Unreviewed requests open by themselves after {formatDuration(settings["backup.auto_open_after_minutes"] / 60)}, and the best
          applicant is picked {formatDuration(settings["backup.auto_fill_before_minutes"] / 60)} before the session if nobody chose.
        </>
      )}
    </p>
  );
}
