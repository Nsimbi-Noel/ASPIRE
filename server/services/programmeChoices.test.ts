import { describe, expect, it } from "vitest";
import { MAX_PROGRAMME_CHOICES, planProgrammeChoices } from "./programmeChoices";

describe("programme choices", () => {
  it("ranks the wanted programmes from 1 in the order given", () => {
    expect(planProgrammeChoices([], ["a", "b", "c"])).toEqual({
      upserts: [{ programmeId: "a", choiceRank: 1 }, { programmeId: "b", choiceRank: 2 }, { programmeId: "c", choiceRank: 3 }],
      withdraw: [],
    });
  });
  it("withdraws submitted choices that are no longer wanted", () => {
    const plan = planProgrammeChoices([
      { programmeId: "a", status: "submitted", choiceRank: 1 },
      { programmeId: "b", status: "submitted", choiceRank: 2 },
      { programmeId: "z", status: "withdrawn", choiceRank: 3 },
    ], ["b"]);
    expect(plan.withdraw).toEqual(["a"]);
    expect(plan.upserts).toEqual([{ programmeId: "b", choiceRank: 1 }]);
  });
  it("ignores duplicates and allows clearing every choice", () => {
    expect(planProgrammeChoices([], ["a", "a", "b"]).upserts.map((item) => item.programmeId)).toEqual(["a", "b"]);
    expect(planProgrammeChoices([{ programmeId: "a", status: "submitted", choiceRank: 1 }], []).withdraw).toEqual(["a"]);
  });
  it(`rejects more than ${MAX_PROGRAMME_CHOICES} programmes`, () => {
    expect(() => planProgrammeChoices([], ["1", "2", "3", "4", "5", "6"])).toThrow(/at most/);
  });
});
