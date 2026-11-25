import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "@shared/const";
import { auditEvents, users, type User } from "../drizzle/schema";
import { authenticateRequest } from "./_core/auth";
import { MAX_FAILED_LOGINS, resetAuthLimits } from "./routers/auth";
import { createRegistrar, resetPasswordFromCli } from "./services/bootstrap";
import { verifyPassword } from "./services/passwords";
import {
  connectTestDb,
  rejectsWith,
  resetDb,
  TEST_DB,
  type Harness,
} from "./testing/harness";

const suite = TEST_DB ? describe : describe.skip;
const PASSWORD = "River!Lamp42Cedar";

suite("accounts against real MySQL", () => {
  let h: Harness;
  const bootstrapDb = () =>
    h.db as unknown as Parameters<typeof createRegistrar>[0];

  beforeAll(async () => {
    h = await connectTestDb();
  });

  afterAll(async () => {
    await h.conn.end();
  });

  beforeEach(async () => {
    await resetDb(h.conn);
    resetAuthLimits();
  });

  const context = (user: User | null = null, ip = "127.0.0.1") => {
    const cookies: Array<{
      name: string;
      value: string;
      options: Record<string, unknown>;
    }> = [];
    const req = { protocol: "http", headers: {}, ip } as never;
    const res = {
      cookie: (name: string, value: string, options: Record<string, unknown>) =>
        cookies.push({ name, value, options }),
      clearCookie: (name: string, options: Record<string, unknown>) =>
        cookies.push({
          name,
          value: "",
          options: { ...options, cleared: true },
        }),
    } as never;
    const caller = h.appRouter.createCaller({ user, req, res });
    return { auth: caller.auth, aspire: caller.aspire, cookies };
  };

  const signedInUser = async (
    cookies: Array<{
      name: string;
      value: string;
      options: Record<string, unknown>;
    }>
  ) => {
    const cookie = cookies.find(
      c => c.name === SESSION_COOKIE && !c.options.cleared
    );
    expect(cookie, "a session cookie should have been set").toBeDefined();
    return authenticateRequest({
      headers: { cookie: `${SESSION_COOKIE}=${cookie!.value}` },
    } as never);
  };

  const rowsFor = async (id: number) =>
    (await h.db.select().from(users).where(eq(users.id, id)))[0]!;

  const register = async (email = "alice@example.org", ip = "127.0.0.1") => {
    const c = context(null, ip);
    const user = await c.auth.register({
      name: "Alice Applicant",
      email,
      password: PASSWORD,
    });
    return { ...c, user };
  };

  it("registers an applicant, hashes the password, audits the event and starts a session", async () => {
    const { user, cookies } = await register("Alice@Example.org");
    expect(user).toMatchObject({
      email: "alice@example.org",
      aspireRole: "applicant",
      role: "user",
    });
    expect(user).not.toHaveProperty("passwordHash");
    expect(user).not.toHaveProperty("sessionVersion");
    expect(await signedInUser(cookies)).toMatchObject({ id: user.id });
    const stored = await rowsFor(user.id);
    expect(stored.loginMethod).toBe("password");
    expect(stored.passwordHash).not.toBe(PASSWORD);
    expect(await verifyPassword(PASSWORD, stored.passwordHash!)).toBe(true);
    const events = await h.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "account_registered"));
    expect(events).toHaveLength(1);
    expect(events[0]!.actorUserId).toBe(user.id);
  });

  it("refuses duplicate emails, invalid emails and weak passwords", async () => {
    await register();
    const second = context();
    await rejectsWith(
      "CONFLICT",
      second.auth.register({
        name: "Other Person",
        email: "ALICE@example.org",
        password: PASSWORD,
      })
    );
    await rejectsWith(
      "BAD_REQUEST",
      second.auth.register({
        name: "Other Person",
        email: "new@example.org",
        password: "weak",
      })
    );
    await rejectsWith(
      "BAD_REQUEST",
      second.auth.register({
        name: "Other Person",
        email: "not-an-email",
        password: PASSWORD,
      })
    );
  });

  it("limits registrations per IP", async () => {
    const c = context();
    for (let i = 0; i < 10; i++) {
      await rejectsWith(
        "BAD_REQUEST",
        c.auth.register({
          name: "Retry Person",
          email: `retry${i}@example.org`,
          password: "weak",
        })
      );
    }
    await rejectsWith(
      "TOO_MANY_REQUESTS",
      c.auth.register({
        name: "Retry Person",
        email: "retry-last@example.org",
        password: PASSWORD,
      })
    );
  });

  it("signs in with a case-insensitive email and reports the same error for unknown accounts", async () => {
    const { user } = await register();
    const c = context();
    const result = await c.auth.login({
      email: "ALICE@EXAMPLE.ORG",
      password: PASSWORD,
    });
    expect(result.id).toBe(user.id);
    expect(await signedInUser(c.cookies)).toMatchObject({ id: user.id });
    const unknown = context();
    await rejectsWith(
      "UNAUTHORIZED",
      unknown.auth.login({ email: "nobody@example.org", password: PASSWORD })
    );
    const wrong = context();
    await rejectsWith(
      "UNAUTHORIZED",
      wrong.auth.login({
        email: "alice@example.org",
        password: "Wrong!Password42",
      })
    );
    expect((await rowsFor(user.id)).failedLoginCount).toBe(1);
  });

  it("locks the account after five wrong passwords and unlocks it after the lock expires", async () => {
    const { user } = await register();
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await rejectsWith(
        "UNAUTHORIZED",
        context().auth.login({
          email: "alice@example.org",
          password: "Wrong!Password42",
        })
      );
    }
    const locked = await rowsFor(user.id);
    expect(locked.failedLoginCount).toBe(0);
    expect(locked.lockedUntil).not.toBeNull();
    const events = await h.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "account_locked"));
    expect(events).toHaveLength(1);
    await rejectsWith(
      "TOO_MANY_REQUESTS",
      context().auth.login({ email: "alice@example.org", password: PASSWORD })
    );
    await h.db
      .update(users)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(users.id, user.id));
    expect(
      (
        await context().auth.login({
          email: "alice@example.org",
          password: PASSWORD,
        })
      ).id
    ).toBe(user.id);
    expect((await rowsFor(user.id)).lockedUntil).toBeNull();
  });

  it("changes the password, clears the forced flag and ends the old session", async () => {
    const { user, cookies } = await register();
    const before = await rowsFor(user.id);
    const c = context(before);
    await rejectsWith(
      "UNAUTHORIZED",
      c.auth.changePassword({
        currentPassword: "Wrong!Password42",
        newPassword: "Another!Lamp43",
      })
    );
    await rejectsWith(
      "BAD_REQUEST",
      c.auth.changePassword({
        currentPassword: PASSWORD,
        newPassword: PASSWORD,
      })
    );
    await rejectsWith(
      "BAD_REQUEST",
      c.auth.changePassword({ currentPassword: PASSWORD, newPassword: "weak" })
    );
    expect(
      await c.auth.changePassword({
        currentPassword: PASSWORD,
        newPassword: "Another!Lamp43",
      })
    ).toEqual({ success: true });
    const after = await rowsFor(user.id);
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
    expect(after.mustChangePassword).toBe(false);
    expect(await verifyPassword("Another!Lamp43", after.passwordHash!)).toBe(
      true
    );
    expect(await signedInUser(cookies)).toBeNull();
    expect(await signedInUser(c.cookies)).toMatchObject({ id: user.id });
  });

  it("boots the first registrar as owner, validates passwords and resets from the CLI", async () => {
    const first = await createRegistrar(bootstrapDb(), {
      name: "First Registrar",
      email: "first@example.org",
      password: PASSWORD,
    });
    expect(first.owner).toBe(true);
    expect((await rowsFor(first.id)).role).toBe("admin");
    await rejectsWithLike(
      () =>
        createRegistrar(bootstrapDb(), {
          name: "First Registrar",
          email: "first@example.org",
          password: PASSWORD,
        }),
      /already exists/
    );
    await rejectsWithLike(
      () =>
        createRegistrar(bootstrapDb(), {
          name: "Weak Registrar",
          email: "weak@example.org",
          password: "short",
        }),
      /at least/
    );
    const second = await createRegistrar(bootstrapDb(), {
      name: "Second Registrar",
      email: "second@example.org",
      password: "Second!Lamp44",
    });
    expect(second.owner).toBe(false);
    expect((await rowsFor(second.id)).aspireRole).toBe("registrar");
    await rejectsWithLike(
      () =>
        resetPasswordFromCli(bootstrapDb(), "missing@example.org", PASSWORD),
      /No account/
    );
    await h.db
      .update(users)
      .set({ isActive: false, lockedUntil: new Date(Date.now() + 60_000) })
      .where(eq(users.id, second.id));
    await resetPasswordFromCli(
      bootstrapDb(),
      "SECOND@example.org",
      "Cli!Reset55555"
    );
    const reset = await rowsFor(second.id);
    expect(reset.isActive).toBe(true);
    expect(reset.lockedUntil).toBeNull();
    expect(reset.sessionVersion).toBe(1);
    expect(await verifyPassword("Cli!Reset55555", reset.passwordHash!)).toBe(
      true
    );
    expect(
      await context().auth.login({
        email: "second@example.org",
        password: "Cli!Reset55555",
      })
    ).toBeDefined();
  });

  it("forces a one-time-password user to choose their own password before using the app", async () => {
    const registrar = await createRegistrar(bootstrapDb(), {
      name: "First Registrar",
      email: "first@example.org",
      password: PASSWORD,
    });
    const owner = await rowsFor(registrar.id);
    const created = await context(owner).aspire.staff.createUser({
      name: "Science Admin",
      email: "science@example.org",
      role: "faculty_administrator",
      facultyId: "science",
    });
    expect(created.temporaryPassword).toMatch(
      /^[a-kmnp-zA-HJ-NP-Z2-9]{4}(-[a-kmnp-zA-HJ-NP-Z2-9]{4}){3}$/
    );
    const login = context();
    const signedIn = await login.auth.login({
      email: "science@example.org",
      password: created.temporaryPassword,
    });
    expect(signedIn.mustChangePassword).toBe(true);
    const forced = context((await signedInUser(login.cookies))!);
    await rejectsWith("FORBIDDEN", forced.aspire.profile.me());
    await forced.auth.changePassword({
      currentPassword: created.temporaryPassword,
      newPassword: "Chosen!Lamp55",
    });
    const changed = context((await signedInUser(forced.cookies))!);
    expect(await changed.aspire.profile.me()).toMatchObject({
      email: "science@example.org",
      role: "faculty_administrator",
    });
    const events = await h.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "password_changed"));
    expect(events).toHaveLength(1);
  });

  it("lets a registrar reset another account and refuse unsafe resets", async () => {
    const registrar = await createRegistrar(bootstrapDb(), {
      name: "First Registrar",
      email: "first@example.org",
      password: PASSWORD,
    });
    const owner = await rowsFor(registrar.id);
    const staff = await context(owner).aspire.staff.createUser({
      name: "Second Registrar",
      email: "second@example.org",
      role: "registrar",
    });
    const target = (
      await h.db
        .select()
        .from(users)
        .where(eq(users.email, "second@example.org"))
    )[0]!;
    const c = context(owner);
    await rejectsWith(
      "BAD_REQUEST",
      c.aspire.staff.resetPassword({ userId: owner.id })
    );
    await rejectsWith(
      "FORBIDDEN",
      c.aspire.staff.resetPassword({ userId: registrar.id })
    );
    const reset = await c.aspire.staff.resetPassword({ userId: target.id });
    expect(reset.temporaryPassword).toBeDefined();
    const after = await rowsFor(target.id);
    expect(after.mustChangePassword).toBe(true);
    expect(after.sessionVersion).toBe(target.sessionVersion + 1);
    expect(
      await verifyPassword(reset.temporaryPassword, after.passwordHash!)
    ).toBe(true);
    expect(staff.temporaryPassword).not.toBe(reset.temporaryPassword);
  });

  it("deactivates and reactivates an account, invalidating its sessions and blocking sign-in", async () => {
    const registrar = await createRegistrar(bootstrapDb(), {
      name: "First Registrar",
      email: "first@example.org",
      password: PASSWORD,
    });
    const owner = await rowsFor(registrar.id);
    const c = context(owner);
    const created = await c.aspire.staff.createUser({
      name: "Science Admin",
      email: "science@example.org",
      role: "faculty_administrator",
      facultyId: "science",
    });
    const target = (
      await h.db
        .select()
        .from(users)
        .where(eq(users.email, "science@example.org"))
    )[0]!;

    const login = context();
    await login.auth.login({
      email: "science@example.org",
      password: created.temporaryPassword,
    });
    expect(await signedInUser(login.cookies)).toMatchObject({ id: target.id });

    await rejectsWith(
      "BAD_REQUEST",
      c.aspire.staff.setUserActive({ userId: owner.id, active: false })
    );
    await rejectsWith(
      "FORBIDDEN",
      c.aspire.staff.setUserActive({ userId: registrar.id, active: false })
    );
    expect(
      await c.aspire.staff.setUserActive({ userId: target.id, active: false })
    ).toEqual({ success: true });
    const after = await rowsFor(target.id);
    expect(after.isActive).toBe(false);
    expect(after.sessionVersion).toBe(target.sessionVersion + 1);
    expect(await signedInUser(login.cookies)).toBeNull();
    await rejectsWith(
      "UNAUTHORIZED",
      context().auth.login({
        email: "science@example.org",
        password: created.temporaryPassword,
      })
    );

    expect(
      await c.aspire.staff.setUserActive({ userId: target.id, active: true })
    ).toEqual({ success: true });
    expect(
      (
        await context().auth.login({
          email: "science@example.org",
          password: created.temporaryPassword,
        })
      ).id
    ).toBe(target.id);
    const events = await h.db.select().from(auditEvents);
    expect(events.map(e => e.action)).toContain("user_deactivated");
    expect(events.map(e => e.action)).toContain("user_reactivated");
  });

  it("refuses to deactivate the last active registrar", async () => {
    const registrar = await createRegistrar(bootstrapDb(), {
      name: "First Registrar",
      email: "first@example.org",
      password: PASSWORD,
    });
    const owner = await rowsFor(registrar.id);
    const c = context(owner);
    await c.aspire.staff.createUser({
      name: "Second Registrar",
      email: "second@example.org",
      role: "registrar",
    });
    const other = (
      await h.db
        .select()
        .from(users)
        .where(eq(users.email, "second@example.org"))
    )[0]!;
    await h.db
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, owner.id));
    await rejectsWith(
      "FORBIDDEN",
      c.aspire.staff.setUserActive({ userId: other.id, active: false })
    );
  });
});

async function rejectsWithLike(run: () => Promise<unknown>, pattern: RegExp) {
  try {
    await run();
  } catch (error) {
    expect((error as Error).message).toMatch(pattern);
    return;
  }
  throw new Error(`Expected an error matching ${pattern}`);
}
