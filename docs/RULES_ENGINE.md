# Rules Engine Specification

Derived from Section 5 of the concept note. The rules engine is the core of ASPIRE and its decisions cannot be overridden by ML.

## 1. Outcomes

| Academic requirements met | All required documents submitted | Outcome |
| --- | --- | --- |
| No | Any | Not eligible |
| Yes | Yes | Eligible, forwarded to staff review for a faculty recommendation and registrar verdict |
| Yes | No | On hold, missing documents listed |

## 2. Evaluation order

1. **Academic stage:** run every academic check for the program. If any fail, the outcome is `NOT_ELIGIBLE` and the document stage is skipped.
2. **Document stage:** compare submitted documents with the program's required list. None missing gives `ELIGIBLE`, otherwise `ON_HOLD` with the missing list.

## 3. Interface (proposed)

```ts
type Outcome = "ELIGIBLE" | "NOT_ELIGIBLE" | "ON_HOLD";

interface Check {
  ruleId: string;
  passed: boolean;
  expected: string;
  actual: string;
  gap?: number;          // used for near-miss detection
}

interface ScreeningResult {
  programId: string;
  ruleSetVersion: string;
  outcome: Outcome;
  checks: Check[];
  missingDocuments: string[];
}

function screen(applicant: Applicant, ruleSet: RuleSet): ScreeningResult;
```

## 4. Rules as data

Program requirements, subject combinations and weights live in the database so the registrar can update them without code changes. Each rule set has a version and an effective-from date, so rules can differ between intakes and past decisions stay reproducible.

