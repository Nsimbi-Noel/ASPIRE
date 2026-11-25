# Remaining work

Everything still open after the account replacement and the new test suites. The standing project items below are unchanged; they are collected here so the list in the earlier replies is not the only copy. [TODO.md](TODO.md) remains the merged task list.

## Verification still to do by a person

- [ ] Open the app in a browser and click through **every screen as each role** (registrar, faculty administrator, applicant), including the new sign-in, self-registration, account (forced password change) and user-management pages. Type checking, tests and the production HTTP check do not replace this.
- [ ] Build and run the Docker image, then confirm `pdftotext`, `pdftoppm` and `tesseract` are present inside the container and that uploads remain in the mounted `/app/storage` volume across container replacement. The Dockerfile installs the tools and declares the volume; the image itself has not been built here.
- [ ] Run `pnpm test:db` and the HTTP suite against a disposable MySQL database on the target machine, then run `pnpm e2e:production` against the built bundle.

## Known limitation

- [ ] The sign-in/registration rate limiter is in memory: it resets on restart and only covers one server process. Use a shared store (for example Redis) before running multiple instances. Account lockout itself is stored in MySQL and is already shared.

## Standing project items (unchanged)

### Before first use
- [ ] Create the first registrar with `pnpm create:registrar`, then create the rule versions under **Rule governance**
- [ ] If staff accounts already exist, assign each faculty administrator a faculty under Rule governance (until then they see nothing)
- [ ] Commit this refined clone to Git
- [ ] Run `pnpm db:migrate` on your database (migration `0003` reduces the roles and adds faculties; `0004` adds the account columns)

### Data and catalogue
- [ ] Add campus, mode, duration and fees to the programme catalogue from the brochure
- [ ] Check the two eligibility-affecting rule entries (`must-15`, `mak-91`) against the PDF
- [ ] Add a demo-data seeder (synthetic applicants across faculties) so faculty scoping can be shown in the interface

### Send once, then wait
- [ ] Send one email to the admissions office covering everything under "Waiting on replies", and ask for a meeting
- [ ] **(blocker)** Ask the supervisor how past-intake data can be obtained
- [ ] Start written approvals: registrar, admissions office, research / ethics body

### Waiting on replies
- [ ] **(blocker)** UMU's approval of each adopted rule set; record it under Rule governance. Until then no admit decision can be recorded
- [ ] Confirmation of the 30 programme mappings (5 are partial)
- [ ] Decision on whether degrees require 5 UCE passes (the engine has a switch, off by default)
- [ ] Confirmation of no minimum weighted score or cut-offs
- [ ] Document list per entry route
- [ ] Subject list for "relevant to programme" at diploma level (manual review until then)
- [ ] How "or equivalent" qualifications are recorded
- [ ] Who records the committee's final decisions (assumed: the faculty administrator)
- [ ] Who creates an application for a walk-in applicant
- [ ] 10-20 real anonymised applicant outcomes as golden test cases
- [ ] Anonymised past-intake data: results, programme, decision, year-1 outcome
- [ ] Sample result slips for checking extraction

### Parked until real data exists
- [ ] Measure document extraction accuracy at field level
- [ ] Build the baseline progress model, then logistic regression and a gradient-boosting challenger
- [ ] Add calibration and per-prediction explanations; agree a definition of "progress" with the registrar
- [ ] Compare engine outcomes with past committee decisions; evaluate the predictor out of time; check error rates by gender and region
- [ ] Time screening against the manual process; test with admissions staff; run a usability session with staff and applicants
- [ ] Fill in [docs/EVALUATION.md](docs/EVALUATION.md), write the final report, prepare the demo and hand over documentation
- [ ] Re-read references 1-6; check reference 5 (Aguti et al.) and the Bangladesh paper (reference 3); find a peer-reviewed source on ML progress prediction
- [ ] Check the remaining entries in `data/rules/programme-weights.2026-27.json` against the PDF
- [ ] Optional hardening: PostgreSQL for database-level row security
- [ ] Read-only view of rule versions for faculty administrators
- [ ] **Checkpoint, end of Month 2:** if real data is unavailable, reframe the progress predictor as a demonstrated pipeline and agree this with the supervisor
