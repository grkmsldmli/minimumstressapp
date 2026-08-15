import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../supabase/server", () => ({ supabaseServer: vi.fn() }));

const { handled, jsonError } = await import("./session");

// stubEnv records the original and restores it, so nothing has to be saved.
afterEach(() => vi.unstubAllEnvs());

describe("handled", () => {
  it("passes a deliberate failure through with its own status and wording", async () => {
    const refusal = Object.assign(new Error("That hour is already taken"), { status: 409 });
    const response = await handled(() => Promise.reject(refusal));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "That hour is already taken" });
  });

  it("returns whatever the handler returned when nothing throws", async () => {
    const response = await handled(async () => jsonError("nope", 401));
    expect(response.status).toBe(401);
  });

  /*
   * Postgres errors name tables, columns and constraints, which is free
   * reconnaissance for anyone poking at the API.
   */
  it("says nothing revealing in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await handled(() =>
      Promise.reject(new Error('relation "profiles" violates check constraint "phone_is_e164"')),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Something went wrong on our end",
    });
  });

  /*
   * And says everything outside it. A bare 500 in the browser console names no
   * route, no call and no cause; the only copy of the reason was a server log
   * in a terminal nobody had open, which is how an afternoon goes missing.
   */
  it("gives the reason while developing", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const response = await handled(() =>
      Promise.reject(new Error("STRIPE_SECRET_KEY is not set — see .env.example")),
    );

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("Something went wrong on our end");
    expect(body.error).toContain("STRIPE_SECRET_KEY is not set");
  });

  it("survives something thrown that is not an Error", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const response = await handled(() => Promise.reject("just a string"));

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("just a string");
  });
});
