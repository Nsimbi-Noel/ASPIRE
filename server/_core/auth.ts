import { SESSION_COOKIE } from "@shared/const";
import { parse as parseCookie } from "cookie";
import type { Request, Response } from "express";
import { jwtVerify, SignJWT } from "jose";
import type { User } from "../../drizzle/schema";
import { getUserById } from "../db";
import { sessionCookieOptions } from "./cookies";
import { ENV } from "./env";

const key = () => new TextEncoder().encode(ENV.sessionSecret);

/** A signed token naming the user and their session version. It carries no personal data. */
export async function signSession(user: Pick<User, "id" | "sessionVersion">, expiresIn: string | number = `${ENV.sessionDays}d`): Promise<string> {
  return new SignJWT({ sv: user.sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key());
}

export async function readSession(token: string): Promise<{ userId: number; sessionVersion: number } | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0 || typeof payload.sv !== "number") return null;
    return { userId, sessionVersion: payload.sv };
  } catch {
    return null;
  }
}

/** The signed-in user for a request, or null. Deactivated accounts and ended sessions are refused. */
export async function authenticateRequest(req: Pick<Request, "headers">): Promise<User | null> {
  const header = req.headers?.cookie;
  if (!header) return null;
  const token = parseCookie(header)[SESSION_COOKIE];
  if (!token) return null;
  const session = await readSession(token);
  if (!session) return null;
  const user = await getUserById(session.userId);
  if (!user || !user.isActive || user.sessionVersion !== session.sessionVersion) return null;
  return user;
}

export async function startSession(req: Request, res: Response, user: Pick<User, "id" | "sessionVersion">): Promise<void> {
  const token = await signSession(user);
  res.cookie(SESSION_COOKIE, token, { ...sessionCookieOptions(req), maxAge: ENV.sessionDays * 24 * 60 * 60 * 1000 });
}

export function endSession(req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(req), maxAge: -1 });
}
