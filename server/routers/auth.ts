import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { auditEvents, users, type User } from "../../drizzle/schema";
import { endSession, startSession } from "../_core/auth";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb, getUserByEmail, getUserById } from "../db";
import { DUMMY_HASH, PASSWORD_MAX, hashPassword, passwordProblem, verifyPassword } from "../services/passwords";
import { RateLimiter } from "../services/rateLimit";

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

export const authLimits = {
  loginByIp: new RateLimiter(30, 15 * 60_000),
  registerByIp: new RateLimiter(10, 60 * 60_000),
};
/** For tests. */
export const resetAuthLimits = () => { authLimits.loginByIp.reset(); authLimits.registerByIp.reset(); };

/** What a browser may know about a user. Never the password hash, lock state or session version. */
export function publicUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    aspireRole: user.aspireRole,
    facultyId: user.facultyId,
    mustChangePassword: user.mustChangePassword,
    lastSignedIn: user.lastSignedIn,
    createdAt: user.createdAt,
  };
}

const clientIp = (req: { ip?: string; socket?: { remoteAddress?: string } }) => req.ip ?? req.socket?.remoteAddress ?? "unknown";
const database = async () => {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "The database is unavailable." });
  return db;
};
async function audit(actorUserId: number | null, action: string, userId: number, afterData?: Record<string, unknown>) {
  const db = await database();
  await db.insert(auditEvents).values({ actorUserId, action, entityType: "user", entityId: String(userId), reason: null, beforeData: null, afterData: afterData ?? null });
}

const email = z.string().trim().toLowerCase().email("Enter a valid email address.").max(320);
const refused = () => new TRPCError({ code: "UNAUTHORIZED", message: "Email or password is incorrect." });
const tooMany = (seconds: number) => new TRPCError({ code: "TOO_MANY_REQUESTS", message: `Too many attempts. Try again in ${Math.max(1, Math.ceil(seconds / 60))} minute(s).` });

export const authRouter = router({
  me: publicProcedure.query((opts) => (opts.ctx.user ? publicUser(opts.ctx.user) : null)),

  /** Self-service sign-up. Always creates an applicant: staff accounts are created by the registrar. */
  register: publicProcedure.input(z.object({
    name: z.string().trim().min(2, "Enter your full name.").max(255),
    email,
    password: z.string().max(PASSWORD_MAX),
  })).mutation(async ({ ctx, input }) => {
    const limit = authLimits.registerByIp.hit(clientIp(ctx.req));
    if (!limit.allowed) throw tooMany(limit.retryAfterSeconds);
    const problem = passwordProblem(input.password, { email: input.email, name: input.name });
    if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
    if (await getUserByEmail(input.email)) throw new TRPCError({ code: "CONFLICT", message: "An account with this email already exists. Sign in instead." });
    const db = await database();
    let id: number;
    try {
      const result = await db.insert(users).values({
        openId: `local-${nanoid(20)}`,
        name: input.name,
        email: input.email,
        loginMethod: "password",
        role: "user",
        aspireRole: "applicant",
        passwordHash: await hashPassword(input.password),
        passwordChangedAt: new Date(),
        lastSignedIn: new Date(),
      });
      id = result[0].insertId;
    } catch (error) {
      const code = (error as { code?: string; cause?: { code?: string } });
      if (code.code === "ER_DUP_ENTRY" || code.cause?.code === "ER_DUP_ENTRY") throw new TRPCError({ code: "CONFLICT", message: "An account with this email already exists. Sign in instead." });
      throw error;
    }
    const user = (await getUserById(id))!;
    await audit(user.id, "account_registered", user.id);
    await startSession(ctx.req, ctx.res, user);
    return publicUser(user);
  }),

  login: publicProcedure.input(z.object({ email, password: z.string().min(1).max(PASSWORD_MAX) })).mutation(async ({ ctx, input }) => {
    const limit = authLimits.loginByIp.hit(clientIp(ctx.req));
    if (!limit.allowed) throw tooMany(limit.retryAfterSeconds);
    const user = await getUserByEmail(input.email);
    if (!user || !user.passwordHash || !user.isActive) {
      await verifyPassword(input.password, DUMMY_HASH);   // an unknown email takes as long to refuse as a wrong password
      throw refused();
    }
    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) throw tooMany((user.lockedUntil.getTime() - now.getTime()) / 1000);
    const db = await database();
    if (!(await verifyPassword(input.password, user.passwordHash))) {
      const failures = user.failedLoginCount + 1;
      if (failures >= MAX_FAILED_LOGINS) {
        await db.update(users).set({ failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000) }).where(eq(users.id, user.id));
        await audit(null, "account_locked", user.id, { minutes: LOCK_MINUTES });
      } else {
        await db.update(users).set({ failedLoginCount: failures }).where(eq(users.id, user.id));
      }
      throw refused();
    }
    await db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastSignedIn: now }).where(eq(users.id, user.id));
    await audit(user.id, "signed_in", user.id);
    await startSession(ctx.req, ctx.res, user);
    return publicUser({ ...user, lastSignedIn: now });
  }),

  logout: publicProcedure.mutation(({ ctx }) => {
    endSession(ctx.req, ctx.res);
    return { success: true } as const;
  }),

  /** Changing the password ends every other session and clears the temporary-password flag. */
  changePassword: protectedProcedure.input(z.object({
    currentPassword: z.string().min(1).max(PASSWORD_MAX),
    newPassword: z.string().max(PASSWORD_MAX),
  })).mutation(async ({ ctx, input }) => {
    const user = ctx.user!;
    if (!user.passwordHash || !(await verifyPassword(input.currentPassword, user.passwordHash))) throw new TRPCError({ code: "UNAUTHORIZED", message: "Your current password is incorrect." });
    if (input.newPassword === input.currentPassword) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a password you have not used just now." });
    const problem = passwordProblem(input.newPassword, { email: user.email, name: user.name });
    if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
    const db = await database();
    await db.update(users).set({
      passwordHash: await hashPassword(input.newPassword),
      passwordChangedAt: new Date(),
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
      sessionVersion: user.sessionVersion + 1,
    }).where(eq(users.id, user.id));
    await audit(user.id, "password_changed", user.id);
    await startSession(ctx.req, ctx.res, (await getUserById(user.id))!);
    return { success: true } as const;
  }),
});
