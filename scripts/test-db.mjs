// Runs the integration tests against a real MySQL database. They DELETE ALL DATA in it.
import { spawnSync } from "node:child_process";

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error(
    [
      "TEST_DATABASE_URL is not set, so the integration tests would be skipped.",
      'Point it at a disposable MySQL database whose name contains "test" (these tests delete all data), for example:',
      "  bash:        TEST_DATABASE_URL=mysql://user:password@127.0.0.1:3306/aspire_test pnpm test:db",
      '  PowerShell:  $env:TEST_DATABASE_URL="mysql://user:password@127.0.0.1:3306/aspire_test"; pnpm test:db',
    ].join("\n")
  );
  process.exit(2);
}
const result = spawnSync(
  "pnpm",
  [
    "exec",
    "vitest",
    "run",
    "server/aspire.access.integration.test.ts",
    "server/aspire.rules.integration.test.ts",
    "server/auth.integration.test.ts",
    "server/documents.http.integration.test.ts",
  ],
  { stdio: "inherit", shell: true }
);
process.exit(result.status ?? 1);
