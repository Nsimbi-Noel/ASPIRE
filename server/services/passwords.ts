import { randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const KEY_LENGTH = 64;
const COST = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } satisfies ScryptOptions;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, options, (error, key) => (error ? reject(error) : resolve(key))));
}

/** Format: scrypt$N$r$p$salt$hash (base64). The parameters travel with the hash so they can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST);
  return `scrypt$${COST.N}$${COST.r}$${COST.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64!, "base64");
  if (!expected.length) return false;
  try {
    const key = await derive(password, Buffer.from(saltB64!, "base64"), { N: Number(n), r: Number(r), p: Number(p), maxmem: COST.maxmem });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/** Checked against when no account matches, so an unknown email takes as long to refuse as a wrong password. */
export const DUMMY_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(KEY_LENGTH).toString("base64");

const COMMON = new Set([
  "password", "password1", "passw0rd", "1234567890", "12345678910", "qwertyuiop", "qwerty12345", "letmein123",
  "welcome123", "admin12345", "iloveyou12", "aspire12345", "aspire2026", "uganda12345", "martyrs123",
]);

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

/** Returns what is wrong with a proposed password, or null when it is acceptable. */
export function passwordProblem(password: string, who: { email?: string | null; name?: string | null } = {}): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return "That password is too common. Choose something less guessable.";
  if (new Set(lower).size < 4) return "That password repeats too few characters.";
  const local = who.email?.split("@")[0]?.toLowerCase();
  if (who.email && lower === who.email.toLowerCase()) return "The password must not be your email address.";
  if (local && local.length >= 4 && lower.includes(local)) return "The password must not contain your email name.";
  const name = who.name?.toLowerCase().replace(/\s+/g, "");
  if (name && name.length >= 5 && lower.replace(/\s+/g, "").includes(name)) return "The password must not contain your name.";
  return null;
}

const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0 O 1 l I

/** A one-time password shown once to the registrar, for example "k7Hq-Wm3z-Rt9X-pB4n". About 90 bits. */
export function generateTemporaryPassword(): string {
  const group = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return [group(), group(), group(), group()].join("-");
}
