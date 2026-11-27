# ASPIRE: Task List

Our task list merged with what this application now delivers. Items marked **(blocker)** hold up later work.

## Build now

### Before first use
- [x] Committed and pushed to `origin/test-1`
- [ ] Run `pnpm db:migrate` on your database (`0003` reduces the roles and adds faculties; `0004` adds account columns; `0005` adds campus/study-mode choice columns; `0006` adds faculty recommendations; `0007` adds soft-delete support for applicant drafts)
- [ ] If staff accounts already exist, assign each faculty administrator a faculty under Rule governance (until then they see nothing)
- [ ] Sign in as the project owner, open **Rule governance** and create the first rule versions from the data files
- [ ] Click through every screen as each role (registrar, a faculty administrator, an applicant), including the programme catalogue's faculty/campus/mode filters and the campus/study-mode details shown in application choices. The interface was type-checked and built, but not viewed in a browser
- [ ] Run `pnpm test:db` against a disposable MySQL database on your own machine (passed here: access 41, rules 17; auth baseline 8 passed/3 failed; document HTTP suite skipped for missing tools)

### Data and catalogue
- [ ] Add tuition fees to the programme catalogue from the brochure (campuses, study modes and per-programme offerings with duration are imported and exposed in the catalogue and application choices)
- [ ] Check the two eligibility-affecting rule entries (`must-15`, `mak-91`) against the PDF
- [ ] Add a demo-data seeder (synthetic applicants across faculties) so faculty scoping can be shown in the interface

### Product gaps
- [ ] Deliver notifications by email or SMS (today they are recorded in the app only)
- [ ] Move the sign-in rate limiter from memory to a shared store before running more than one server instance
- [ ] Open self-registration to everyone or restrict it to an invited intake list (see [docs/DECISIONS.md](docs/DECISIONS.md))

## Send once, then wait

Cheap to do now, slow to come back. Send one email, then carry on building.

- [ ] Send one email to the admissions office covering everything under "Waiting on replies", and ask for a meeting
- [ ] **(blocker)** Ask the supervisor how past-intake data can be obtained
- [ ] Start written approvals: registrar, admissions office, research / ethics body

