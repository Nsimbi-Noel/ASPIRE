# ASPIRE

**Applicant Screening and Program Intelligence Recommendation Engine**: explainable, human-reviewed admission screening and programme recommendation for Uganda Martyrs University.

A deterministic rules engine decides eligibility. Machine learning is advisory only and is not enabled until approved data exists. People make every admission decision, and a system result is never an admission offer.

Stack: React, Express, tRPC, Drizzle ORM and MySQL, with self-hosted email-and-password accounts and private on-disk document storage. There is no external identity provider and no Manus sign-in.

## Accounts and sign-in

Applicants register themselves with a name, email and password. Staff accounts are created by a registrar, who gives the person a one-time temporary password; that person must choose their own password at first sign-in before anything else works. A deactivated account is never deleted, because audit and case history refer to it.

Passwords: 10–128 characters, not a common password, at least four different characters, and not containing your email name or your own name. Hashes use scrypt with a per-account salt. Five wrong passwords lock an account for 15 minutes; sign-up and sign-in are also rate-limited by IP. Changing a password, a reset, or deactivation ends every existing session. Sessions are signed cookies (`aspire_session`, HTTP-only, same-site, Secure in production) holding only a user id and a session version; the server requires a fresh session after any of those changes.

### First registrar

On a new database the first account is created from the command line, not through the website:

```bash
cp .env.example .env            # set DATABASE_URL and a random SESSION_SECRET of 32+ characters
pnpm db:migrate
pnpm create:registrar "Registrar Name" registrar@example.org
# or: set ASPIRE_REGISTRAR_PASSWORD in .env to avoid a hidden prompt
```

The command prompts for a password (validated against the rules above) and prints no secret. The first registrar becomes the **project owner** (platform role `admin`), who cannot be demoted or deactivated by other registrars. Later registrars are created from **User management** in the app. To recover a forgotten owner password: `pnpm create:registrar --reset registrar@example.org`.

### Uploaded documents

Uploads are written only to the private folder named by `STORAGE_DIR` (default `./storage`), never to a public directory. They are served solely through `/api/documents/:id/file` after a session check and the same faculty-scope check as the rest of the case; every view is audited. In Docker this folder is a declared volume at `/app/storage`: mount it or use a named volume so documents survive container replacement. The image installs `tesseract-ocr` and `poppler-utils` for advisory text extraction; extracted text never changes a submitted mark without a person's confirmation.

## Roles

Three roles, assigned by the registrar.

| Role | Can do |
| --- | --- |
| `applicant` | Create and edit their own application, choose up to five programmes (with faculty, campus and study-mode details shown from the catalogue), upload documents, see their own results and explanations, appeal. Sees a final decision's outcome and date, never the faculty's or registrar's reasoning. |
| `faculty_administrator` | Verify academic documents, confirm official results, run screenings, record the faculty's recommendation, resolve appeals and reopen cases, **only for programmes and applicants in their own faculty**. Cannot edit an applicant's data or issue a final verdict. |
| `registrar` | Everything, across all faculties: assign roles and faculties, maintain rule versions and record UMU's approval, import results, enter data for an applicant, and record the final verdict after the faculty's recommendation. |

The project owner account acts as a registrar. A faculty administrator with no faculty assigned sees nothing.

### Faculty scoping

An applicant belongs to a faculty only through the programmes they applied to (`applicationProgrammes`). A faculty administrator sees only programmes in their faculty, and sees an application while it has a submitted choice in their faculty, including only that faculty's screening runs, recommendations and verdicts. Withdrawing a choice removes that faculty's access to the applicant, including stale notifications, but keeps the history. This is enforced in the server for every procedure and covered by integration tests against a real MySQL database. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

The admissions decision has two stages: the faculty administrator verifies the academic evidence and records a recommendation; only the registrar can record the final verdict, and only after that recommendation against the latest screening run. Applicants never see internal recommendations or reasoning.

## Rules and approval

