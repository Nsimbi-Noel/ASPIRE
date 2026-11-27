# Data Model

Defined in `drizzle/schema.ts` (MySQL, Drizzle). Migrations are in `drizzle/`.

| Table | Purpose | Notes |
| --- | --- | --- |
| `users` | Email-and-password accounts | `passwordHash` (scrypt), `mustChangePassword`, `failedLoginCount`, `lockedUntil`, `sessionVersion`, `isActive`; `aspireRole` (applicant, registrar, faculty_administrator) and `facultyId` for faculty administrators |
| `faculties` | The 11 faculties, schools and directorates in the brochure | Reference data, created by migration |
| `applications` | One application per applicant per intake | `requestedProgrammeId` is the first choice, kept in step with `applicationProgrammes` |
| `applicationProgrammes` | The programmes an application is for | What links an application to a faculty. `facultyId`, `campusId` and `studyModeId` are copied from the catalogue when the choice is made, with `choiceRank` and `status` (submitted or withdrawn); duration is resolved from catalogue offerings for display |
| `examResults` | UCE and UACE subject grades | `source`: applicant_entered, staff_entered, document_extracted. Superseded rows are kept inactive |
| `applicantQualifications` | Diploma, certificate and access programme entries | |
| `applicantDocuments` | Uploaded files | Extraction is advisory; a person confirms |
| `ruleSets` | Versioned rules with provenance and approval | `status`, `source`, `edition`, `effectiveFrom/To`, `approvalStatus`, `approvedBy`, `approvalReference`, `approvedAt`, `activatedAt`, `rules` (compiled JSON). Unique per programme and version |
| `screeningRuns` | One screening of one application for one programme | `inputSnapshot`, `resultTrace`, `ruleSetRecordId`, `facultyId`. Never edited |
| `facultyRecommendations` | The faculty's say before the final verdict | `recommendation`, `reason`, `facultyId`, `screeningRunId`, `ruleSetRecordId`, `recommendedBy`. A changed screening run needs a fresh recommendation |
| `committeeDecisions` | Registrar's final verdicts and overrides | `facultyId`, `ruleSetRecordId`, `facultyRecommendationId` recorded in the audit with the decision. Only the registrar writes these rows |
| `appeals` | Applicant review requests | |
| `advisoryOutputs` | Advisory flags | No predictions are produced |
| `notifications` | In-app notices | Real delivery (email or SMS) is not built |
| `auditEvents` | Append-only action log | Written for every change; appended by the application only |

## Differences from the earlier PostgreSQL design

The PostgreSQL schema in the original repository separated applicants from applications, had a programmes table, and enforced visibility with row-level security. This application:

- merges applicant and application into `applications`,
- keeps the programme catalogue in data files rather than a table (programmes are referenced by id; `facultyId` comes from `programme-faculties.umu-2026-27.json`, and `campusIds`, `studyModes` and per-campus offerings with duration come from `programme-offerings.umu-2026-27.json`),
- enforces visibility in the server (see [ARCHITECTURE.md](ARCHITECTURE.md)),
- relies on application code and tests, not triggers, to keep rule content and history unedited: there is no endpoint that edits a rule version's content, a screening run or an audit event.

## Legacy data

Rows written before migration `0003` have no `facultyId` on screening runs and decisions. They are visible only to the registrar.
