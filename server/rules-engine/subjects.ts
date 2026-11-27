import type { SubjectList } from "./types";

const ALIASES: Record<string, string> = {
  maths: "mathematics",
  math: "mathematics",
  "subsidiary mathematics": "sub-maths",
  "sub maths": "sub-maths",
  "sub-math": "sub-maths",
  "subsidiary ict": "computer studies",
  "sub-ict": "computer studies",
  ict: "computer studies",
  gp: "general paper",
};

export const ARTS_SUBJECTS = [
  "art and design",
  "fine art",
  "literature in english",
  "history",
  "cre",
  "ire",
  "kiswahili",
  "luganda",
  "runyakitara",
  "french",
  "german",
  "arabic",
  "chinese",
  "music",
] as const;

export const LANGUAGE_SUBJECTS = [
  "english",
  "english language",
  "literature in english",
  "kiswahili",
  "luganda",
  "runyakitara",
  "french",
  "german",
  "arabic",
  "chinese",
] as const;

export function normSubject(subject: string): string {
  const key = subject.trim().toLowerCase();
  return ALIASES[key] ?? key;
}

export function expandSubjectList(from: SubjectList): readonly string[] | null {
  if (Array.isArray(from)) return from.map(normSubject);
  if (from === "ALL_ARTS_SUBJECTS") return ARTS_SUBJECTS;
  if (from === "Language subjects") return LANGUAGE_SUBJECTS;
  return null;
}
