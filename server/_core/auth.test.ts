import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@shared/const";

const { getUserById } = vi.hoisted(() => ({ getUserById: vi.fn() }));
vi.mock("../db", () => ({ getUserById }));

import {
  authenticateRequest,
  endSession,
  readSession,
  signSession,
  startSession,
} from "./auth";
import { ENV } from "./env";

const user = { id: 7, sessionVersion: 3 };

describe("session tokens", () => {
  beforeEach(() => getUserById.mockReset());

  it("round-trips the user id and session version", async () => {
    const token = await signSession(user);
    expect(await readSession(token)).toEqual({ userId: 7, sessionVersion: 3 });
  });

  it("carries no personal data", async () => {
    const token = await signSession(user);
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")
    );
    expect(payload).toMatchObject({ sub: "7", sv: 3 });
    expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "sub", "sv"]);
  });

  it("refuses a tampered or malformed token", async () => {
    const token = await signSession(user);
    const [head, body, signature] = token.split(".");
    expect(
      await readSession(
        `${head}.${body}.${signature?.[0] === "a" ? "b" : "a"}${signature?.slice(1)}`
      )
    ).toBeNull();
    expect(await readSession("not-a-token")).toBeNull();
    expect(await readSession("")).toBeNull();
  });

  it("refuses a token signed with a different secret", async () => {
    const original = ENV.sessionSecret;
    try {
      ENV.sessionSecret = "a-different-secret-that-is-long-enough";
      const token = await signSession(user);
      ENV.sessionSecret = original;
      expect(await readSession(token)).toBeNull();
    } finally {
      ENV.sessionSecret = original;
    }
  });

  it("refuses an already-expired token", async () => {
    const token = await signSession(user, Math.floor(Date.now() / 1000) - 60);
    expect(await readSession(token)).toBeNull();
  });

  it("refuses a token with a bad subject or no session version", async () => {
    const { SignJWT } = await import("jose");
    const key = new TextEncoder().encode(ENV.sessionSecret);
    const badSubject = await new SignJWT({ sv: 3 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("nope")
      .setExpirationTime("1h")
      .sign(key);
    const noVersion = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("7")
      .setExpirationTime("1h")
      .sign(key);
    expect(await readSession(badSubject)).toBeNull();
    expect(await readSession(noVersion)).toBeNull();
  });
});

describe("request authentication", () => {
  beforeEach(() => getUserById.mockReset());

  const header = (token: string) => ({ cookie: `${SESSION_COOKIE}=${token}` });

  it("returns the user for a valid cookie", async () => {
    const token = await signSession(user);
    const found = { ...user, isActive: true };
    getUserById.mockResolvedValue(found);
    expect(await authenticateRequest({ headers: header(token) })).toBe(found);
    expect(getUserById).toHaveBeenCalledWith(7);
  });

  it("refuses no cookie, an inactive account and a stale session", async () => {
    const token = await signSession(user);
    expect(await authenticateRequest({ headers: {} })).toBeNull();
    expect(
      await authenticateRequest({ headers: { cookie: "other=nope" } })
    ).toBeNull();
    getUserById.mockResolvedValue({ ...user, isActive: false });
    expect(await authenticateRequest({ headers: header(token) })).toBeNull();
    getUserById.mockResolvedValue({
      ...user,
      sessionVersion: 4,
      isActive: true,
    });
    expect(await authenticateRequest({ headers: header(token) })).toBeNull();
    getUserById.mockResolvedValue(null);
    expect(await authenticateRequest({ headers: header(token) })).toBeNull();
  });
});

describe("session cookies", () => {
  it("starts a same-site HTTP-only Secure session cookie", async () => {
    const cookies: Array<{
      name: string;
      value: string;
      options: Record<string, unknown>;
    }> = [];
    const req = { protocol: "https", headers: {} } as never;
    const res = {
      cookie: (name: string, value: string, options: Record<string, unknown>) =>
        cookies.push({ name, value, options }),
    } as never;
    await startSession(req, res, user);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]!.name).toBe(SESSION_COOKIE);
    expect(await readSession(cookies[0]!.value)).toEqual({
      userId: 7,
      sessionVersion: 3,
    });
    expect(cookies[0]!.options).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: ENV.sessionDays * 86_400_000,
    });
  });

  it("clears the same cookie on sign-out", () => {
    const cleared: Array<{ name: string; options: Record<string, unknown> }> =
      [];
    const req = { protocol: "http", headers: {} } as never;
    const res = {
      clearCookie: (name: string, options: Record<string, unknown>) =>
        cleared.push({ name, options }),
    } as never;
    endSession(req, res);
    expect(cleared).toEqual([
      {
        name: SESSION_COOKIE,
        options: {
          httpOnly: true,
          sameSite: "lax",
          secure: false,
          path: "/",
          maxAge: -1,
        },
      },
    ]);
  });
});