Example shape (**placeholder values; replace with the university's published requirements**):

```json
{
  "programId": "EXAMPLE-PROGRAM",
  "version": "example-intake",
  "effectiveFrom": "YYYY-MM-DD",
  "academic": [
    { "id": "min_principals", "type": "MIN_PRINCIPAL_PASSES", "count": 2 },
    { "id": "core_subjects", "type": "REQUIRED_SUBJECTS_ANY_OF",
      "subjects": ["SUBJECT_A", "SUBJECT_B"], "minGrade": "E", "minCount": 1 },
    { "id": "min_weight", "type": "MIN_WEIGHTED_POINTS", "points": 0 }
  ],
  "documents": ["UACE_SLIP", "UCE_SLIP", "NATIONAL_ID"]
}
```

## 5. Core compiled rule types

| Type | Meaning |
| --- | --- |
| `MIN_PRINCIPAL_PASSES` | At least N principal passes, optionally from one sitting |
| `MIN_SUBSIDIARY_PASSES` | At least N subsidiary passes |
| `MIN_UCE_PASSES` | At least N UCE passes, optionally from one sitting |
| `HAS_UCE_RESULTS` | UCE results exist (compiled from `UCE_OR_EQUIVALENT`) |
| `QUALIFICATION_CLASS_AT_LEAST` | Diploma, certificate or HEAC class threshold |
| `SUBJECTS_RELEVANT_TO_PROGRAMME` | Passes must be in subjects relevant to the programme |
| `MATHS_CREDIT_REQUIREMENT` | Credit in Sub-Maths (A-level) or Mathematics (O-level) |
| `OLEVEL_OVERALL_GRADE_NOT_IN` | Excludes overall O-level grades such as 7, 9, X, Y, Z |

The set of compiled rule types is fixed in code. Adding one needs a small code change, which keeps every rule testable and explainable.

## 6. Explanations

Every check records `expected`, `actual` and `gap`. These feed:

- staff-facing check explanations in the case view,
- near-miss detection in the programme matcher,
- the audit log.

Applicants see a short screening status and the final verdict outcome/date, not internal check traces.

## 7. Hold handling

On hold applicants are re-screened automatically when documents arrive, with a deadline and notifications to the applicant. Because the engine is pure, re-screening is just calling `screen()` again with updated data.

## 8. Invariants to test

- Failing academics never yields `ON_HOLD`.
- Same input and rule set always yield the same result.
- Adding a required document never worsens an outcome.
- Every `NOT_ELIGIBLE` result contains at least one failed check.
- Every `ON_HOLD` result has a non-empty `missingDocuments`.

## 9. Points to confirm with the admissions office

- Precedence of academic failure over missing documents (assumed as above).
- Eligibility is per program (assumed). Is an overall applicant-level outcome also needed?
- Hold deadline length and notification channel.
- Which subject combinations, weights and diploma/certificate routes apply, and how they differ per program.

## 10. Entry routes (supersedes the single `academic` list in section 4)

UMU's brochure shows more than one way to qualify. A bachelors applicant can qualify through UACE, a diploma, or the Higher Education Access Programme. A rule set therefore holds routes:

```json
{
  "programId": "BSC-CS",
  "routes": [
    { "id": "UACE_DIRECT", "rules": [ ... ] },
    { "id": "DIPLOMA", "rules": [ ... ] }
  ]
}
```

An applicant passes the academic stage if **any** route passes. The trace records every route tried and why each passed or failed, so the dashboard can show the nearest route to qualifying.

## 11. Weighted points (adopted system)

See [RULE_SOURCES.md](RULE_SOURCES.md) for the source and status. The engine computes:

1. Choose the programme's essential subjects: the best-performed subjects from each essential list, principal passes only, at most two.
2. Choose the relevant subject(s) from the remaining subjects.
3. Add desirable subsidiary points (one point for each Distinction or Credit in General Paper, Subsidiary Mathematics or Subsidiary ICT). Numeric `1`–`6`, legacy `D1`–`C6`, `O` and pass labels score one point; numeric `7`–`9`, legacy `P7`/`P8`/`F9` and `F` score zero but are valid explicit grades.
4. Combined weight = O-level weight + sum of (grade points x category weight).

O-level weights are tenths: `D1`/`D2` and numeric `1`/`2` = `3`; `C3`–`C6` and numeric `3`–`6` = `2`; `P7`/`P8` and numeric `7`/`8` = `1`; `F9` and numeric `9` = `0`.

Sub-degree weighting is also advisory. Diploma and HEAC UACE routes cap selection at one essential and two relevant subjects, with essential restricted to Principal grades `A`–`E` and relevant allowing Principal or subsidiary-level `O`. Certificate-holder routes use qualification standing instead: Distinction/First Class = `18`, Credit/Second Class Upper = `15`, Second Class Lower = `12`, Pass = `9`. Certificate rules with `entry_basis: "UCE"` score selected UCE subjects directly (`D1`=`6` down to `F9`=`0`, `P7`/`P8`=`0.5`) plus the O-level weight; they do not multiply UCE points by A-level category weights. `ALL`, `REMAINING`, `ALL_ARTS_SUBJECTS` and `Language subjects` are resolved by shared subject normalization; `ANY_OR_BOTH` still takes up to two named subjects, or one when only one is held.

The result is a score with a breakdown, stored in the trace. It feeds ranking. `minimum_weighted_points` is `null` until UMU sets a threshold, and when it is `null` no applicant fails on score alone.

## 12. Additional source-file rule labels

| Label | Meaning in v1 |
| --- | --- |
| `SAME_SITTING` | Folded into the relevant pass rules |
| `UCE_OR_EQUIVALENT` | Compiled to `HAS_UCE_RESULTS` |
| `DIPLOMA_CLASS_AT_LEAST`, `CERTIFICATE_CLASS_AT_LEAST`, `HEAC_GRADE_AT_LEAST` | Compiled to `QUALIFICATION_CLASS_AT_LEAST` |
| `MIN_WORK_EXPERIENCE_YEARS`, `HAS_MASTERS`, `PASS_GAT`, `DEGREE_CLASS_AT_LEAST`, `PROFESSIONAL_QUALIFICATION` | Present in source data but outside v1 screening |
| `WEIGHTED_SCORE` | Advisory combined weight used for ranking, not an eligibility threshold |

## 13. Rule set status

Every rule set carries `status` (`official`, `adopted-proxy` or `assumed`), `source`, `edition` and `approval`. The engine copies these into every `ScreeningResult`, so a result produced from adopted rules is always identifiable as one.

## 14. Implementation status (v1)

Implemented in `server/rules-engine` (TypeScript). There is no package README in this repository; use this document and the current tests under `server/services` as the reference.

Differences from the earlier sections of this document:

- **Three check statuses.** Each check is `PASS`, `FAIL` or `REVIEW`. `REVIEW` means the engine cannot decide (for example subject relevance for diploma entry, or no data to test a Maths credit).
- **Refined invariant.** Section 8 says failing academics never yields `ON_HOLD`. In the implementation this applies to a *definite* failure. An undecidable check yields `ON_HOLD` with hold reason `MANUAL_REVIEW`, so the engine never auto-approves or auto-rejects on something it cannot decide.
- **Hold reasons.** `ON_HOLD` carries `MISSING_DOCUMENTS`, `MANUAL_REVIEW`, or both.
- **Score timing.** The weighted score is advisory and is computed whenever the rule set has weighting; UCE and qualification-standing routes score without UACE results.
- **"One or two better done".** Resolved by selector caps and category limits; diploma/HEAC UACE routes cap at one essential and two relevant subjects.
- **Option.** `requireUceForDegrees` toggles the 5-UCE-pass rule for degrees while the decision is open.
