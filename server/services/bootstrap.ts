import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { auditEvents, users } from "../../drizzle/schema";
import { getUserByEmail, getDb } from "../db";
import { hashPassword, passwordProblem } from "./passwords";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * Creates a registrar account. The first one becomes the project owner (platform role "admin"),
 * which cannot be demoted or deactivated by other registrars. Used for the first account on a new install.
 */
export async function createRegistrar(db: Db, input: { name: string; email: string; password: string }) {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter a valid email address.");
  if (input.name.trim().length < 2) throw new Error("Enter the registrar's full name.");
  const problem = passwordProblem(input.password, { email, name: input.name });
  if (problem) throw new Error(problem);
  if (await getUserByEmail(email)) throw new Error(`An account for ${email} already exists. Use --reset to set a new password.`);
  const owners = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
  const owner = owners.length === 0;
  const result = await db.insert(users).values({
    openId: `local-${nanoid(20)}`, name: input.name.trim(), email, loginMethod: "password",
    role: owner ? "admin" : "user", aspireRole: "registrar",
    passwordHash: await hashPassword(input.password), passwordChangedAt: new Date(), mustChangePassword: false,
  });
  const id = result[0].insertId;
  await db.insert(auditEvents).values({ actorUserId: null, action: "registrar_bootstrapped", entityType: "user", entityId: String(id), reason: "Created from the command line", beforeData: null, afterData: { email, owner } });
  return { id, owner };
}

/** Sets a new password for an existing account (for example the project owner who forgot theirs) and ends its sessions. */
export async function resetPasswordFromCli(db: Db, emailInput: string, password: string) {
  const email = emailInput.trim().toLowerCase();
  const user = await getUserByEmail(email);
  if (!user) throw new Error(`No account for ${email}.`);
  const problem = passwordProblem(password, { email, name: user.name });
  if (problem) throw new Error(problem);
  await db.update(users).set({
    passwordHash: await hashPassword(password), passwordChangedAt: new Date(), mustChangePassword: false,
    failedLoginCount: 0, lockedUntil: null, isActive: true, sessionVersion: user.sessionVersion + 1,
  }).where(eq(users.id, user.id));
  await db.insert(auditEvents).values({ actorUserId: null, action: "password_reset_from_cli", entityType: "user", entityId: String(user.id), reason: "Reset from the command line", beforeData: null, afterData: null });
  return { id: user.id };
}
