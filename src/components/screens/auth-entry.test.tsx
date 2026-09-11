// @vitest-environment jsdom

/**
 * The provider buttons must not be able to launch two OAuth flows at once. The
 * app sets `busy` for the moment a sign-in is being started; while it holds, the
 * provider buttons are disabled so a rapid double-tap can't open two browsers.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthEntry } from "./shared";

afterEach(cleanup);

const noop = () => {};

function renderEntry(over: Partial<Parameters<typeof AuthEntry>[0]> = {}) {
  const onProvider = vi.fn();
  render(
    <AuthEntry
      providers={["apple", "google", "azure"]}
      onEmail={noop}
      onPassword={noop}
      onProvider={onProvider}
      onBack={noop}
      {...over}
    />,
  );
  return { onProvider };
}

describe("AuthEntry — provider buttons", () => {
  it("starts one OAuth flow when tapped once", () => {
    const { onProvider } = renderEntry();
    fireEvent.click(screen.getByRole("button", { name: /Continue with Google/i }));
    expect(onProvider).toHaveBeenCalledTimes(1);
    expect(onProvider).toHaveBeenCalledWith("google");
  });

  it("disables every provider button while a sign-in is in flight (no double launch)", () => {
    const { onProvider } = renderEntry({ busy: true });
    const google = screen.getByRole("button", { name: /Continue with Google/i });
    const apple = screen.getByRole("button", { name: /Continue with Apple/i });
    expect((google as HTMLButtonElement).disabled).toBe(true);
    expect((apple as HTMLButtonElement).disabled).toBe(true);
    // A tap on a disabled button does nothing — no second flow can start.
    fireEvent.click(google);
    fireEvent.click(google);
    expect(onProvider).not.toHaveBeenCalled();
  });
});
