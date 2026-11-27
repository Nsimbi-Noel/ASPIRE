export const SESSION_COOKIE = "aspire_session";
/** Kept for older imports. */
export const COOKIE_NAME = SESSION_COOKIE;
export const UNAUTHED_ERR_MSG = "Please sign in (10001)";
export const NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";

export const SUPPORTED_INTAKES = ["2026/27"] as const;
export type SupportedIntake = (typeof SUPPORTED_INTAKES)[number];
export const LAUNCH_INTAKE: SupportedIntake = SUPPORTED_INTAKES[0];

export function isSupportedIntake(value: string): value is SupportedIntake {
  return (SUPPORTED_INTAKES as readonly string[]).includes(value);
}

export const EXAM_TYPES = ["UACE", "UCE"] as const;
export type ExamType = (typeof EXAM_TYPES)[number];

export const UACE_LEVELS = ["PRINCIPAL", "SUBSIDIARY"] as const;
export type UaceLevel = (typeof UACE_LEVELS)[number];

export const UACE_PRINCIPAL_SUBJECTS = [
  "Accounts", "Agriculture", "Arabic", "Art and Design", "Biology", "Chemistry", "Chinese", "CRE",
  "Economics", "Entrepreneurship", "Fine Art", "French", "Geography", "Geom. & Building Drawing",
  "Geom. & Mech. Drawing", "German", "History", "IRE", "Kiswahili", "Literature in English", "Luganda",
  "Mathematics", "Music", "Physics", "Runyakitara",
] as const;

export const UACE_SUBSIDIARY_SUBJECTS = ["General Paper", "Subsidiary Mathematics", "Subsidiary ICT"] as const;

export const UCE_SUBJECTS = [
  "English", "English Language", "Mathematics", "Physics", "Chemistry", "Biology", "Geography", "History",
  "CRE", "IRE", "Kiswahili", "Literature in English", "Agriculture", "Computer Studies", "Entrepreneurship",
  "Art and Design", "Music", "French", "German", "Arabic", "Chinese", "Luganda", "Runyakitara",
] as const;

export const UACE_PRINCIPAL_GRADES = ["A", "B", "C", "D", "E", "O", "F"] as const;
export const UACE_SUBSIDIARY_GRADE_OPTIONS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "O", "F"] as const;
export const LEGACY_OLEVEL_GRADES = ["D1", "D2", "C3", "C4", "C5", "C6", "P7", "P8", "F9"] as const;
export const NUMERIC_OLEVEL_GRADES = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
export const UCE_GRADE_OPTIONS = [...LEGACY_OLEVEL_GRADES, ...NUMERIC_OLEVEL_GRADES] as const;
export const UACE_SUBSIDIARY_GRADES = [...UACE_SUBSIDIARY_GRADE_OPTIONS, ...LEGACY_OLEVEL_GRADES] as const;

const SUBJECT_ALIASES: Record<string, string> = {
  "general paper": "General Paper",
  gp: "General Paper",
  "subsidiary mathematics": "Subsidiary Mathematics",
  "subsidiary maths": "Subsidiary Mathematics",
  "mathematics (subsidiary)": "Subsidiary Mathematics",
  "sub-maths": "Subsidiary Mathematics",
  "sub maths": "Subsidiary Mathematics",
  "subsidiary ict": "Subsidiary ICT",
  "sub-ict": "Subsidiary ICT",
  "computer studies": "Subsidiary ICT",
  ict: "Subsidiary ICT",
  maths: "Mathematics",
  math: "Mathematics",
};

const subsidiaryGradeAliases: Record<string, string> = {
  D1: "1", D2: "2", C3: "3", C4: "4", C5: "5", C6: "6", P7: "7", P8: "8", F9: "9",
};

const normalizeKey = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

export function subjectOptionsFor(exam: ExamType, subjectLevel?: UaceLevel): readonly string[] {
  if (exam === "UCE") return UCE_SUBJECTS;
  return subjectLevel === "SUBSIDIARY" ? UACE_SUBSIDIARY_SUBJECTS : UACE_PRINCIPAL_SUBJECTS;
}

export function gradeOptionsFor(exam: ExamType, subjectLevel?: UaceLevel): readonly string[] {
  if (exam === "UCE") return UCE_GRADE_OPTIONS;
  return subjectLevel === "SUBSIDIARY" ? UACE_SUBSIDIARY_GRADE_OPTIONS : UACE_PRINCIPAL_GRADES;
}

/** Maps legacy O-level labels to the numeric labels printed on UACE subsidiary slips. */
export function normalizeResultGrade(exam: ExamType, subjectLevel: UaceLevel | undefined, grade: string): string {
  const value = grade.trim().toUpperCase();
  return exam === "UACE" && subjectLevel === "SUBSIDIARY" ? subsidiaryGradeAliases[value] ?? value : value;
}

export function normalizeResultSubject(exam: ExamType, subjectLevel: UaceLevel | undefined, subject: string): string {
  const value = subject.trim().replace(/\s+/g, " ");
  const canonical = SUBJECT_ALIASES[normalizeKey(value)] ?? value;
  return subjectOptionsFor(exam, subjectLevel).find((option) => normalizeKey(option) === normalizeKey(canonical)) ?? canonical;
}

export function isAllowedResultGrade(exam: ExamType, subjectLevel: UaceLevel | undefined, grade: string): boolean {
  const normalized = normalizeResultGrade(exam, subjectLevel, grade);
  return (gradeOptionsFor(exam, subjectLevel) as readonly string[]).includes(normalized) ||
    (exam === "UACE" && subjectLevel === "SUBSIDIARY" && (UACE_SUBSIDIARY_GRADES as readonly string[]).includes(normalized));
}

export function isAllowedResultSubject(exam: ExamType, subjectLevel: UaceLevel | undefined, subject: string): boolean {
  const normalized = normalizeResultSubject(exam, subjectLevel, subject);
  return (subjectOptionsFor(exam, subjectLevel) as readonly string[]).includes(normalized);
}
