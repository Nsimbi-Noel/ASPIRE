import { describe, expect, it } from "vitest";
import { detectApplicantAnomalies } from "./anomalies";

const row = { exam: "UCE", subject: "Mathematics", grade: "1", sitting: "2023" };

describe("detectApplicantAnomalies", () => {
  it("flags exact repeated rows even when their grades match", () => {
    const results = [row, { ...row }];
    expect(detectApplicantAnomalies(results, 1)).toEqual([
      {
        code: "duplicate_result_row",
        severity: "warning",
        message: "The same exam, subject, and sitting appear 2 times.",
        affectedSourceFields: ["exam", "subject", "sitting"],
      },
    ]);
    expect(results).toEqual([row, { ...row }]);
  });

  it("flags repeated keys with conflicting grades", () => {
    expect(detectApplicantAnomalies([row, { ...row, grade: "2" }], 1)).toEqual([
      {
        code: "duplicate_result_row",
        severity: "warning",
        message: "The same exam, subject, and sitting appear 2 times.",
        affectedSourceFields: ["exam", "subject", "sitting"],
      },
      {
        code: "conflicting_result_grades",
        severity: "review",
        message: "Repeated exam, subject, and sitting rows have conflicting grades.",
        affectedSourceFields: ["exam", "subject", "sitting", "grade"],
      },
    ]);
  });

  it("flags more than one application for the applicant and intake", () => {
    expect(detectApplicantAnomalies([row], 2)).toEqual([
      {
        code: "multiple_applications_same_intake",
        severity: "review",
        message: "There are 2 applications for this applicant and intake.",
        affectedSourceFields: ["applicantId", "intakeId"],
      },
    ]);
  });

  it("returns no flags for clean rows and a single application", () => {
    expect(detectApplicantAnomalies([row, { ...row, subject: "English" }], 1)).toEqual([]);
  });
});
