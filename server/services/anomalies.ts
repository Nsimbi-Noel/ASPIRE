export interface ApplicantResultRow {
  exam: string;
  subject: string;
  grade: string;
  sitting: string;
}

export type ApplicantAnomalyCode =
  | "duplicate_result_row"
  | "conflicting_result_grades"
  | "multiple_applications_same_intake";
export type ApplicantAnomalySeverity = "warning" | "review";

export interface ApplicantAnomaly {
  code: ApplicantAnomalyCode;
  severity: ApplicantAnomalySeverity;
  message: string;
  affectedSourceFields: string[];
}

/**
 * Find data-quality signals in one applicant's current result rows and intake count.
 * This is advisory only: it does not determine or alter applicant eligibility.
 */
export function detectApplicantAnomalies(
  results: readonly ApplicantResultRow[],
  sameIntakeApplicationCount: number,
): ApplicantAnomaly[] {
  const groups = new Map<string, ApplicantResultRow[]>();
  for (const row of results) {
    // JSON tuple encoding avoids delimiter collisions in source values.
    const key = JSON.stringify([row.exam, row.subject, row.sitting]);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const anomalies: ApplicantAnomaly[] = [];
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    anomalies.push({
      code: "duplicate_result_row",
      severity: "warning",
      message: `The same exam, subject, and sitting appear ${rows.length} times.`,
      affectedSourceFields: ["exam", "subject", "sitting"],
    });
    if (new Set(rows.map((row) => row.grade)).size > 1) {
      anomalies.push({
        code: "conflicting_result_grades",
        severity: "review",
        message: "Repeated exam, subject, and sitting rows have conflicting grades.",
        affectedSourceFields: ["exam", "subject", "sitting", "grade"],
      });
    }
  }

  if (sameIntakeApplicationCount > 1) {
    anomalies.push({
      code: "multiple_applications_same_intake",
      severity: "review",
      message: `There are ${sameIntakeApplicationCount} applications for this applicant and intake.`,
      affectedSourceFields: ["applicantId", "intakeId"],
    });
  }

  return anomalies;
}
