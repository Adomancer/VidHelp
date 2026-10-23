import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAnswering } from "@/test/setup";
import { api, ApiError, errorMessage, onDataChanged, onSessionProblem, post, shownKeys, splitApiError } from "./client";

async function failure(status: number, body: unknown): Promise<ApiError> {
  vi.stubGlobal("fetch", fetchAnswering(status, body));
  return api("/anything", { token: "t" }).then(
    () => Promise.reject(new Error("expected a failure")),
    (error: ApiError) => error
  );
}

describe("error messages", () => {
  it("keeps messages the app wrote", async () => {
    expect((await failure(403, { message: "Ini bukan sesimu." })).message).toBe("Ini bukan sesimu.");
    expect((await failure(503, { message: "Discord belum dikonfigurasi di server." })).message).toBe("Discord belum dikonfigurasi di server.");
  });

  it("replaces Laravel's own messages and model names", async () => {
    expect((await failure(404, { message: "No query results for model [App\\Models\\BackupRequest] 0199" })).message).toBe("Data tidak ditemukan atau sudah dihapus.");
    expect((await failure(429, { message: "Too Many Attempts." })).message).toBe("Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.");
    expect((await failure(403, { message: "This action is unauthorized." })).message).toBe("Kamu tidak punya akses untuk ini.");
  });

  it("never shows a 500's text (APP_DEBUG)", async () => {
    expect((await failure(500, { message: "SQLSTATE[42S02]: Base table not found" })).message).toBe("Terjadi kesalahan di server. Coba lagi nanti.");
  });

  it("explains a network failure", () => {
    expect(errorMessage(new TypeError("Failed to fetch"))).toMatch(/koneksi/);
  });
});

describe("session problems", () => {
  afterEach(() => onSessionProblem(() => {})());

  it("reports a revoked token and an account the middleware refuses", async () => {
    const seen: string[] = [];
    const stop = onSessionProblem((problem) => seen.push(`${problem.reason}:${problem.message}`));
    await failure(401, { message: "Unauthenticated." });
    await failure(403, { message: "Akunmu sudah dinonaktifkan.", status: "inactive" });
    await failure(403, { message: "Atur verifikasi dua langkah untuk melanjutkan.", code: "two_factor_setup_required" });
    await failure(403, { message: "Ini bukan sesimu." }); // one action refused: not the session
    stop();
    expect(seen).toEqual(["signed-out:Sesi kamu sudah berakhir. Silakan masuk lagi.", "signed-out:Akunmu sudah dinonaktifkan.", "two-factor:Atur verifikasi dua langkah untuk melanjutkan."]);
  });
});

describe("data changes", () => {
  afterEach(() => onDataChanged(null));

  it("marks the cache stale after a change, unless told not to", async () => {
    const changed = vi.fn();
    onDataChanged(changed);
    vi.stubGlobal("fetch", fetchAnswering(200, { message: "ok" }));
    await post("/brands", "t", { name: "A" });
    await post("/notifications/1/read", "t", undefined, { invalidates: false });
    await api("/brands", { token: "t" });
    expect(changed).toHaveBeenCalledTimes(1);
  });
});

describe("splitApiError", () => {
  const invalid = (errors: Record<string, string[]>) => new ApiError(422, Object.values(errors)[0][0], { message: Object.values(errors)[0][0], errors });

  it("leaves field messages to the fields", () => {
    expect(splitApiError(invalid({ email: ["Email wajib diisi."] }), shownKeys("email"))).toEqual({ fields: { email: "Email wajib diisi." }, message: null });
  });

  it("surfaces a message for a key the form doesn't show", () => {
    const { message } = splitApiError(invalid({ changes: ["Tidak ada perubahan dibanding data yang tersimpan."] }), shownKeys("name", "phone"));
    expect(message).toBe("Tidak ada perubahan dibanding data yang tersimpan.");
  });

  it("matches array keys by their base", () => {
    expect(splitApiError(invalid({ "ranges.0.start": ["Jam salah."] }), shownKeys("ranges")).message).toBeNull();
  });

  it("uses the server's message when no field is to blame", () => {
    expect(splitApiError(new ApiError(409, "Periode ini terkunci."), shownKeys())).toEqual({ fields: {}, message: "Periode ini terkunci." });
  });
});