### Waiting on replies
- [ ] **(blocker)** UMU's approval of each adopted rule set; record it under Rule governance. Until then no admit decision can be recorded
- [ ] Confirmation of the 36 mapped Nkozi programmes (27 bachelor's; 3 partial primary matches, 5 partial rule references including alternates) and the imported campus/study-mode/duration offerings
- [ ] Decision on whether degrees require 5 UCE passes (the engine has a switch, off by default)
- [ ] Confirmation of no minimum weighted score or cut-offs
- [ ] Document list per entry route
- [ ] Subject list for "relevant to programme" at diploma level (manual review until then)
- [ ] How "or equivalent" qualifications are recorded
- [ ] Confirm that the registrar's final verdict may differ from the faculty's recommendation (currently allowed and audited)
- [ ] Who creates an application for a walk-in applicant
- [ ] 10-20 real anonymised applicant outcomes as golden test cases
- [ ] Anonymised past-intake data: results, programme, decision, year-1 outcome
- [ ] Sample result slips for checking extraction

## Parked (until the system runs on real data)

### Machine learning and extraction accuracy
- [ ] Measure document extraction accuracy at field level
- [ ] Build the baseline progress model (aggregate points only)
- [ ] Train logistic regression, then a gradient boosting challenger
- [ ] Add calibration and per-prediction explanations
- [ ] Agree a precise definition of "progress" with the registrar

### Evaluation and write-up
- [ ] Compare engine outcomes with past registrar final verdicts and analyse every disagreement
- [ ] Evaluate the progress predictor out-of-time against the baseline
- [ ] Check error rates and calibration by gender and region
- [ ] Time the screening process against the manual process
- [ ] Test with admissions staff and record their feedback
- [ ] Run a short usability session with staff and a small group of applicants
- [ ] Fill in the results log in [docs/EVALUATION.md](docs/EVALUATION.md)
- [ ] Write the final report and prepare the demo
- [ ] Hand over documentation and deployment notes

### Literature
- [ ] Re-read references 1-6 and confirm each supports the claim it is cited for
- [ ] Check reference 5 (Aguti et al.) full text before using it for any career-guidance claim
- [ ] Find a peer-reviewed source on ML progress prediction to sit alongside reference 4
- [ ] Fix reference 3 (Bangladesh paper) in the concept note itself (bundle with the addendum to the supervisor)

### Other
- [ ] Check the remaining entries in `data/rules/programme-weights.2026-27.json` against the PDF (scores are advisory)
- [ ] Optional hardening: move to PostgreSQL for database-level row security (see [docs/DECISIONS.md](docs/DECISIONS.md))
- [ ] Give faculty administrators a read-only view of their programmes' rule versions
- [ ] **Checkpoint, end of Month 2:** if real data is still unavailable, reframe the progress predictor as a demonstrated pipeline and agree this with the supervisor

## Done

- [x] Collected UMU's general entry requirements and the public-universities weighting document
- [x] Rules engine (`server/rules-engine`) with explainable results, routes, the weighted score and `ON_HOLD` for manual review
- [x] Decided: no minimum weighted score or cut-offs (private university)
- [x] **Roles reduced to applicant, registrar and faculty_administrator**, with a data-safe migration for existing users
- [x] **Faculty scoping:** a faculty administrator sees only applicants who applied to their faculty, plus that faculty's runs, decisions and history. Enforced for every procedure and tested against real MySQL
- [x] **Programme choices:** up to five, in order; an application cannot be submitted without one
- [x] **Rule versions:** stored, never edited, seeded from the data files, with proposals, activation, retirement and effective dates
- [x] **UMU approval recorded** with who, when and a reference; **admit decisions require it and a current faculty recommendation**
- [x] Screening uses stored rule sets and records the version used
- [x] Fixed: same-second screening runs could tie, letting a decision be checked against a stale run
- [x] Applicants see a decision's outcome and date, not the reasoning; faculty administrators cannot edit applicant data
- [x] Unit suites and the access/rules MySQL suites pass (120 unit, 40 access, 17 rules); document HTTP suite is written but skipped locally for missing document tools, and the auth DB baseline remains 8 passed/3 failed; deliberately breaking the scoping, approval and rule-lookup rules was caught each time
- [x] Safety: the database tests refuse to run unless the database name contains "test"
- [x] Documentation: README, architecture, data model, decisions and the supporting docs
- [x] Applicants can create, edit and submit applications, enter UCE and UACE results and upload documents, and see each programme screened separately
- [x] Deterministic screening with check traces, immutable input snapshots and per-programme outcomes (`ELIGIBLE`, `NOT_ELIGIBLE`, `ON_HOLD`)
- [x] Programme ranking (TOPSIS) with near misses and diploma and certificate pathways, advisory only
- [x] Programme catalogue and rule mappings with exact, close and partial match strength and provisional status; faculty, campus, study-mode and duration offerings are imported, with staff filters/columns and application-choice detail display
- [x] Document intake with advisory extraction; a person confirms every extracted mark
- [x] Hold and correction workflow: automatic re-screening, document deadlines, recorded notifications and appeals
- [x] Faculty recommendations followed by registrar final verdicts, with mandatory reasons and overrides recorded in an append-only audit log
- [x] Strict results CSV import (registrar) and export (scoped), with superseded rows retained
- [x] Advisory anomaly flags that never change eligibility
- [x] Progress prediction marked unavailable until approved data exists; nothing is fabricated
- [x] Self-hosted accounts: applicant self-registration, registrar-created staff accounts with one-time passwords, forced password change, scrypt hashing, password rules, lockout and session invalidation. First registrar created with `pnpm create:registrar`; see [README.md](README.md)
- [x] Private document storage on a mounted folder, served only through an authenticated, audited route
- [x] Tests for the account code: unit tests for password rules, rate limiter, session tokens and storage keys; real-MySQL tests for register, sign-in, lockout, password change, reset, deactivation and forced change; the real-server HTTP document suite is written but skipped locally because `pdftotext`, `pdftoppm` and `tesseract` are unavailable (auth DB baseline 8 passed/3 failed)
- [x] `scripts/e2e-production.mjs` runs the built production server end to end
- [x] Merged task list plus a dedicated [remaining work](REMAINING_WORK.md) file

See [REMAINING_WORK.md](REMAINING_WORK.md) for checks that still need a browser, a running database or deployed tools.

## Ongoing

- [ ] Update [docs/DECISIONS.md](docs/DECISIONS.md) whenever a decision is made
- [ ] Meet the supervisor regularly and note the feedback
- [ ] Keep the README and docs in step with the code
- [ ] Never commit real applicant data to the repository
