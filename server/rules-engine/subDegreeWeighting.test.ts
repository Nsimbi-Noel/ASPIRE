import { describe, expect, it } from "vitest";
import { compileFileRuleSet } from "../services/screeningService";
import { expandSubjectList, normSubject } from "./subjects";
import type { Applicant, Weighting } from "./types";
import { computeWeightedScore } from "./weighting";

function uace(subject: string, grade: string, level: "PRINCIPAL" | "SUBSIDIARY" = "PRINCIPAL"): Applicant["uace"][number] {
  return { subject, grade: grade as Applicant["uace"][number]["grade"], level, sitting: "2025" };
}

function uce(subject: string, grade: string): Applicant["uce"][number] {
  return { subject, grade: grade as Applicant["uce"][number]["grade"], sitting: "2025" };
}

function applicant(overrides: Partial<Applicant> = {}): Applicant {
  return {
    id: "APP-1",
    uce: [uce("English", "C4")],
    uace: [],
    qualifications: [],
    documents: [],
    ...overrides,
  };
}

function weightingFor(programmeId: string): Weighting {
  const weighting = compileFileRuleSet(programmeId).weighting;
  if (!weighting) throw new Error(`Missing weighting for ${programmeId}`);
  return weighting;
}

describe("subject list expansion", () => {
  it("normalizes aliases and expands named subject groups", () => {
    expect(normSubject("Maths")).toBe("mathematics");
    expect(normSubject("Subsidiary ICT")).toBe("computer studies");
    expect(expandSubjectList("Language subjects")).toContain("literature in english");
    expect(expandSubjectList("ALL_ARTS_SUBJECTS")).toContain("fine art");
    expect(expandSubjectList(["General Paper"])).toEqual(["general paper"]);
    expect(expandSubjectList("REMAINING")).toBeNull();
  });

  it("scores a named language subject group", () => {
    const weighting: Weighting = {
      ruleId: "language-test",
      system: { category_weights: { essential: 3, relevant: 2, desirable: 1 }, alevel_points: { A: 6, B: 5 } },
      variants: [{ id: "LANG", essential: [{ type: "BEST_OF", n: 1, from: "Language subjects" }], relevant: [], desirable: [] }],
    };
    const score = computeWeightedScore(applicant({ uace: [uace("Literature in English", "A"), uace("History", "B"), uace("Mathematics", "B")] }), weighting);
    expect(score.lines.filter((line) => line.category === "essential")).toHaveLength(1);
    expect(score.lines.find((line) => line.category === "essential")).toMatchObject({ subject: "Literature in English", points: 6 });
  });
});

describe("sub-degree weighting", () => {
  it("caps diploma UACE entries at one essential and two relevant subjects", () => {
    const score = computeWeightedScore(
      applicant({
        uace: [uace("Biology", "A"), uace("Agriculture", "B"), uace("Chemistry", "C"), uace("Mathematics", "D")],
      }),
      weightingFor("umu-dip-animal-prod"),
      { routeId: "UACE", level: "diploma" },
    );
    expect(score.lines.filter((line) => line.category === "essential")).toHaveLength(1);
    expect(score.lines.filter((line) => line.category === "relevant")).toHaveLength(2);
    expect(score.alevel).toBe(36);
    expect(score.olevel).toBe(0.2);
    expect(score.total).toBe(36.2);
  });

  it("keeps the two-essential bachelor limit for UACE-direct programmes", () => {
    const score = computeWeightedScore(
      applicant({
        uace: [uace("Mathematics", "A"), uace("Physics", "B"), uace("Chemistry", "C"), uace("Biology", "D")],
      }),
      weightingFor("umu-bsc-agri-tech"),
      { routeId: "UACE_DIRECT", level: "bachelors" },
    );
    expect(score.lines.filter((line) => line.category === "essential")).toHaveLength(2);
    expect(score.lines.filter((line) => line.category === "relevant")).toHaveLength(1);
    expect(score.alevel).toBe(41);
    expect(score.total).toBe(41.2);
  });

  it("scores certificate rules from selected UCE subject points plus O-level weight", () => {
    const weighting = weightingFor("umu-cert-comp-app");
    expect(weighting.variants[0]?.entry_basis).toBe("UCE");
    const score = computeWeightedScore(
      applicant({
        uce: [uce("Mathematics", "D1"), uce("Computer Studies", "C3"), uce("English", "C4"), uce("Biology", "C6"), uce("Physics", "P7")],
      }),
      weighting,
      { routeId: "UCE", level: "certificate" },
    );
    expect(score.alevel).toBe(0);
    expect(score.uce).toBe(13);
    expect(score.olevel).toBe(1);
    expect(score.total).toBe(14);
  });

  it("uses certificate-holder standing instead of A-Level points", () => {
    const score = computeWeightedScore(
      applicant({
        uce: [uce("English", "C4")],
        qualifications: [{ type: "CERTIFICATE", classification: "CREDIT" }],
      }),
      weightingFor("umu-dip-it"),
      { routeId: "CERTIFICATE_HOLDER", level: "diploma" },
    );
    expect(score.standing).toBe(15);
    expect(score.alevel).toBe(0);
    expect(score.total).toBe(15.2);
    expect(score.lines.find((line) => line.category === "standing")).toMatchObject({ points: 15 });
  });
});
