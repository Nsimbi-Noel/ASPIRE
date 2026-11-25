import { describe, expect, it } from "vitest";
import {
  DUMMY_HASH,
  PASSWORD_MAX,
  PASSWORD_MIN,
  generateTemporaryPassword,
  hashPassword,
  passwordProblem,
  verifyPassword,
} from "./passwords";

describe("password rules", () => {
  const strong = "River!Lamp42Cedar";

  it("accepts a strong password without personal details", () => {
    expect(
      passwordProblem(strong, {
        email: "someone@example.org",
        name: "Nobody Special",
      })
    ).toBeNull();
  });

  it("enforces the length limits", () => {
    expect(passwordProblem("short")).toContain(`at least ${PASSWORD_MIN}`);
    expect(passwordProblem("a".repeat(PASSWORD_MIN))).not.toContain("at least");
    expect(passwordProblem("a".repeat(PASSWORD_MAX + 1))).toContain(
      `at most ${PASSWORD_MAX}`
    );
    expect(passwordProblem("Ab1!".repeat(32))).toBeNull();
  });

  it("refuses common and repetitive passwords", () => {
    expect(passwordProblem("1234567890")).toContain("too common");
    expect(passwordProblem("aspire2026")).toContain("too common");
    expect(passwordProblem("aaaaaaaaaaaa")).toContain("few characters");
  });

  it("refuses the person's email address, email name and name", () => {
    expect(
      passwordProblem("nsimbi@example.org", { email: "nsimbi@example.org" })
    ).toContain("email address");
    expect(
      passwordProblem("hello-nsimbi-42", { email: "nsimbi@example.org" })
    ).toContain("email name");
    expect(
      passwordProblem("A trustworthy Testperson", { name: "Test Person" })
    ).toContain("your name");
    expect(
      passwordProblem("hello-nsimbi-42", {
        email: "sam@example.org",
        name: "Sam Doe",
      })
    ).toBeNull();
  });

  it("ignores very short email names and names", () => {
    expect(
      passwordProblem("River!Lamp42Cedar", {
        email: "ab@example.org",
        name: "Jo",
      })
    ).toBeNull();
  });
});

describe("password hashing", () => {
  it("stores parameters and a salt with the hash, and verifies the right password", async () => {
    const stored = await hashPassword("River!Lamp42Cedar");
    expect(stored).toMatch(
      /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/
    );
    expect(await verifyPassword("River!Lamp42Cedar", stored)).toBe(true);
    expect(await verifyPassword("River!Lamp43Cedar", stored)).toBe(false);
  });

  it("uses a fresh salt for each hash", async () => {
    const [a, b] = await Promise.all([
      hashPassword("River!Lamp42Cedar"),
      hashPassword("River!Lamp42Cedar"),
    ]);
    expect(a).not.toBe(b);
    expect(await verifyPassword("River!Lamp42Cedar", b)).toBe(true);
  });

  it("normalises Unicode input the same way when hashing and verifying", async () => {
    const stored = await hashPassword("Café!Mountain42");
    expect(await verifyPassword("Cafe\u0301!Mountain42", stored)).toBe(true);
  });

  it("refuses malformed hashes and the dummy hash", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
    expect(await verifyPassword("anything", DUMMY_HASH)).toBe(false);
  });
});

describe("temporary passwords", () => {
  it("has four groups of unambiguous characters", () => {
    const password = generateTemporaryPassword();
    expect(password).toMatch(
      /^[a-kmnp-zA-HJ-NP-Z2-9]{4}(-[a-kmnp-zA-HJ-NP-Z2-9]{4}){3}$/
    );
    expect(passwordProblem(password)).toBeNull();
  });

  it("generates a different password each time", () => {
    const passwords = new Set(
      Array.from({ length: 20 }, () => generateTemporaryPassword())
    );
    expect(passwords.size).toBe(20);
  });
});
