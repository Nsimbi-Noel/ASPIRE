# Rule Sources and Adoption

How ASPIRE gets its admission rules, where each rule came from, and what still needs UMU's approval.

## Decision

ASPIRE adopts the public-universities weighting system, as published for Makerere University, for UMU programmes that are similar to programmes in that system. UMU's own brochure supplies the general entry rules by level and the programme catalogue.

The adoption is a project decision. Until UMU's admissions office approves it, every adopted rule is labelled `adopted-proxy` and must be shown as such wherever it affects a result.

## Sources

| Layer | Source | Status |
| --- | --- | --- |
| General entry by level (bachelors, diploma, certificate, higher education certificate, masters, PhD) | UMU Courses 2026-2027 brochure, p.12 | official |
| Programme catalogue (programme, faculty, campus, study mode, duration; fees still to be imported) | UMU Courses 2026-2027 brochure, pp.7-12 (campus programme tables pp.8-12) | official source; v1 is scoped to Main Campus, Nkozi, and campus/mode/duration assignment is pending UMU confirmation |
| Subject weighting, special O-level and Sub-Maths conditions | Ministry of Education and Sports, *Information on Public Universities Admissions for 2026/2027* (Notes to Schools). Makerere's tables, with a few gaps filled from Mbarara, Gulu and Kyambogo | adopted-proxy |

Document link: https://news.mak.ac.ug/wp-content/uploads/2025/10/Notes-to-Schools-2026-2027-Academic-Year.pdf (retrieved 22 October 2026).

The document states that its weighting system applies to all ten public universities, so the adopted rules are a national public-university standard rather than a single institution's habit.

## Files

| File | Contents |
| --- | --- |
| `data/rules/entry-requirements.umu-2026-27.json` | UMU general entry rules, expressed as routes |
| `data/rules/weighting-system.public-universities-2026-27.json` | Category weights, grade points, O-level weights, selection rules |
| `data/rules/programme-weights.2026-27.json` | Programme rule entries (essential, relevant, desirable subjects, special requirements) |
| `data/rules/programme-mapping.umu.json` | Active UMU Nkozi programme mappings to rule entries, plus the postgraduate umbrella with no supported screening mapping |
| `data/catalogue/programme-faculties.umu-2026-27.json` | Faculty of each mapped Nkozi programme |
| `data/catalogue/programme-offerings.umu-2026-27.json` | Nkozi campus lookup, study modes, and each mapped programme's offering rows (`campusId`, `modes`, `duration`); the postgraduate umbrella has no selectable offering |

## How the system works

- Each A-level subject is placed in a category for the programme: **Essential** (weight 3), **Relevant** (weight 2) or **Desirable** (weight 1).
- A-level grade points: A=6, B=5, C=4, D=3, E=2, O=1, F=0. O-level: Distinction 0.3, Credit 0.2, Pass 0.1, Fail 0.
- A candidate's combined weight is the O-level weight plus the sum of (grade points x category weight) over the weighted subjects.
- Essential subjects must be principal passes. At most two are Essential, and at most three principal subjects are weighted.

## What ASPIRE does with it

The weighting system was designed to rank competing applicants for limited government places, so on its own it does not say who is eligible. ASPIRE therefore uses it in two ways:

1. **Eligibility (hard rules):** UMU's general entry rules, plus any programme-specific conditions in the source (for example a Credit in Mathematics at O-level for Accounting and Finance).
2. **Ranking and fit (advisory):** the combined weight feeds the programme matcher and can order applicants for staff review. There is no minimum weighted score and no cut-off: UMU is a private university and publishes none, so no applicant fails on score. The parameter stays in the schema, set to `null`, in case UMU ever introduces one.

## Not imported

Government sponsorship quotas, district quota, the 1.5 points scheme for female candidates, STEM gender ratios, year-of-A-level windows, yearly cut-off points, subject-combination allocation, and Makerere pre-entry exams. These belong to the government placement process, not to UMU's admissions.

## Known differences from UMU's brochure

- The brochure states no UCE requirement for bachelors. The public-university rules require 5 UCE passes. Adopting this is a policy change for UMU.
- The brochure lists no weights, cut-offs or programme-specific subjects.
- The source excludes applicants with an overall O-level grade of 7, 9, Y or Z. UMU states no such rule.

## Editions and drift

Rules change between editions. Makerere's Computer Science weighting differs between 2019/20 (Mathematics and Physics essential) and 2026/27 (Mathematics plus one better-done subject), and Makerere's own programme page still shows another list. Every rule entry records its source and edition, and any rule set used for a real intake must name the edition it came from. Kyambogo entries come from the older 2025/26 edition.

## Mapping quality

Counts below cover the 36 selectable Nkozi programmes (27 bachelor's):

| Match | Meaning | Count |
| --- | --- | --- |
| exact | same or near-identical programme | 16 |
| close | same discipline, different name or scope | 17 |
| partial | overlapping discipline; a starting guess | 3 |

These are primary-rule counts. Counting all rule references, including alternates, gives 16 exact, 19 close and 5 partial. UMU must confirm each mapping. One group (`umu-postgraduates`, covering Masters, postgraduate diplomas and PhDs) has no supported screening mapping and is not selectable; diplomas and certificates now have dedicated rule IDs.

## Verification still needed

- [ ] Check the two eligibility-affecting entries `must-15` and `mak-91` against the PDF, then review the remaining `medium`-confidence entries (including Statistics and the sub-degree rules).
- [ ] Clarify how "one or two better done" is weighted (Business Administration, Accounting).
- [ ] Confirm each programme mapping with UMU and confirm the imported campus/study-mode/duration offerings (assigned by project from the brochure, pending UMU confirmation).
- [ ] Obtain UMU's approval to use the adopted rules, or its own rules.
- [ ] Re-check the source when the 2027/28 edition is published.
