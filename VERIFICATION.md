# Verification report

Historical run on 19 November 2026 in the `C:\Users\DELL\Desktop\ASPIRE-clone` sandbox after the account replacement, the lost edits and the new test suites.

## Final run on 27 November 2026 (current workspace)

Using `C:\Users\edward_admin\Desktop\ASPIRE\node_modules\.bin\pnpm.cmd` (global `pnpm` is not on PATH):

| Check | Result |
| --- | --- |
| `pnpm check` | passed |
| `pnpm test` | 18 files passed, 120 tests passed; 4 integration files skipped by design (76 tests) |
| `pnpm exec vitest run server/aspire.access.integration.test.ts` | 40 passed |
| `pnpm exec vitest run server/aspire.rules.integration.test.ts` | 17 passed |
| `pnpm db:migrate` | migration `0006` applied successfully |
| `pnpm build` | passed; 1,723 modules transformed; `dist/index.js` 282.7 kB |
| `pnpm e2e:production` | 8 HTTP checks passed |
| `git diff --check` | no whitespace errors; CRLF conversion warnings only |

## Passed here

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | completed |
| `pnpm check` (TypeScript) | passed |
| `pnpm test` | 15 files passed, 103 tests passed, 0 failed; 4 integration files skipped by design (historical; superseded above) |
| `pnpm build` (Vite client + esbuild server) | passed |
| `E2E_HEALTH_ONLY=1 pnpm e2e:production` | production bundle starts, serves the built client, answers `/api/health`, refuses signed-out document access |
| `server/deployment.test.ts` | confirms the Dockerfile installs `poppler-utils` and `tesseract-ocr`, declares the `/app/storage` volume, and that `storage/` and `.env` are ignored |
| `server/auth.logout.test.ts` | confirms the new `aspire_session` cookie is cleared with same-site/lax, HTTP-only, Secure options — the old Manus-cookie assertion is gone |
| Type-check of all test files with a temporary tsconfig | passed (temporary file removed afterwards) |

## Historical re-verification on 25 November 2026

`pnpm` was not on PATH in this shell, so `npx --no-install pnpm ...` was used for the package scripts; the checks below record the underlying commands where they were invoked directly.

| Check | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | passed |
| `node node_modules/vitest/vitest.mjs run` | 16 files passed, 106 tests passed, 0 failed; 4 integration files skipped by design (64 tests) |
| `node node_modules/vite/bin/vite.js build` | passed; 1,723 modules transformed |
| `node node_modules/esbuild/bin/esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist` | passed; `dist/index.js` 240.3 kB |
| `server/services/programmeOfferings.test.ts` | 3 tests confirmed offering rows, known campus/mode ids and non-selectable umbrellas; the final run has 4 tests and also asserts Nkozi-only offerings |

## Excluded from the UI in this pass

- **Evaluation workspace:** `/evaluation` route and `EvaluationPage` removed. The `aspire.evaluation` endpoint remains only for dashboard counts and CSV cache invalidation.
- **Applicant rule exposure:** the programme catalogue and rule-governance screens are staff-only. `/programmes` is now gated to staff even when opened directly; applicants choose programmes inside their application through `catalog.choices`, which now includes `campusIds`, `studyModes` and `offerings` but still omits rule identifiers, mapping status and approval data.
- **Applicant screening internals:** rule IDs, thresholds, traces, ranking, advisory scores and screening audit events are no longer shown to applicants. Applicants see a short review status; staff keep screening evidence and a manual re-run action.
- **Provisional mapping indicators:** `rules.proxyStatus` and the shell's provisional pill are no longer shown to applicants. Governance is registrar-only.
- **Unused presentation code:** the theme switcher is not exposed (the app stays in the light UMU theme), and the unused `Home.tsx` template plus unused portions of the shadcn component library remain in source but are not routed or surfaced in the adapted shell.

## Not fully passing or skipped here

- `server/auth.integration.test.ts` — ran against MySQL with 8 passed and 3 failed; the failures are the existing baseline defects and were not changed in this work.
- `server/documents.http.integration.test.ts` — written and skipped because `pdftotext`, `pdftoppm` and `tesseract` are unavailable here. It covers real Express HTTP, generated PDF/PNG, extraction and downloads by applicant, project owner, in-scope staff, out-of-scope staff and signed-out users.
- Browser click-through and Docker image verification still need a person, as noted below.

To run them on a machine with the prerequisites:

```powershell
$env:TEST_DATABASE_URL="mysql://user:password@127.0.0.1:3306/aspire_test"
pnpm test:db          # or: pnpm test (all suites)
pnpm build
pnpm e2e:production
```

The integration tests delete all data in the named database, whose name must contain `test`.

## Still needs a person

Open the app in a browser as each role, especially the new sign-in, self-registration, account and user-management pages, the programme catalogue's faculty/campus/mode filters and columns, and the campus/study-mode details shown in application choices; then build/run the Docker image to confirm the mounted volume survives container replacement. See [REMAINING_WORK.md](REMAINING_WORK.md).
