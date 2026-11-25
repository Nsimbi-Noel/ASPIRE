import { describe, expect, it } from "vitest";
import type { ScreeningResult, WeightedScore } from "../rules-engine/types";
import { rankProgrammes } from "./programmeRanking";

function makeProgramme(id: string, outcome: ScreeningResult["outcome"], lines: WeightedScore["lines"] = []): ScreeningResult {
  return {
    programmeId: id,
    programmeName: id,
    ruleSet: { id: `rules-${id}`, status: "assumed", source: "test fixture", approval: "not approved" },
    outcome,
    academic: { status: outcome === "ELIGIBLE" ? "PASS" : outcome === "ON_HOLD" ? "REVIEW" : "FAIL", routes: [] },
    documents: { required: [], missing: [] },
    holdReasons: outcome === "ON_HOLD" ? ["MANUAL_REVIEW"] : [],
    score: { total: lines.reduce((sum, line) => sum + line.contribution, 0), alevel: 0, desirable: 0, olevel: 0, lines, warnings: [] },
  };
}

const contribution = (subject: string, category: "essential" | "relevant" | "desirable", value: number) => ({
  subject, grade: "A", category, points: value, weight: 1, contribution: value,
});

describe("programme ranking", () => {
  it("does not change outcomes and leaves NOT_ELIGIBLE and ON_HOLD records unranked", () => {
    const eligible = makeProgramme("eligible", "ELIGIBLE", [contribution("Math", "essential", 10)]);
    const failed = makeProgramme("failed", "NOT_ELIGIBLE", [contribution("Math", "essential", 100)]);
    const held = makeProgramme("held", "ON_HOLD", [contribution("Math", "essential", 100)]);
    const before = [eligible, failed, held].map(({ outcome }) => outcome);
    const result = rankProgrammes([eligible, failed, held]);

    expect(result.results.map(({ programme }) => programme.outcome)).toEqual(before);
    expect(result.results[0].rank).toBe(1);
    expect(result.results[1]).not.toHaveProperty("rank");
    expect(result.results[2]).not.toHaveProperty("rank");
    expect(result.results[1].programme).toBe(failed);
    expect(result.results[2].programme).toBe(held);
  });

  it("ranks the higher-fit candidate first in a controlled case", () => {
    const lower = makeProgramme("lower", "ELIGIBLE", [contribution("Math", "essential", 2)]);
    const higher = makeProgramme("higher", "ELIGIBLE", [contribution("Math", "essential", 10)]);
    const result = rankProgrammes([lower, higher]);

    expect(result.results.map(({ programme }) => programme.programmeId)).toEqual(["lower", "higher"]);
    expect(result.results.find(({ programme }) => programme.programmeId === "higher")?.rank).toBe(1);
    expect(result.results.find(({ programme }) => programme.programmeId === "lower")?.rank).toBe(2);
    expect(result.results.find(({ programme }) => programme.programmeId === "higher")?.criterionValues).toEqual({
      essentialContribution: 10,
      relevantContribution: 0,
      desirableContribution: 0,
      positiveSubjectCount: 1,
    });
    expect(result.results.find(({ programme }) => programme.programmeId === "higher")?.criterionWeights).toEqual(result.criterionWeights);
    expect(result.methodNote).toContain("provisional");
  });

  it("handles empty candidate lists and zero columns", () => {
    expect(rankProgrammes([]).results).toEqual([]);
    const first = makeProgramme("first", "ELIGIBLE");
    const second = makeProgramme("second", "ELIGIBLE");
    const zeroResult = rankProgrammes([first, second]);
    expect(zeroResult.results.map(({ rank }) => rank)).toEqual([1, 2]);
    expect(zeroResult.results.map(({ closenessCoefficient }) => closenessCoefficient)).toEqual([0.5, 0.5]);
  });

  it("is deterministic for exact ties", () => {
    const a = makeProgramme("a", "ELIGIBLE", [contribution("Math", "essential", 5)]);
    const b = makeProgramme("b", "ELIGIBLE", [contribution("Math", "essential", 5)]);
    const run = () => rankProgrammes([a, b]).results.map(({ programme, rank, closenessCoefficient }) => ({ id: programme.programmeId, rank, closenessCoefficient }));
    expect(run()).toEqual(run());
    expect(run().map(({ id, rank }) => [id, rank])).toEqual([["a", 1], ["b", 2]]);
  });
});
