import type {
  Applicant, Classification, EntryBasis, Level, ScoreLine, Selector, SubjectList,
  UaceResult, WeightedScore, Weighting, WeightVariant,
} from "./types";
import { PRINCIPAL_PASS, isSubsidiaryGrade, oLevelWeightTenths, subsidiaryPoints } from "./grades";
import { expandSubjectList, normSubject } from "./subjects";

interface Candidate<T extends { subject: string; grade: string }> { r: T; points: number }
type ScoreOptions = { routeId?: string; level?: Level };

const UCE_LEGACY_BY_NUMERIC: Record<string, string> = {
  "1": "D1", "2": "D2", "3": "C3", "4": "C4", "5": "C5", "6": "C6", "7": "P7", "8": "P8", "9": "F9",
};

const STANDING_KEY: Record<Classification, string> = {
  DISTINCTION: "Distinction / First Class",
  FIRST_CLASS: "Distinction / First Class",
  CREDIT: "Credit / Second Class Upper",
  SECOND_CLASS: "Credit / Second Class Upper",
  PASS: "Pass",
  PASS_CLASS: "Pass",
};

function routeBasis(routeId?: string): EntryBasis | undefined {
  switch (routeId) {
    case "UACE_DIRECT": return "UACE_DIRECT";
    case "DIPLOMA": return "DIPLOMA";
    case "CERTIFICATE_HOLDER": return "CERTIFICATE_HOLDER";
    case "HIGHER_EDUCATION_ACCESS": return "HIGHER_EDUCATION_ACCESS";
    case "UACE": return "UACE";
    case "UCE": return "UCE";
    default: return undefined;
  }
}

function ucePointKey(grade: string): string {
  const upper = grade.trim().toUpperCase();
  return UCE_LEGACY_BY_NUMERIC[upper] ?? upper;
}

function uceSubjectPoints(grade: string, points: Record<string, number>): number {
  return points[ucePointKey(grade)] ?? 0;
}

function standingFor(a: Applicant, points: Record<string, number>): { label: string; points: number } {
  let best = { label: "", points: 0 };
  for (const qualification of a.qualifications) {
    const label = STANDING_KEY[qualification.classification];
    const value = points[label] ?? 0;
    if (value > best.points) best = { label, points: value };
  }
  return best;
}

function limitsFor(w: Weighting, options: ScoreOptions, basis: EntryBasis | undefined, useStanding: boolean, useUce: boolean) {
  const subDegree = w.system.sub_degree_weighting?.diploma_and_heac_uace;
  const isSubDegreeUace =
    !useStanding && !useUce && subDegree !== undefined &&
    (options.level === "diploma" || options.level === "higher_education_certificate") &&
    basis !== "UACE_DIRECT";
  if (isSubDegreeUace) {
    return { maxEssential: Math.max(1, subDegree.essential_count), maxWeighted: subDegree.essential_count + subDegree.relevant_count };
  }
  return { maxEssential: 2, maxWeighted: 3 };
}

/**
 * Combined weight under the adopted public-universities system. Advisory: used for ranking and fit,
 * never for eligibility (UMU has no cut-off).
 */
export function computeWeightedScore(a: Applicant, w: Weighting, options: ScoreOptions = {}): WeightedScore {
  const results = w.variants.map((v) => scoreVariant(a, w, v, options));
  results.sort((x, y) => y.total - x.total);
  const best = results[0]!;
  if (w.variants.length > 1) best.warnings.push(`Best of ${w.variants.length} variants: ${best.variant}`);
  return best;
}

