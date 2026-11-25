# Decisions and Open Questions

## Decisions

| Date | Decision | Reason |
| --- | --- | --- |
| Oct 2026 | Rules engine decides eligibility; ML is advisory only | Explainability, auditability, fairness |
| Oct 2026 | Rules stored as data, versions never edited | Past decisions stay reproducible |
| Oct 2026 | Adopt the public-universities weighting system (2026/27 Ministry document, as published for Makerere) for similar programmes, labelled provisional until UMU approves | UMU publishes no programme-specific rules |
| Oct 2026 | No minimum weighted score or cut-offs | UMU is a private university; the score is for ranking and fit only |
| Oct 2026 | Three roles: applicant, registrar, faculty_administrator | Project owner's decision |
| Oct 2026 | A faculty administrator sees only applicants who applied to their faculty, through programme choices | Project owner's decision |
| Oct 2026 | Applications record the programmes applied to (up to five); an application cannot be submitted without one | Without a choice there is no faculty to receive it |
| Oct 2026 | Admit decisions require a recorded UMU approval of the rule set used | Provisional rules must not produce admissions |
| Oct 2026 | Registrar records approval with who approved and a reference; a proposal cannot claim to be official | Only UMU publishes official rules |
| Oct 2026 | Stay on MySQL; enforce scoping in the server and test it against real MySQL | The platform's database is MySQL. Row-level security is not available |
| Oct 2026 | Applicants see a decision's outcome and date, not the reasoning, and only their own audit events | Internal deliberation stays internal |
| Oct 2026 | Faculty administrators cannot edit an applicant's results; only the applicant and the registrar can | Keeps the applicant's record under the applicant's or registrar's control |
| Oct 2026 | Bulk results import is registrar only | It spans faculties |
| Oct 2026 | Latest screening run ordered by time then id | Same-second runs tied, which could check a decision against a stale run |
| Oct 2026 | Replace Manus OAuth with self-hosted email-and-password accounts | Applicants need accounts without a Manus login; no external identity provider is required |
| Oct 2026 | First registrar is created by `pnpm create:registrar`; the first account becomes the project owner | Nobody can sign in on an empty database, so bootstrap must be a command, not a web form |
| Oct 2026 | Passwords: 10–128 characters, not common, four distinct characters, not the person's email name or name; scrypt hashing | Guards weak and personal passwords without burdensome composition rules |
| Oct 2026 | Five failed sign-ins lock an account for 15 minutes; IP rate limits in memory; changing a password, reset or deactivation invalidates all sessions | Limits guessing and ends sessions after a credential change; the limiter must move to shared storage before horizontal scaling |
| Oct 2026 | Registrar-created staff accounts get a one-time password and must choose their own before continuing | The issuer never needs to know a password the person will keep |
| Oct 2026 | Uploads live in a private `STORAGE_DIR` folder (a Docker volume) and are served only through an authenticated, audited route | Files must survive redeployment and must never be directly reachable over HTTP |

## Open questions

| # | Question | Owner |
| --- | --- | --- |
| 1 | Will UMU's admissions office approve the adopted rules, or supply its own? Record each approval under Rule governance | Admissions office |
| 2 | Confirm each programme mapping (30 mapped, 5 partial) | Admissions office / faculties |
| 3 | Should degrees require 5 UCE passes? (the engine has a switch, off by default) | Admissions office |
| 4 | Document list per entry route (the engine uses an assumed default) | Admissions office |
| 5 | Which subjects count as relevant for diploma entry? (manual review until answered) | Admissions office / faculties |
| 6 | How are "or equivalent" qualifications recorded and judged? | Admissions office |
| 7 | Who records the committee's final decisions? (assumed: the faculty administrator, on the committee's behalf) | Nsimbi / admissions office |
| 8 | Who creates an application for a walk-in applicant? (the registrar can; it is then owned by the registrar's account) | Nsimbi / admissions office |
| 9 | Should a faculty administrator keep seeing an applicant after a withdrawal? (today no; the history is kept) | Nsimbi |
| 10 | Open self-registration to everyone, or restrict it to an invited intake list? | Nsimbi / admissions office |
| 11 | How applicants are notified (in-app only today) | Admissions office |
| 12 | Move to PostgreSQL to add database-level row security? | Nsimbi |
| 13 | Real anonymised past-intake data and the approvals to use it | Supervisor / registrar |
