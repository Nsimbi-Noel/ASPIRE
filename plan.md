# ASPIRE — implementation plan

> **Decisions applied in October 2026** (they override anything below that says otherwise)
>
> - **Roles:** applicant, registrar and faculty administrator only. The earlier officer, committee and administrator roles were removed.
> - **Faculty scoping:** a faculty administrator sees only applicants who applied to a programme in their own faculty. Applications link to faculties through `applicationProgrammes`.
> - **Rule versions:** stored, versioned and never edited. A registrar activates a version and records UMU's approval of it. An admit decision requires a recorded approval of the rule set the screening used.
> - **Database:** still MySQL. Because MySQL has no row-level security, scoping is enforced in the server and tested against a real database.
> - **Applicant privacy:** applicants see a decision's outcome and date but not the reasoning, and only their own audit events.
> - **Accounts (replacing Manus OAuth):** applicants register with an email and password; registrars create staff accounts with a one-time password that must be changed at first sign-in. The first registrar is bootstrapped with `pnpm create:registrar`. Passwords follow the shared rules (10–128 characters, not common, four distinct characters, not the person's email name or name); scrypt hashes, five-attempt lockout, IP rate limits and session invalidation on password changes.
> - **Storage:** uploads stay in a private `STORAGE_DIR` folder, declared as a Docker volume, and are served only through an authenticated, audited route.

## Goal and boundary

Build an operational, human-reviewed admissions decision-support web application from the supplied October 2026 concept note and the feature-1 material already inspected. This is a separate copy in the newly initialized ASPIRE project; the original `Nsimbi-Noel/ASPIRE-` GitHub repository and its `feature-1` branch remain untouched. Do not publish the app or push changes to that upstream repository without a separate request.

Use synthetic/demo records only. The supplied programme mappings are provisional proxies pending UMU approval. Unresolved or partial mappings must remain visibly provisional and must not silently become official rules. The app may recommend or explain, but it must not make admission offers or replace a committee decision. Do not treat the current sandbox or preview as approved for real applicant data.

## Implementation approach

Use the initialized React + TypeScript frontend, Express/tRPC backend and managed MySQL database with Drizzle migrations. Use our own email-and-password accounts and private local file storage instead of the template's authentication and storage integrations; enforce authorization on the server for every role-specific operation and keep uploaded-file records separate from their stored objects. Build the existing TypeScript rules engine into the app as a deterministic module, retaining rule source, edition, status, approval and check traces.

The first working release will support synthetic/demo intake records and the complete core workflow: applicant profile and UCE/UACE results; document upload/status and manual grade entry; per-programme screening with `ELIGIBLE`, `NOT_ELIGIBLE` and `ON_HOLD`; missing-document and manual-review reasons; programme suggestions, fit ranking and near misses; staff review queues; committee decisions; mandatory-reason overrides; applicant correction/appeal; hold re-screening; audit history; and CSV import/export. Rule catalog, programme catalog, mapping confidence and approval status will be reviewable and versioned. Existing proxy mappings will be reconciled with the newer pasted mapping rather than copied in blindly: unresolved IDs and unsupported levels must be handled explicitly, and partial matches routed to review.

The recommendation layer will keep eligibility separate from ranking. Implement a transparent weighted programme-fit ranking that can use the documented TOPSIS/AHP approach, but do not turn weights into eligibility thresholds. Document verification will have upload tracking, extraction/status fields, confidence and discrepancy review, with manual entry as the reliable fallback. Any OCR integration is advisory and must not alter submitted marks without human confirmation. Anomaly flags are review prompts only. A progress-prediction panel will remain unavailable/clearly marked unvalidated until approved, anonymized historical outcomes exist; no performance score will be fabricated from synthetic data. Protected characteristics may be stored only where justified for separate fairness evaluation, not used as fit or prediction inputs.

Persist applicants, result records, file metadata, programmes, versioned rule sets and mappings, screening runs with immutable input snapshots and per-check traces, recommendations, committee decisions, overrides, correction/appeal events, and append-only audit events. Apply role-based visibility and a retention/deletion policy that does not promise physical deletion where storage does not support it. A CSV pathway is included; external national integrations, automated offers, payments and scholarships remain out of scope.

## Main project structure

- `client/src/pages/` — applicant portal, staff dashboard, programme catalogue, case detail, rules/mappings, review and evaluation views.
- `client/src/components/` — reusable navigation, status labels, evidence/trace panels, forms and accessible data tables.
- `server/routers.ts` and `server/routers/` — authenticated tRPC endpoints grouped by applicant, screening, documents, committee, rules and reporting.
- `server/services/` — screening orchestration, mapping validation, ranking, CSV handling, audit events, document review and advisory interfaces.
- `drizzle/schema.ts` plus `drizzle/` — application entities and additive migrations.
- `packages/rules-engine/` or `server/rules-engine/` — pure deterministic screening logic and tests, adapted from feature-1.
- `data/rules/` — source rule files, provisional programme mappings and synthetic demo fixtures, with provenance preserved.
- `client/src/pages/Login.tsx`, `Account.tsx` — sign-in/self-registration and the forced password-change screen.
- `plan.md` and `TODO.md` — approved design/implementation decisions and user-visible deliverables.

## Design direction

Three candidate directions (probabilities are low-probability alternatives, not user-selected preferences): **Editorial civic-tech** (0.07), **Quiet academic modernism** (0.04), **Warm regional institutional** (0.02). Choose **Editorial civic-tech**, because ASPIRE needs to make rules, evidence and human accountability legible rather than resemble a marketing site.

- **Design movement:** Editorial civic-tech with restrained Swiss-influenced information design.
- **Core principles:** Legible evidence; calm, non-punitive language; visible human accountability; provisional rules never masquerade as certainty.
- **Color philosophy:** Warm paper surfaces reduce institutional harshness; deep ink provides authority; a distinctive lake-teal signals action and guidance; amber marks pending/provisional status; red is reserved for errors, not applicant identity or outcome.
- **Layout paradigm:** A persistent slim navigation rail and a wide working canvas; queue-to-case split views for staff, with responsive stacked layouts on small screens. Prioritize usable tables and evidence panels over decorative dashboard tiles.
- **Signature elements:** Rule-provenance ribbons; exact/close/partial mapping badges; a chronological screening and decision trace.
- **Interaction philosophy:** Progressive forms with save/continue states; every outcome links to its checks; manual-review states explain what a person must resolve; no irreversible admission action from the system.
- **Animation:** Subtle 140–200 ms transitions for menus, tabs and row expansion; no animated outcome effects; respect reduced-motion settings.
- **Typography system:** IBM Plex Sans for interface and reading, paired with IBM Plex Mono for rule IDs, score breakdowns and audit references; use a clear 12/14/16/20/28 px hierarchy.
- **Brand essence:** “Clear admissions decisions, with a person accountable at every step.” Personality: precise, fair-minded, practical.
- **Brand voice:** Direct and respectful. Example: “Two checks need staff review before this programme can be assessed.” “Your application is on hold until we receive the listed document.”
- **Wordmark & logo:** A compact ASPIRE wordmark with an open-gate mark formed from two upright strokes and a rising evidence line; avoid graduation-cap clichés.
- **Signature brand color:** Lake teal `#0F766E`, used sparingly for primary actions and confirmed positive progress, never as a substitute for match-strength or approval labels.

## Constraints and material decisions

- The application uses managed MySQL through the initialized Webdev template; the feature-1 concept proposed PostgreSQL, but this project's provided database integration is MySQL-compatible.
- Application sign-in is self-hosted: email and password with signed session cookies, no Manus account or external identity provider. The project owner is created from the command line before the first sign-in; applicants register themselves, and staff accounts are issued one-time passwords by a registrar. The rate limiter is in memory and must be replaced with a shared store before running multiple server instances.
- Development and published application processes share the managed database. Use synthetic seed data and avoid destructive test writes.
- Real applicant records, OCR output, advisory models, and live admissions decisions require approvals, appropriate security review, UMU confirmation of rules, official UNEB verification before offers, and fairness evaluation. Those approvals/data have not been supplied.
- A trained progression model cannot be validated without approved anonymized historical outcomes. Implementing its production use is therefore dependent on later approved data.