function scoreVariant(a: Applicant, w: Weighting, v: WeightVariant, options: ScoreOptions): WeightedScore {
  const { category_weights: cw, alevel_points: pts, sub_degree_weighting: subDegree } = w.system;
  const basis = v.entry_basis ?? routeBasis(options.routeId);
  const useStanding = basis === "CERTIFICATE_HOLDER" || ((basis === "DIPLOMA" || basis === "HIGHER_EDUCATION_ACCESS") && a.uace.length === 0);
  const useUce = basis === "UCE" || (options.level === "certificate" && a.uace.length === 0);
  const { maxEssential, maxWeighted } = limitsFor(w, options, basis, useStanding, useUce);
  const warnings: string[] = [];
  const lines: ScoreLine[] = [];
  const used = new Set<string>();
  let essentialCount = 0;
  let weighted = 0;
  let alevel = 0;
  let uce = 0;
  let desirable = 0;
  let standing = 0;

  if (useStanding) {
    const best = standingFor(a, subDegree?.certificate_and_diploma_holder_standing ?? {});
    standing = best.points;
    if (best.points > 0) {
      lines.push({ subject: "Qualification standing", grade: best.label, category: "standing", points: best.points, weight: 1, contribution: best.points });
    } else if (a.qualifications.length > 0) {
      warnings.push("Qualification classification has no published standing points");
    }
  } else if (useUce) {
    const pointsByGrade = subDegree?.uce_subject_points ?? {};
    const pool = makePool(a.uce, (row) => uceSubjectPoints(row.grade, pointsByGrade), used);
    for (const selector of v.essential) {
      const room = Math.min(maxEssential - essentialCount, maxWeighted - weighted);
      if (room <= 0) break;
      for (const candidate of pickFor(selector, room, pool, () => true)) {
        if (!take(candidate, "essential", 1, lines, used)) continue;
        essentialCount += 1;
        weighted += 1;
        uce += candidate.points;
      }
    }
    for (const selector of v.relevant) {
      const room = maxWeighted - weighted;
      if (room <= 0) break;
      for (const candidate of pickFor(selector, room, pool, () => true)) {
        if (!take(candidate, "relevant", 1, lines, used)) continue;
        weighted += 1;
        uce += candidate.points;
      }
    }
  } else {
    const pool = makePool(a.uace.filter((row) => row.level === "PRINCIPAL"), (row) => pts[row.grade] ?? 0, used);
    const essentialGrades = new Set(subDegree?.diploma_and_heac_uace.essential_grades ?? []);
    const relevantGrades = new Set(subDegree?.diploma_and_heac_uace.relevant_grades ?? []);
    const isSubDegreeUace = options.level === "diploma" || options.level === "higher_education_certificate";
    const canBeEssential = (candidate: Candidate<UaceResult>) =>
      PRINCIPAL_PASS.has(candidate.r.grade) && (!isSubDegreeUace || essentialGrades.size === 0 || essentialGrades.has(candidate.r.grade));
    const canBeRelevant = (candidate: Candidate<UaceResult>) =>
      !isSubDegreeUace || relevantGrades.size === 0 || relevantGrades.has(candidate.r.grade);

    for (const selector of v.essential) {
      const room = Math.min(maxEssential - essentialCount, maxWeighted - weighted);
      if (room <= 0) break;
      for (const candidate of pickFor(selector, room, pool, canBeEssential)) {
        if (!take(candidate, "essential", cw.essential, lines, used)) continue;
        essentialCount += 1;
        weighted += 1;
        alevel += candidate.points * cw.essential;
      }
    }
    for (const selector of v.relevant) {
      const room = maxWeighted - weighted;
      if (room <= 0) break;
      for (const candidate of pickFor(selector, room, pool, canBeRelevant)) {
        if (!take(candidate, "relevant", cw.relevant, lines, used)) continue;
        weighted += 1;
        alevel += candidate.points * cw.relevant;
      }
    }

    const desirableNames = new Set(v.desirable.map(normSubject));
    for (const row of a.uace) {
      if (row.level !== "SUBSIDIARY" || !desirableNames.has(normSubject(row.subject)) || !isSubsidiaryGrade(row.grade)) continue;
      const points = subsidiaryPoints(row.grade);
      if (points > 0) desirable += 1;
      lines.push({ subject: row.subject, grade: row.grade, category: "desirable", points, weight: cw.desirable, contribution: points * cw.desirable });
    }
  }

  olevelLines(a, lines);
  const olevelTenths = a.uce.reduce((sum, row) => sum + oLevelWeightTenths(row.grade), 0);
  const olevel = olevelTenths / 10;
  const total = Math.round((alevel + uce + desirable * cw.desirable + standing) * 10 + olevelTenths) / 10;
  return { total, alevel, desirable, olevel, ...(uce > 0 ? { uce } : {}), ...(standing > 0 ? { standing } : {}), variant: v.id, lines, warnings };
}

function makePool<T extends { subject: string; grade: string }>(
  rows: T[],
  pointsOf: (row: T) => number,
  used: Set<string>,
) {
  const candidates: Candidate<T>[] = rows
    .map((row) => ({ r: row, points: pointsOf(row) }))
    .filter((candidate) => candidate.points > 0);
  const key = (candidate: Candidate<T>) => normSubject(candidate.r.subject);
  return (from: SubjectList, eligible: (candidate: Candidate<T>) => boolean): Candidate<T>[] => {
    let list = candidates.filter((candidate) => !used.has(key(candidate)) && eligible(candidate));
    const expanded = expandSubjectList(from);
    if (expanded) {
      const names = new Set(expanded);
      list = list.filter((candidate) => names.has(key(candidate)));
    } else if (from === "REMAINING_EXCLUDING_FINE_ART") {
      list = list.filter((candidate) => key(candidate) !== "fine art");
    }
    return list.sort((x, y) => y.points - x.points || key(x).localeCompare(key(y)));
  };
}

function take<T extends { subject: string; grade: string }>(
  candidate: Candidate<T>,
  category: "essential" | "relevant",
  weight: number,
  lines: ScoreLine[],
  used: Set<string>,
): boolean {
  const key = normSubject(candidate.r.subject);
  if (used.has(key)) return false;
  used.add(key);
  lines.push({ subject: candidate.r.subject, grade: candidate.r.grade, category, points: candidate.points, weight, contribution: candidate.points * weight });
  return true;
}

function pickFor<T>(
  selector: Selector,
  room: number,
  pool: (from: SubjectList, eligible: (candidate: T) => boolean) => T[],
  eligible: (candidate: T) => boolean,
): T[] {
  switch (selector.type) {
    case "REQUIRED":
      return pool(selector.subjects, eligible).slice(0, room);
    case "ANY_OR_BOTH":
      return pool(selector.subjects, eligible).slice(0, Math.min(selector.n ?? 2, room));
    case "BEST_OF":
      return pool(selector.from, eligible).slice(0, Math.min(selector.n ?? selector.n_max ?? 1, room));
  }
}

function olevelLines(a: Applicant, lines: ScoreLine[]): void {
  for (const row of a.uce) {
    const points = oLevelWeightTenths(row.grade) / 10;
    if (points > 0) lines.push({ subject: row.subject, grade: row.grade, category: "desirable", points, weight: 1, contribution: 0 });
  }
}
