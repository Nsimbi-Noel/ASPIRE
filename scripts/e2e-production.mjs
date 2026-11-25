// Runs the built production server and exercises it over HTTP.
// Requires a disposable MySQL database whose name contains "test" and a prior `pnpm build`.
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const healthOnly = process.env.E2E_HEALTH_ONLY === "1";
if (!healthOnly && (!url || !/test/i.test(new URL(url).pathname))) {
  console.error(
    'Set TEST_DATABASE_URL to a disposable MySQL database whose name contains "test", or E2E_HEALTH_ONLY=1 for a database-free smoke check.'
  );
  process.exit(2);
}

const bundle = path.resolve("dist/index.js");
try {
  await stat(bundle);
} catch {
  console.error("dist/index.js is missing. Run `pnpm build` first.");
  process.exit(2);
}

const port = await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.on("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    probe.close(() => resolve(address.port));
  });
});
const base = `http://127.0.0.1:${port}`;
const storageDir = await mkdtemp(path.join(tmpdir(), "aspire-e2e-storage-"));
const child = spawn(process.execPath, [bundle], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    DATABASE_URL: url ?? "",
    SESSION_SECRET:
      process.env.SESSION_SECRET ??
      "e2e-only-secret-that-is-long-enough-1234567890",
    STORAGE_DIR: storageDir,
    TRUST_PROXY: "false",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", chunk => (output += chunk.toString()));
child.stderr.on("data", chunk => (output += chunk.toString()));

const check = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`  PASS ${message}`);
};

const post = (name, input, cookie) =>
  fetch(`${base}/api/trpc/${name}?batch=1`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ 0: { json: input } }),
  });
const dataOf = body => body?.[0]?.result?.data?.json;

try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null)
      throw new Error(`Server exited before becoming ready:\n${output}`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error(`Server did not become ready:\n${output}`);
  check(ready, "production server starts and answers /api/health");

  const page = await fetch(`${base}/`);
  check(
    page.ok && (await page.text()).includes("ASPIRE"),
    "built client is served from the production bundle"
  );

  const docResponse = await fetch(`${base}/api/documents/1/file`);
  check(docResponse.status === 401, "documents refuse a signed-out user");

  if (healthOnly) {
    console.log(
      "Health-only production check passed (set TEST_DATABASE_URL for the full check)."
    );
  } else {
    const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 10000)}@example.org`;
    const password = "Production!Pass42";
    const registered = await post("auth.register", {
      name: "E2E Applicant",
      email,
      password,
    });
    const registeredBody = await registered.json();
    check(
      registered.ok && dataOf(registeredBody)?.email === email,
      "self-registration works over HTTP"
    );
    const setCookie = registered.headers.get("set-cookie") ?? "";
    const cookie = setCookie.split(";")[0];
    check(
      /aspire_session=/.test(cookie) && /HttpOnly/i.test(setCookie),
      "a Secure HTTP-only session cookie is issued"
    );
    check(
      !JSON.stringify(registeredBody).includes("passwordHash"),
      "the password hash is not returned to the client"
    );

    const meResponse = await fetch(
      `${base}/api/trpc/auth.me?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: { json: null } }))}`,
      { headers: { cookie } }
    );
    const me = dataOf(await meResponse.json());
    check(
      meResponse.ok && me?.email === email,
      "the signed cookie authenticates the next request"
    );

    const logout = await post("auth.logout", null, cookie);
    check(
      logout.ok &&
        /aspire_session=;/.test(logout.headers.get("set-cookie") ?? ""),
      "sign-out clears the session cookie"
    );
    console.log("Production end-to-end check passed.");
  }
} finally {
  child.kill("SIGTERM");
  await new Promise(resolve => setTimeout(resolve, 250));
  if (child.exitCode === null) child.kill("SIGKILL");
  await rm(storageDir, { recursive: true, force: true });
}
