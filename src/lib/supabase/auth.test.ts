// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { describeAuthError } from "../auth-error";
import { REVIEWER_EMAIL } from "../reviewer-login";

/**
 * The two ways in, kept apart. Ordinary sign-in emails a code and never touches
 * a password; the one reviewer account signs in with a password and never asks
 * for a code. These tests hold that boundary — and hold the password to the one
 * place it is allowed to go: straight into Supabase, and nowhere else.
 */

const { signInWithOtpSpy, passwordGrantSpy, signInWithOAuthSpy, browserOpenSpy, nativeState } =
  vi.hoisted(() => ({
    signInWithOtpSpy: vi.fn(),
    passwordGrantSpy: vi.fn(),
    signInWithOAuthSpy: vi.fn(),
    browserOpenSpy: vi.fn(),
    nativeState: { native: false },
  }));

vi.mock("./client", () => ({
  supabaseBrowser: () => ({
    auth: {
      signInWithOtp: signInWithOtpSpy,
      signInWithPassword: passwordGrantSpy,
      signInWithOAuth: signInWithOAuthSpy,
    },
  }),
}));

vi.mock("../native", () => ({
  isNativeApp: () => nativeState.native,
  capacitorPlugin: () => ({ open: browserOpenSpy }),
  NATIVE_AUTH_REDIRECT: "com.minimumstress.app://auth-callback",
}));

import { sendEmailCode, signInWithPassword, signInWithProvider } from "./auth";

const PASSWORD = "correct-horse-battery-staple";

beforeEach(() => {
  signInWithOtpSpy.mockReset().mockResolvedValue({ error: null });
  passwordGrantSpy.mockReset().mockResolvedValue({ error: null });
  signInWithOAuthSpy.mockReset().mockResolvedValue({ error: null });
  browserOpenSpy.mockReset().mockResolvedValue(undefined);
  nativeState.native = false;
});

afterEach(() => vi.restoreAllMocks());

describe("ordinary sign-in", () => {
  it("emails a code and never reaches for a password", async () => {
    await sendEmailCode("someone@example.com");

    expect(signInWithOtpSpy).toHaveBeenCalledTimes(1);
    expect(signInWithOtpSpy).toHaveBeenCalledWith({
      email: "someone@example.com",
      options: { shouldCreateUser: true },
    });
    // The OTP path must not have quietly become a password path.
    expect(passwordGrantSpy).not.toHaveBeenCalled();
  });
});

describe("reviewer sign-in", () => {
  it("uses the password grant, not the code path", async () => {
    await signInWithPassword(REVIEWER_EMAIL, PASSWORD);

    expect(passwordGrantSpy).toHaveBeenCalledTimes(1);
    expect(passwordGrantSpy).toHaveBeenCalledWith({ email: REVIEWER_EMAIL, password: PASSWORD });
    expect(signInWithOtpSpy).not.toHaveBeenCalled();
  });

  it("hands the password to Supabase and keeps a copy of it nowhere", async () => {
    const logs = ["log", "info", "warn", "error", "debug"] as const;
    const spies = logs.map((level) => vi.spyOn(console, level).mockImplementation(() => {}));

    const returned = await signInWithPassword(REVIEWER_EMAIL, PASSWORD);

    // Nothing comes back — the password is not echoed to the caller.
    expect(returned).toBeUndefined();
    // Nothing is logged — the password never reaches the console at any level.
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(PASSWORD);
      }
    }
    // The password appears in exactly one place: the single call to Supabase.
    expect(passwordGrantSpy).toHaveBeenCalledTimes(1);
  });

  it("turns a rejected password into a normal, user-safe line with no password in it", async () => {
    // What Supabase actually returns for a wrong password.
    passwordGrantSpy.mockResolvedValue({ error: new Error("Invalid login credentials") });

    await expect(signInWithPassword(REVIEWER_EMAIL, PASSWORD)).rejects.toThrow(
      "Invalid login credentials",
    );

    // The screen shows the shared auth-error line; it is safe to read and never
    // contains what was typed.
    const shown = describeAuthError(new Error("Invalid login credentials"));
    expect(shown).toBe("Invalid login credentials");
    expect(shown).not.toContain(PASSWORD);

    // An error with no message still becomes a sentence, never a blank.
    expect(describeAuthError(new Error(""))).toMatch(/check your connection/i);
  });
});

describe("provider sign-in — Google account chooser", () => {
  const optionsOf = () => signInWithOAuthSpy.mock.calls[0][0].options as Record<string, unknown>;

  it("web Google forces the account chooser with prompt=select_account", async () => {
    await signInWithProvider("google");
    expect(signInWithOAuthSpy).toHaveBeenCalledTimes(1);
    expect(signInWithOAuthSpy.mock.calls[0][0].provider).toBe("google");
    expect(optionsOf().queryParams).toEqual({ prompt: "select_account" });
  });

  it("native Google forces the account chooser and opens the system browser", async () => {
    nativeState.native = true;
    signInWithOAuthSpy.mockResolvedValue({ data: { url: "https://accounts.google.test/o" }, error: null });

    await signInWithProvider("google");

    const options = optionsOf();
    expect(options.queryParams).toEqual({ prompt: "select_account" });
    expect(options.skipBrowserRedirect).toBe(true);
    expect(options.redirectTo).toBe("com.minimumstress.app://auth-callback");
    // The provider URL is opened in the SYSTEM browser, never the WebView.
    expect(browserOpenSpy).toHaveBeenCalledWith({ url: "https://accounts.google.test/o" });
  });

  it("Apple is left untouched — no prompt param (web)", async () => {
    await signInWithProvider("apple");
    expect(signInWithOAuthSpy.mock.calls[0][0].provider).toBe("apple");
    expect(optionsOf().queryParams).toBeUndefined();
  });

  it("Apple is left untouched — no prompt param (native)", async () => {
    nativeState.native = true;
    signInWithOAuthSpy.mockResolvedValue({ data: { url: "https://appleid.test/o" }, error: null });
    await signInWithProvider("apple");
    expect(optionsOf().queryParams).toBeUndefined();
  });

  it("Microsoft (azure) is left untouched — the chooser is Google-only", async () => {
    await signInWithProvider("azure");
    expect(optionsOf().queryParams).toBeUndefined();
  });
});
