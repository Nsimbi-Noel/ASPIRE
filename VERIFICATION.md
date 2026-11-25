# Verification report

Run on 19 November 2026 in the `C:\Users\DELL\Desktop\ASPIRE-clone` sandbox after the account replacement, the lost edits and the new test suites.

## Passed here

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | completed |
| `pnpm check` (TypeScript) | passed |
| `pnpm test` | 15 files passed, 103 tests passed, 0 failed; 4 integration files skipped by design |
| `pnpm build` (Vite client + esbuild server) | passed |
| `E2E_HEALTH_ONLY=1 pnpm e2e:production` | production bundle starts, serves the built client, answers `/api/health`, refuses signed-out document access |
| `server/deployment.test.ts` | confirms the Dockerfile installs `poppler-utils` and `tesseract-ocr`, declares the `/app/storage` volume, and that `storage/` and `.env` are ignored |
| `server/auth.logout.test.ts` | confirms the new `aspire_session` cookie is cleared with same-site/lax, HTTP-only, Secure options — the old Manus-cookie assertion is gone |
| Type-check of all test files with a temporary tsconfig | passed (temporary file removed afterwards) |

## Re-verified on 25 November 2026 (current workspace)

The `pnpm` wrapper did not return in this shell, so the installed binaries were invoked directly; these are the same commands behind `pnpm check`, `pnpm test` and `pnpm build`.

| Check | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | passed |
| `node node_modules/vitest/vitest.mjs run` | 15 files passed, 103 tests passed, 0 failed; 4 integration files skipped by design (64 tests) |
| `node node_modules/vite/bin/vite.js build` | passed; 1,723 modules transformed |
| `node node_modules/esbuild/bin/esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist` | passed; `dist/index.js` 240.3 kB |

## Excluded from the UI in this pass

- **Evaluation workspace:** `/evaluation` route and `EvaluationPage` removed. The `aspire.evaluation` endpoint remains only for dashboard counts and CSV cache invalidation.
- **Applicant rule exposure:** the programme catalogue and rule-governance screens are staff-only. `/programmes` is now gated to staff even when opened directly; applicants choose programmes inside their application through `catalog.choices`.
- **Applicant screening internals:** rule IDs, thresholds, traces, ranking, advisory scores and screening audit events are no longer shown to applicants. Applicants see a short review status; staff keep screening evidence and a manual re-run action.
- **Provisional mapping indicators:** `rules.proxyStatus` and the shell's provisional pill are no longer shown to applicants. Governance is registrar-only.
- **Unused presentation code:** the theme switcher is not exposed (the app stays in the light UMU theme), and the unused `Home.tsx` template plus unused portions of the shadcn component library remain in source but are not routed or surfaced in the adapted shell.

## Not run here (no MySQL or document tools in the sandbox)

These suites are written, type-checked and skipped rather than failed when their prerequisites are missing. The sandbox has no MySQL server, no `tesseract`, `pdftotext` or `pdftoppm`, and external downloads were too slow to install them.

- `server/auth.integration.test.ts` — register, sign-in, lockout, password change, CLI/reset, deactivation, forced password change (needs MySQL).
- `server/documents.http.integration.test.ts` — real Express server over HTTP, generated PDF/PNG, `pdftotext`/`tesseract` reading, and downloads by applicant, project owner, in-scope staff, out-of-scope staff and signed-out users (needs MySQL and the three tools).
- `server/aspire.access.integration.test.ts`, `server/aspire.rules.integration.test.ts` — the existing scoping and rule-version suites (need MySQL).
- Full `pnpm e2e:production` — needs MySQL; the database-free smoke mode above passed.

To run them on a machine with the prerequisites:

```powershell
$env:TEST_DATABASE_URL="mysql://user:password@127.0.0.1:3306/aspire_test"
pnpm test:db          # or: pnpm test (all suites)
pnpm build
pnpm e2e:production
```

The integration tests delete all data in the named database, whose name must contain `test`.

## Still needs a person

Open the app in a browser as each role, especially the new sign-in, self-registration, account and user-management pages, and build/run the Docker image to confirm the mounted volume survives container replacement. See [REMAINING_WORK.md](REMAINING_WORK.md).
