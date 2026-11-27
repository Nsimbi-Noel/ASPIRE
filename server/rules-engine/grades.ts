import { normalizeResultGrade } from "@shared/const";
import type { Applicant, Classification, UaceResult } from "./types";

export const PRINCIPAL_PASS = new Set(["A", "B", "C", "D", "E"]);
/**
 * O-level weights in tenths, to keep arithmetic exact. Numeric UNEB grades mirror
 * legacy D1–F9 labels.
 */
export const O_WEIGHT_TENTHS: Record<string, number> = {
  D1: 3, D2: 3, C3: 2, C4: 2, C5: 2, C6: 2, P7: 1, P8: 1, F9: 0,
  "1": 3, "2": 3, "3": 2, "4": 2, "5": 2, "6": 2, "7": 1, "8": 1, "9": 0,
};
/** A pass is any O-level grade with a positive weight. */
export const O_PASS = new Set(Object.entries(O_WEIGHT_TENTHS).filter(([, weight]) => weight > 0).map(([grade]) => grade));
/** Distinction or Credit for O-level requirements. */
export const CREDIT_OR_BETTER = new Set(Object.entries(O_WEIGHT_TENTHS).filter(([, weight]) => weight >= 2).map(([grade]) => grade));

/**
 * UACE subsidiary points. Numeric 1–9 mirror D1–F9; O and pass labels are pass
 * equivalents. Grades 7–9 and F score zero but remain explicit, never NaN.
 */
export const SUBSIDIARY_GRADE_POINTS: Record<string, number> = {
  D1: 1, D2: 1, C3: 1, C4: 1, C5: 1, C6: 1,
  "1": 1, "2": 1, "3": 1, "4": 1, "5": 1, "6": 1,
  O: 1, PASS: 1, "SUBSIDIARY PASS": 1, "SUB PASS": 1, P: 1,
  P7: 0, P8: 0, F9: 0, "7": 0, "8": 0, "9": 0, F: 0, FAIL: 0,
};

export function oLevelWeightTenths(grade: string): number {
  return O_WEIGHT_TENTHS[grade.trim().toUpperCase()] ?? 0;
}

function subsidiaryGradeKey(grade: string): string {
  const normalized = grade.trim().replace(/\s+/g, " ").toUpperCase();
  return normalizeResultGrade("UACE", "SUBSIDIARY", normalized);
}

export function subsidiaryPoints(grade: string): number {
  return SUBSIDIARY_GRADE_POINTS[subsidiaryGradeKey(grade)] ?? 0;
}

export function isSubsidiaryGrade(grade: string): boolean {
  return subsidiaryGradeKey(grade) in SUBSIDIARY_GRADE_POINTS;
}

export { normSubject } from "./subjects";

export function principalPasses(a: Applicant): UaceResult[] {
  return a.uace.filter((r) => r.level === "PRINCIPAL" && PRINCIPAL_PASS.has(r.grade));
}

export function subsidiaryPassCount(a: Applicant): number {
  const subsidiary = a.uace.filter((r) => r.level === "SUBSIDIARY" && subsidiaryPoints(r.grade) > 0).length;
  const principalAtO = a.uace.filter((r) => r.level === "PRINCIPAL" && r.grade === "O").length;
  return subsidiary + principalAtO;
}

/** The largest number of items from any single sitting. */
export function bestSittingCount<T extends { sitting: string }>(items: T[]): { count: number; sitting?: string } {
  const bySitting = new Map<string, number>();
  for (const i of items) bySitting.set(i.sitting, (bySitting.get(i.sitting) ?? 0) + 1);
  let best = { count: 0 } as { count: number; sitting?: string };
  for (const [sitting, count] of [...bySitting.entries()].sort()) {
    if (count > best.count) best = { count, sitting };
  }
  return best;
}

export const CREDIT_CLASSES: Classification[] = ["DISTINCTION", "CREDIT", "FIRST_CLASS", "SECOND_CLASS"];
export const HEAC_CLASSES: Classification[] = ["DISTINCTION", "CREDIT"];
