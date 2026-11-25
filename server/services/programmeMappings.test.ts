import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createProgrammeMappingRegistry, validateProgrammeMappings } from "./programmeMappings";

const here = fileURLToPath(new URL("../../", import.meta.url));
const readJson = (relativePath: string) =>
  JSON.parse(readFileSync(`${here}/${relativePath}`, "utf8")) as unknown;
const weights = readJson("data/rules/programme-weights.2026-27.json");
const baseline = readJson("data/rules/programme-mapping.umu.json");
const proposal = readJson("data/rules/programme-mapping-proposal.umu.json");

describe("programme mapping registry", () => {
  it("resolves a safe baseline mapping and exposes adopted-proxy provenance without approval claims", () => {
    const registry = createProgrammeMappingRegistry(baseline, weights);
    const mapping = registry.getById("umu-bsc-agric");

    expect(mapping).toMatchObject({
      id: "umu-bsc-agric",
      approvalStatus: "adopted-proxy",
      officiallyApproved: false,
      needsReview: false,
      meta: { approval: "pending UMU admissions approval" },
      rules: [{ rule: "mak-3", role: "primary", match: "exact" }],
    });
    expect(registry.getById("umu-bsc-eco-organic")).toBeUndefined();
    expect(registry.getIssuesById("umu-bsc-eco-organic").some((issue) => issue.code === "needs_review")).toBe(true);
  });

  it("flags the proposal's nine entries containing ten distinct unresolved rule IDs and unsupported levels", () => {
    const result = validateProgrammeMappings(proposal, weights);
    const unresolved = [...new Set(result.issues.filter((issue) => issue.code === "unknown_rule").map((issue) => issue.ruleId))].sort();
    const unresolvedEntryIds = [...new Set(result.issues.filter((issue) => issue.code === "unknown_rule").map((issue) => issue.programmeId))];
    const unsupportedLevels = result.issues.filter((issue) => issue.code === "invalid_level").map((issue) => issue.message);

    expect(unresolved).toEqual([
      "kyu-counselling-alt",
      "kyu-spec-needs",
      "mak-ptc-primary",
      "mak-swsa-alt",
      "must-15-cpa",
      "must-health-prom",
      "must-pubhealth",
      "nche-heac-gen",
      "umu-gen-entry-sub",
      "umu-grad-school-gen",
    ]);
    expect(unresolvedEntryIds).toHaveLength(9);
    expect(unsupportedLevels).toHaveLength(2);
    expect(unsupportedLevels.join(" ")).toContain("sub-bachelors");
    expect(unsupportedLevels.join(" ")).toContain("postgraduate");
    expect(result.usableMappings.some((mapping) => unresolvedEntryIds.includes(mapping.id))).toBe(false);
    expect(result.usableMappings.some((mapping) => mapping.officiallyApproved)).toBe(false);
  });

  it("rejects empty/duplicate IDs, invalid enums, wrong primary counts and unresolved rules", () => {
    const malformed = {
      meta: { status: "adopted-proxy" },
      mapped: [
        { id: "", level: "bachelors", rules: [] },
        { id: "duplicate", level: "bachelors", rules: [{ rule: "mak-3", role: "secondary", match: "close" }] },
        { id: "duplicate", level: "bachelors", rules: [{ rule: "mak-3", role: "primary", match: "exact" }, { rule: "not-real", role: "primary", match: "maybe" }] },
      ],
    };
    const result = validateProgrammeMappings(malformed, weights);
    const codes = result.issues.map((issue) => issue.code);

    expect(codes).toEqual(expect.arrayContaining(["empty_id", "duplicate_id", "missing_primary", "multiple_primary", "unknown_rule", "invalid_role", "invalid_match"]));
    expect(result.usableMappings).toEqual([]);
  });
});
