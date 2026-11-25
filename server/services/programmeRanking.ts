import type { ScreeningResult, WeightedScore } from "../rules-engine/types";

export const PROGRAMME_RANKING_METHOD = "TOPSIS with AHP-derived criterion weights";
export const PROGRAMME_RANKING_VERSION = "provisional-v1";

export const PROGRAMME_RANKING_NOTE =
  "Advisory ranking only; does not determine or modify eligibility. Criteria are summed score-line contributions for essential, relevant, desirable categories and the count of positive-contribution subjects. TOPSIS uses vector-normalized benefit criteria and fixed provisional AHP weights. The judgment matrix and weights require institutional review before operational use.";

export const PROGRAMME_RANKING_CRITERIA = [
  "essentialContribution",
  "relevantContribution",
  "desirableContribution",
  "positiveSubjectCount",
] as const;

export type ProgrammeRankingCriterion = (typeof PROGRAMME_RANKING_CRITERIA)[number];
export type ProgrammeRankingCriteriaValues = Record<ProgrammeRankingCriterion, number>;
export type ProgrammeRankingWeights = Record<ProgrammeRankingCriterion, number>;

/**
 * Fixed provisional AHP pairwise judgment matrix, in criteria order above:
 * [[1, 3, 5, 7], [1/3, 1, 3, 5], [1/5, 1/3, 1, 3], [1/7, 1/5, 1/3, 1]].
 * It expresses provisional relative importance only, not an approved policy.
 * Weights are derived by row geometric means and normalized to sum to one.
 */
export const PROVISIONAL_AHP_MATRIX: readonly (readonly number[])[] = [
  [1, 3, 5, 7],
  [1 / 3, 1, 3, 5],
  [1 / 5, 1 / 3, 1, 3],
  [1 / 7, 1 / 5, 1 / 3, 1],
];

const geometricMeans = PROVISIONAL_AHP_MATRIX.map((row) =>
  Math.exp(row.reduce((sum, value) => sum + Math.log(value), 0) / row.length),
);
const weightTotal = geometricMeans.reduce((sum, value) => sum + value, 0);
export const PROGRAMME_RANKING_WEIGHTS: ProgrammeRankingWeights = {
  essentialContribution: geometricMeans[0] / weightTotal,
  relevantContribution: geometricMeans[1] / weightTotal,
  desirableContribution: geometricMeans[2] / weightTotal,
  positiveSubjectCount: geometricMeans[3] / weightTotal,
};

export interface RankedProgramme {
  programme: ScreeningResult;
  /** Sequential 1-based rank; ties are resolved by original input order. */
  rank?: number;
  /** TOPSIS relative closeness to the positive ideal, in [0, 1]. */
  closenessCoefficient?: number;
  criterionValues?: ProgrammeRankingCriteriaValues;
  criterionWeights: ProgrammeRankingWeights;
  method: typeof PROGRAMME_RANKING_METHOD;
  version: typeof PROGRAMME_RANKING_VERSION;
  methodNote: string;
}

export interface ProgrammeRankingResult {
  method: typeof PROGRAMME_RANKING_METHOD;
  version: typeof PROGRAMME_RANKING_VERSION;
  methodNote: string;
  criterionWeights: ProgrammeRankingWeights;
  results: RankedProgramme[];
}

function valuesFromScore(score: WeightedScore): ProgrammeRankingCriteriaValues {
  const values: ProgrammeRankingCriteriaValues = {
    essentialContribution: 0,
    relevantContribution: 0,
    desirableContribution: 0,
    positiveSubjectCount: 0,
  };
  const positiveSubjects = new Set<string>();

  for (const line of score.lines) {
    const contribution = Number.isFinite(line.contribution) ? line.contribution : 0;
    if (line.category === "essential") values.essentialContribution += contribution;
    if (line.category === "relevant") values.relevantContribution += contribution;
    if (line.category === "desirable") values.desirableContribution += contribution;
    if (contribution > 0) positiveSubjects.add(line.subject);
  }
  values.positiveSubjectCount = positiveSubjects.size;
  return values;
}

