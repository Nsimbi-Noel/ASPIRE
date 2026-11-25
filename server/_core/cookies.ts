import type { CookieOptions, Request } from "express";
import { ENV } from "./env";

/** Same-site, HTTP-only, and Secure in production or whenever the request arrived over HTTPS. */
export function sessionCookieOptions(req: Pick<Request, "protocol" | "headers">): CookieOptions {
  const forwarded = String(req.headers?.["x-forwarded-proto"] ?? "").split(",")[0]?.trim();
  const secure = ENV.isProduction || req.protocol === "https" || forwarded === "https";
  return { httpOnly: true, sameSite: "lax", secure, path: "/" };
}
