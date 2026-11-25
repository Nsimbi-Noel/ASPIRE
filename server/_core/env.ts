import { randomBytes } from "node:crypto";
import path from "node:path";

const isProduction = process.env.NODE_ENV === "production";

function sessionSecret(): string {
  const configured = process.env.SESSION_SECRET ?? "";
  if (configured.length >= 32) return configured;
  if (isProduction) throw new Error("SESSION_SECRET must be set to at least 32 random characters in production.");
  if (process.env.NODE_ENV !== "test") console.warn("[auth] SESSION_SECRET is not set: using a temporary secret, so sign-ins end when the server restarts.");
  return randomBytes(32).toString("hex");
}

/** Configuration read from the environment. Nothing here depends on an outside platform. */
export const ENV = {
  isProduction,
  databaseUrl: process.env.DATABASE_URL ?? "",
  /** Signs session tokens. At least 32 random characters; required in production. */
  sessionSecret: sessionSecret(),
  sessionDays: Number(process.env.SESSION_DAYS ?? 7),
  /** Where uploaded documents are stored. Keep it outside any publicly served folder. */
  storageDir: process.env.STORAGE_DIR ? path.resolve(process.env.STORAGE_DIR) : path.resolve(process.cwd(), "storage"),
};
