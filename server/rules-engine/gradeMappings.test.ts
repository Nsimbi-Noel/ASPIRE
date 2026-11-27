import { gradeOptionsFor, isAllowedResultGrade, normalizeResultGrade, normalizeResultSubject, subjectOptionsFor } from "@shared/const";
import { describe, expect, it } from "vitest";
import { isSubsidiaryGrade, oLevelWeightTenths, subsidiaryPassCount, subsidiaryPoints } from "./grades";
import type { Applicant, Weighting } from "./types";
import { computeWeightedScore } from "./weighting";

const weighting: Weighting = {
  ruleId: "test",
  system: {
    category_weights: { essential: 2, relevant: 1, desirable: 1 },
    alevel_points: { A: 6, B: 5, C: 4, D: 3, O: 1, F: 0 },
  },
  variants: [{
    id: "SCIENCE",
    essential: [{ type: "REQUIRED", subjects: ["Mathematics"] }],
    relevant: [],
    desirable: ["General Paper", "Subsidiary Mathematics"],
  }],
};

function applicantWith(grades: string[]): Applicant {
  return {
    id: "APP-1",
    uce: [{ subject: "English", grade: "C4", sitting: "2025" }],
    uace: [
      { subject: "Mathematics", level: "PRINCIPAL", grade: "A", sitting: "2025" },
      { subject: "General Paper", level: "SUBSIDIARY", grade: grades[0]!, sitting: "2025" },
      { subject: "Subsidiary Mathematics", level: "SUBSIDIARY", grade: grades[1]!, sitting: "2025" },
    ],
    qualifications: [],
    documents: [],
  };
}

describe("result option helpers", () => {
  it("keeps subjects and grades context-aware", () => {
    expect(subjectOptionsFor("UACE", "SUBSIDIARY")).toContain("General Paper");
    expect(subjectOptionsFor("UACE", "SUBSIDIARY")).not.toContain("Mathematics");
    expect(gradeOptionsFor("UACE", "SUBSIDIARY")).toEqual(expect.arrayContaining(["1", "7", "9", "O", "F"]));
    expect(gradeOptionsFor("UACE", "PRINCIPAL")).toContain("A");
    expect(normalizeResultSubject("UCE", undefined, "maths")).toBe("Mathematics");
    expect(normalizeResultGrade("UACE", "SUBSIDIARY", "D1")).toBe("1");
    expect(isAllowedResultGrade("UCE", undefined, "A")).toBe(false);
    expect(isAllowedResultGrade("UACE", "SUBSIDIARY", "O")).toBe(true);
  });
});

describe("result grade mappings", () => {
  it("maps numeric and legacy O-level grades to tenths", () => {
    expect(oLevelWeightTenths("D1")).toBe(3);
    expect(oLevelWeightTenths("2")).toBe(3);
    expect(oLevelWeightTenths("C4")).toBe(2);
    expect(oLevelWeightTenths("5")).toBe(2);
    expect(oLevelWeightTenths("P7")).toBe(1);
    expect(oLevelWeightTenths("8")).toBe(1);
    expect(oLevelWeightTenths("F9")).toBe(0);
    expect(oLevelWeightTenths("9")).toBe(0);
  });

  it("maps UACE subsidiary grades to explicit points", () => {
    expect(subsidiaryPoints("D1")).toBe(1);
    expect(subsidiaryPoints("6")).toBe(1);
    expect(subsidiaryPoints("O")).toBe(1);
    expect(subsidiaryPoints("PASS")).toBe(1);
    expect(subsidiaryPoints("P7")).toBe(0);
    expect(subsidiaryPoints("7")).toBe(0);
    expect(subsidiaryPoints("F")).toBe(0);
    expect(subsidiaryPoints("not-a-grade")).toBe(0);
  });

  it("recognizes numeric and pass-label subsidiary grades without treating unknown grades as passes", () => {
    expect(isSubsidiaryGrade("1")).toBe(true);
    expect(isSubsidiaryGrade("9")).toBe(true);
    expect(isSubsidiaryGrade("O")).toBe(true);
    expect(isSubsidiaryGrade("SUBSIDIARY PASS")).toBe(true);
    expect(isSubsidiaryGrade("ZZ")).toBe(false);
    expect(subsidiaryPassCount(applicantWith(["1", "7"]))).toBe(1);
    expect(subsidiaryPassCount(applicantWith(["7", "9"]))).toBe(0);
  });
});

describe("computeWeightedScore subsidiary scoring", () => {
  it("counts numeric 1 and O as desirable points", () => {
    const score = computeWeightedScore(applicantWith(["O", "1"]), weighting);
    expect(score.alevel).toBe(12);
    expect(score.desirable).toBe(2);
    expect(score.olevel).toBe(0.2);
    expect(score.total).toBe(14.2);
  });

  it("counts numeric 7 as a valid zero-point grade", () => {
    const score = computeWeightedScore(applicantWith(["O", "7"]), weighting);
    expect(score.desirable).toBe(1);
    expect(score.total).toBe(13.2);
    expect(score.lines.find((line) => line.grade === "7")).toMatchObject({ points: 0, contribution: 0 });
  });
});