UMU's brochure supplies the general entry rules by level and the programme catalogue data (faculty, campus, study mode, duration). Programme-specific subject rules are adopted from the public-universities weighting system and stay **provisional until UMU approves them** ([docs/RULE_SOURCES.md](docs/RULE_SOURCES.md)).

Rule sets are stored as versions that are never edited. A registrar activates a version for screening and records UMU's approval of it (who approved, and the reference). **A final admit verdict can only be recorded when the rule set the screening used has a recorded UMU approval and the programme mapping is settled.** Until then, decline, defer and request-information verdicts still work after the faculty recommendation.

## Run it

```bash
pnpm install
cp .env.example .env            # set DATABASE_URL, SESSION_SECRET (32+ chars) and STORAGE_DIR
pnpm db:migrate
pnpm create:registrar           # first registrar / project owner; prompts for name, email and password
pnpm dev
pnpm check                      # types
pnpm test                       # unit tests; the database tests are skipped
```

After creating the first registrar, sign in with that email and password, open **Rule governance** and choose **Create the first versions from the data files**. Then assign roles and faculties to users under **User management**.

### Database and HTTP tests

The integration tests call the real tRPC procedures as each kind of user against a real MySQL database. They cover faculty scoping, rule versions, and the account flows (registration, sign-in, lockout, password change, CLI and registrar resets, deactivation and forced password change). A further suite starts the real Express app over HTTP, uploads a generated PDF and PNG, reads them with `pdftotext` and `tesseract`, and checks downloads by the applicant, the project owner, in-scope staff, out-of-scope staff and signed-out users. **They delete all data in the database**, so use a disposable database whose name contains `test`; the tests refuse to run otherwise. The HTTP suite also needs `pdftotext`, `pdftoppm` and `tesseract` on `PATH` (all installed by the Docker image).

```bash
# bash
TEST_DATABASE_URL=mysql://user:password@127.0.0.1:3306/aspire_test pnpm test:db
# PowerShell
$env:TEST_DATABASE_URL="mysql://user:password@127.0.0.1:3306/aspire_test"; pnpm test:db
# all integration suites together (unit tests included):
$env:TEST_DATABASE_URL="mysql://user:password@127.0.0.1:3306/aspire_test"; pnpm test
```

`pnpm test` skips the suites that need MySQL or the document tools when they are unavailable. After `pnpm build`, `pnpm e2e:production` starts the built bundle against the same test database and checks it over HTTP. See [REMAINING_WORK.md](REMAINING_WORK.md) for checks still needing a browser or a Docker build.

## Upgrading an existing database

Migration `0003` reduces the roles (`officer`/`committee` to `faculty_administrator`, `administrator` to `registrar`) and seeds the 11 faculties; `0004` adds account columns; `0005` adds campus/study-mode choice columns to `applicationProgrammes`; `0006` adds `facultyRecommendations`. Assign a faculty to every faculty administrator or they will see nothing.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Components, access rules, rule-set lifecycle |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Database tables |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decisions made and open questions |
| [docs/RULE_SOURCES.md](docs/RULE_SOURCES.md) | Where the admission rules come from |
| [docs/RULES_ENGINE.md](docs/RULES_ENGINE.md) | Rules engine specification (`server/rules-engine`) |
| [docs/ETHICS_AND_PRIVACY.md](docs/ETHICS_AND_PRIVACY.md) | Data protection, fairness, approvals |
| [docs/EVALUATION.md](docs/EVALUATION.md) | How the system will be measured |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Five-month workplan |
| [TODO.md](TODO.md) | Merged working task list |
| [REMAINING_WORK.md](REMAINING_WORK.md) | Outstanding checks, known limitations and standing project items |
| [plan.md](plan.md) | Original implementation plan and design direction |
| [VERIFICATION.md](VERIFICATION.md) | Verification runs, UI exclusions and environment-dependent checks |

## Data

Use synthetic or anonymised data only. Real applicant data needs written approval from the registrar, the admissions office and the research or ethics body ([docs/ETHICS_AND_PRIVACY.md](docs/ETHICS_AND_PRIVACY.md)). Official UNEB results must be verified before any offer is made.
