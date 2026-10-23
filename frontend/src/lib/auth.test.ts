import { describe, expect, it, vi } from "vitest";
import { fetchAnswering } from "@/test/setup";
import { consumeOAuthState, createOAuthState, getToken, loadSession, saveSession } from "./auth";

describe("OAuth state", () => {
  it("accepts only the state created before leaving, once", () => {
    const state = createOAuthState();
    expect(consumeOAuthState("someone-else")).toBe(false);
    // a wrong state still uses it up
    expect(consumeOAuthState(state)).toBe(false);

    const fresh = createOAuthState();
    expect(consumeOAuthState(fresh)).toBe(true);
    expect(consumeOAuthState(fresh)).toBe(false);
  });

  it("refuses a callback that never started here", () => {
    expect(consumeOAuthState(null)).toBe(false);
  });
});

describe("loadSession", () => {
  it("is signed out without a token", async () => {
    expect(await loadSession()).toBeNull();
  });

  it("forgets a token the server refuses", async () => {
    saveSession("dead");
    vi.stubGlobal("fetch", fetchAnswering(401, { message: "Unauthenticated." }));
    expect(await loadSession()).toBeNull();
    expect(getToken()).toBeNull();
  });

  it("keeps the token when the server can't be reached", async () => {
    saveSession("still-good");
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await loadSession()).toBe("unreachable");
    expect(getToken()).toBe("still-good");
  });

  it("keeps the token on a server error", async () => {
    saveSession("still-good");
    vi.stubGlobal("fetch", fetchAnswering(500, { message: "Server Error" }));
    expect(await loadSession()).toBe("unreachable");
    expect(getToken()).toBe("still-good");
  });

  it("removes the user copy older versions stored", async () => {
    localStorage.setItem("vidhelp_user", "{}");
    await loadSession();
    expect(localStorage.getItem("vidhelp_user")).toBeNull();
  });
});
