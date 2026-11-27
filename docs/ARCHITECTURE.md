# Architecture

React client, Express and tRPC server, Drizzle ORM, MySQL. Rules logic is a pure TypeScript package in `server/rules-engine`.

## Layout

| Path | Contents |
| --- | --- |
| `client/src/pages`, `components` | Applicant portal, staff queue, case detail, programmes, document review, rule governance and dashboard counts (no `/evaluation` page); sign-in, account and user-management pages |
| `server/routers/auth.ts` | Self-service register, sign-in, sign-out and password change; login lockout and IP rate limits |
| `server/routers/aspire.ts` | All ASPIRE procedures (profile, catalog, rules, applications, screening, documents, staff, applicant, evaluation), including registrar account creation, reset and deactivation |
| `server/services/passwords.ts`, `server/services/rateLimit.ts` | scrypt hashing and password rules; in-memory sliding-window limiter |
| `server/_core/auth.ts`, `cookies.ts` | Signed session tokens, cookie options and request authentication |
| `server/services/bootstrap.ts`, `server/scripts/createRegistrar.ts` | First-registrar command and CLI password reset |
| `server/storage.ts`, `server/routes/documentFile.ts` | Private local file store and the only document-serving route |

| `server/services/access.ts` | Roles and faculty scope: who may see which rows |
| `server/services/ruleSetStore.ts` | Rule version selection, validation, approval text, seeding |
| `server/services/screeningService.ts` | Programme catalogue (faculty, campuses, study modes, per-programme offerings/duration), mappings, screening orchestration; exposes `listCampuses()` and `listStudyModes()` |
| `server/services/programmeChoices.ts` | The programme choices an application is for |
| `server/services/committeeDecisionPolicy.ts` | When a registrar final verdict may be recorded |
| `server/rules-engine` | Pure screening logic (no I/O, clock or randomness) |
| `data/rules`, `data/catalogue` | UMU general rules, adopted rules, mappings, programme-to-faculty assignments, and programme offerings (campuses, study modes, duration) |
| `drizzle` | Schema and migrations |

## Accounts and sessions

There is no external identity provider. Applicants self-register with name, email and password; registrars create staff accounts with a one-time password that must be changed at first sign-in (`mustChangePassword` is enforced in the tRPC middleware and the document route). The first registrar is created with `pnpm create:registrar` and becomes the project owner (platform role `admin`); `--reset` recovers a forgotten password.

Passwords are scrypt hashes with a stored salt and parameters. The rules (10–128 characters, not common, four distinct characters, not containing the person's email name or name) are checked in one function used by registration, password change, the bootstrap command and CLI reset. Five failed sign-ins lock the account for 15 minutes; sign-in and registration are also limited by client IP in memory. Changing a password, resetting it or deactivating an account raises `sessionVersion`, so tokens issued before that moment stop authenticating even though they are still correctly signed.

A session is an HS256 JWT in the `aspire_session` HTTP-only, same-site cookie, containing only the user id and session version. It is Secure in production or over HTTPS. `SESSION_SECRET` must be at least 32 random characters in production; `SESSION_DAYS` sets the lifetime. The in-memory rate limiter resets on restart and only covers one server process; a shared store is needed before running several instances.

## Document storage

Uploaded bytes are written to `STORAGE_DIR` (default `./storage`) under generated keys such as `private-applications/<applicationId>/<random>`. The store rejects traversal, writes owner-only files atomically and only serves bytes through `GET /api/documents/:id/file`, which requires a valid session, a completed password change and an in-scope application. The Docker image declares `/app/storage` as a volume and installs `poppler-utils` and `tesseract-ocr`; extraction is advisory text only, never an automatic change to a mark.

## Access rules

Roles: `applicant`, `faculty_administrator`, `registrar`. The project owner account (platform role `admin`) acts as a registrar.

Every per-application procedure loads the application through one function, `applicationForActor`, which applies the actor's **scope**:

| Scope | For | Sees |
| --- | --- | --- |
| all | registrar | everything |
| faculty | faculty administrator with a faculty | applications with a **submitted programme choice** in their faculty |
| own | applicant | their own applications |
| none | faculty administrator with no faculty | nothing (fails closed) |

Out-of-scope applications are reported as not found. On top of the application filter:

- **Programme catalogue, screening runs, faculty recommendations and final decisions** are scoped to the programme's `facultyId`. A faculty administrator sees only their own faculty's.
- **Programme choices and the requested programme** in other faculties are hidden from a faculty administrator.
- **History** is redacted: applicants see only their own actions; faculty administrators lose events about other faculties' programmes and the per-outcome counts of full screenings.
- **Notifications** go to the faculty administrators of the faculties the application has a submitted choice in. With no choice yet, the registrars are notified. Notification reads are re-scoped, so withdrawing a choice also removes stale case notifications from that faculty's view.
- **Admissions workflow** has two stages: faculty administrators verify documents, confirm official results and record a recommendation against the latest screening run; the registrar records the final verdict only after that recommendation. A changed screening run requires a fresh recommendation.
- **Applicants** see a final decision's outcome and date, never faculty recommendations or reasoning.
- **Document verification and result confirmation** are faculty-administrator only. Bulk results import and role assignment are registrar only. Neither role can edit an applicant's data except the registrar's explicit staff-entry procedures.

Faculty scoping is enforced in the server. MySQL has no row-level security, so there is no second layer in the database. Moving to PostgreSQL would allow one.

## Rule-set lifecycle

1. **Seed:** the registrar creates version `2026-27.1` for every screenable programme from the data files. UMU-published general rules are recorded as approved; adopted rules as pending.
2. **Propose:** a registrar saves a new version (never an edit). Content is validated against the engine's rule types. A proposal can claim to be `assumed` or `adopted-proxy`, never `official`.
3. **Activate:** the version enters use from its start date. Activating is not approval.
4. **Approve or reject:** the registrar records UMU's decision with who and a reference. Only an approved version can support an admit.
5. **Retire:** sets an end date. History is kept.

Screening uses, per programme, the latest effective activated version that has not been rejected, and falls back to the data files if none exists. Each run records the version used.

## Admit decisions

An admit is allowed only when all of these hold: the latest screening for the programme is eligible (or overridden with a reason), the rule set that screening used has a recorded UMU approval **now**, the programme mapping is settled, an official UNEB slip is verified and every active result row is confirmed, and the applicant actually applied to the programme. Decline, defer and request-information do not need an approved rule set.

## Latest run

"Latest screening run" is ordered by creation time and then by id, because two runs can share the same second.
