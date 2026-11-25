import "dotenv/config";
import { getDb } from "../db";
import { createRegistrar, resetPasswordFromCli } from "../services/bootstrap";

/**
 * Usage:
 *   pnpm create:registrar "Full Name" name@example.org            create the first (or another) registrar
 *   pnpm create:registrar name@example.org --reset                set a new password for an existing account
 * The password is read from ASPIRE_REGISTRAR_PASSWORD, or typed at a hidden prompt.
 */
function ask(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    let typed = "";
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n" || char === "\u0004") {
          stdin.setRawMode?.(false); stdin.pause(); stdin.off("data", onData); process.stdout.write("\n");
          return resolve(typed);
        }
        if (char === "\u0003") process.exit(1);
        typed = char === "\u007f" || char === "\b" ? typed.slice(0, -1) : typed + char;
      }
    };
    stdin.on("data", onData);
  });
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--reset");
  const reset = process.argv.includes("--reset");
  const [first, second] = args;
  if (!first || (!reset && !second)) throw new Error('Usage: pnpm create:registrar "Full Name" name@example.org   (or: pnpm create:registrar name@example.org --reset)');
  let password = process.env.ASPIRE_REGISTRAR_PASSWORD ?? "";
  if (!password) {
    if (!process.stdin.isTTY) throw new Error("Set ASPIRE_REGISTRAR_PASSWORD, or run this in a terminal to type the password.");
    password = await ask("Password: ");
    if ((await ask("Repeat the password: ")) !== password) throw new Error("The passwords do not match.");
  }
  const db = await getDb();
  if (!db) throw new Error("DATABASE_URL is not set or the database cannot be reached.");
  if (reset) {
    await resetPasswordFromCli(db, first, password);
    console.log(`Password reset for ${first}. All of their sessions have ended.`);
  } else {
    const result = await createRegistrar(db, { name: first, email: second!, password });
    console.log(`Created registrar ${second} (id ${result.id})${result.owner ? " as the project owner" : ""}. You can sign in now.`);
  }
}

main().then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