/**
 * Ranks only supplied ELIGIBLE programmes that have a score. All other records
 * are returned unchanged and without rank or criterion values. TOPSIS is
 * computed over the eligible scored cohort passed to this call.
 */
export function rankProgrammes(programmes: readonly ScreeningResult[]): ProgrammeRankingResult {
  const candidates = programmes
    .map((programme, inputIndex) => ({ programme, inputIndex, values: programme.score ? valuesFromScore(programme.score) : undefined }))
    .filter((entry): entry is { programme: ScreeningResult; inputIndex: number; values: ProgrammeRankingCriteriaValues } =>
      entry.programme.outcome === "ELIGIBLE" && entry.values !== undefined,
    );

  const normalized = candidates.map(() => Object.fromEntries(PROGRAMME_RANKING_CRITERIA.map((criterion) => [criterion, 0])) as ProgrammeRankingCriteriaValues);
  for (const criterion of PROGRAMME_RANKING_CRITERIA) {
    const norm = Math.sqrt(candidates.reduce((sum, entry) => sum + entry.values[criterion] ** 2, 0));
    if (norm > 0) {
      candidates.forEach((entry, index) => {
        normalized[index][criterion] = entry.values[criterion] / norm;
      });
    }
  }

  const weighted = normalized.map((row) => Object.fromEntries(
    PROGRAMME_RANKING_CRITERIA.map((criterion) => [criterion, row[criterion] * PROGRAMME_RANKING_WEIGHTS[criterion]]),
  ) as ProgrammeRankingCriteriaValues);
  const idealBest = Object.fromEntries(PROGRAMME_RANKING_CRITERIA.map((criterion) => [
    criterion, weighted.length ? Math.max(...weighted.map((row) => row[criterion])) : 0,
  ])) as ProgrammeRankingCriteriaValues;
  const idealWorst = Object.fromEntries(PROGRAMME_RANKING_CRITERIA.map((criterion) => [
    criterion, weighted.length ? Math.min(...weighted.map((row) => row[criterion])) : 0,
  ])) as ProgrammeRankingCriteriaValues;

  const scored = candidates.map((entry, index) => {
    const distance = (ideal: ProgrammeRankingCriteriaValues) => Math.sqrt(PROGRAMME_RANKING_CRITERIA.reduce(
      (sum, criterion) => sum + (weighted[index][criterion] - ideal[criterion]) ** 2, 0,
    ));
    const toBest = distance(idealBest);
    const toWorst = distance(idealWorst);
    const closenessCoefficient = toBest + toWorst === 0 ? 0.5 : toWorst / (toBest + toWorst);
    return { ...entry, closenessCoefficient };
  });
  scored.sort((a, b) => b.closenessCoefficient - a.closenessCoefficient || a.inputIndex - b.inputIndex);
  const ranks = new Map<number, number>();
  scored.forEach((entry, index) => ranks.set(entry.inputIndex, index + 1));
  const candidateByIndex = new Map(candidates.map((entry) => [entry.inputIndex, entry]));
  const closenessByIndex = new Map(scored.map((entry) => [entry.inputIndex, entry.closenessCoefficient]));

  return {
    method: PROGRAMME_RANKING_METHOD,
    version: PROGRAMME_RANKING_VERSION,
    methodNote: PROGRAMME_RANKING_NOTE,
    criterionWeights: { ...PROGRAMME_RANKING_WEIGHTS },
    results: programmes.map((programme, inputIndex) => {
      const candidate = candidateByIndex.get(inputIndex);
      return {
        programme,
        ...(candidate ? {
          rank: ranks.get(inputIndex),
          closenessCoefficient: closenessByIndex.get(inputIndex),
          criterionValues: candidate.values,
        } : {}),
        criterionWeights: { ...PROGRAMME_RANKING_WEIGHTS },
        method: PROGRAMME_RANKING_METHOD,
        version: PROGRAMME_RANKING_VERSION,
        methodNote: PROGRAMME_RANKING_NOTE,
      };
    }),
  };
}
