import { describe, expect, it } from "vitest";
import type { Applicant } from "../rules-engine";
import {
  SEED_EFFECTIVE_FROM, approvalLine, buildSeedRows, isInUse, ruleContent, ruleSetFromRow, selectInUse, storedLookup, toStored,
  validateRuleSetContent, type RuleSetInsert, type RuleSetRow,
} from "./ruleSetStore";
import { compileFileRuleSet, programmeCatalogue, screenProgramme } from "./screeningService";

const NOW = new Date("2026-10-26T10:00:00Z");
const asRow = (insert: RuleSetInsert, over: Partial<RuleSetRow> = {}): RuleSetRow => ({
  effectiveTo: null, approvalNote: null, approvedBy: null, approvalReference: null, approvedAt: null, approvalRecordedBy: null,
  activatedAt: null, activatedBy: null, updatedBy: null, createdAt: NOW, updatedAt: NOW, approvalStatus: "pending",
  ...insert, ...over,
} as RuleSetRow);

const seed = buildSeedRows(NOW, 1).map((row) => asRow(row));
const screenable = programmeCatalogue.filter((programme) => programme.screenable);

describe("seed rule sets", () => {
  it("creates one activated version for every screenable programme", () => {
    expect(seed).toHaveLength(screenable.length);
    expect(new Set(seed.map((row) => row.id)).size).toBe(seed.length);
    expect(seed.every((row) => row.activatedAt !== null && row.effectiveFrom === SEED_EFFECTIVE_FROM)).toBe(true);
  });
  it("records UMU-published rules as approved and adopted rules as pending", () => {
    for (const row of seed) {
      if (row.status === "official") {
        expect(row.approvalStatus).toBe("approved");
        expect(row.approvedBy).toBeTruthy();
      } else {
        expect(row.status).toBe("adopted-proxy");
        expect(row.approvalStatus).toBe("pending");
        expect(row.approval).toBe("Pending UMU admissions approval");
      }
    }
    expect(seed.some((row) => row.status === "adopted-proxy")).toBe(true);
  });
  it("stores content the engine accepts, identical to compiling from the data files", () => {
    for (const row of seed) {
      expect(validateRuleSetContent(row.rules)).toEqual([]);
      const fromRow = ruleSetFromRow(row)!;
      const fromFiles = compileFileRuleSet(row.programmeId);
      expect(fromRow.routes).toEqual(fromFiles.routes);
      expect(fromRow.documents).toEqual(fromFiles.documents);
      expect(fromRow.weighting).toEqual(fromFiles.weighting);
      expect(fromRow.meta.status).toBe(fromFiles.meta.status);
    }
  });
  it("gives the same screening outcome whether rules come from the database or the files", () => {
    const applicant: Applicant = {
      id: "a", uce: [], qualifications: [], documents: ["NATIONAL_ID", "UACE_RESULT_SLIP"],
      uace: [
        { subject: "Mathematics", level: "PRINCIPAL", grade: "A", sitting: "2025" },
        { subject: "Physics", level: "PRINCIPAL", grade: "B", sitting: "2025" },
      ],
    };
    const lookup = storedLookup(seed, "2026-10-26");
    for (const programme of screenable) {
      const stored = screenProgramme(applicant, programme.id, lookup(programme.id));
      const files = screenProgramme(applicant, programme.id);
      expect(stored.outcome).toBe(files.outcome);
      expect(stored.ruleSetRecordId).toBe(`${programme.id}@2026-27.1`);
      expect(files.ruleSetRecordId).toBeNull();
      expect(files.ruleApproval).toBe("none");
    }
  });
});

describe("choosing the version in use", () => {
  const base = seed.find((row) => row.programmeId === "umu-bsc-cs")!;
  const v = (version: string, over: Partial<RuleSetRow>) => ({ ...base, id: `umu-bsc-cs@${version}`, version, ...over });

  it("uses the latest effective activated version", () => {
    const rows = [base, v("2", { effectiveFrom: "2026-09-01" }), v("3", { effectiveFrom: "2027-01-01" })];
    expect(selectInUse(rows, "2026-10-26").get("umu-bsc-cs")!.version).toBe("2");
    expect(selectInUse(rows, "2027-02-01").get("umu-bsc-cs")!.version).toBe("3");
  });
  it("ignores versions that are not activated, rejected, legacy proposals or expired", () => {
    expect(isInUse(v("x", { activatedAt: null }), "2026-10-26")).toBe(false);
    expect(isInUse(v("x", { approvalStatus: "rejected" }), "2026-10-26")).toBe(false);
    expect(isInUse(v("x", { status: "needs-review" }), "2026-10-26")).toBe(false);
    expect(isInUse(v("x", { effectiveTo: "2026-10-26" }), "2026-10-26")).toBe(false);
    expect(isInUse(v("x", { effectiveTo: "2026-10-27" }), "2026-10-26")).toBe(true);
    expect(isInUse(v("x", { effectiveFrom: "2026-11-01" }), "2026-10-26")).toBe(false);
  });
  it("falls back to the data files when no version is in use", () => {
    const lookup = storedLookup([v("x", { activatedAt: null })], "2026-10-26");
    expect(lookup("umu-bsc-cs")).toBeUndefined();
  });
  it("breaks ties by the newest record", () => {
    const older = v("a", { createdAt: new Date("2026-10-01") });
    const newer = v("b", { createdAt: new Date("2026-10-02") });
    expect(selectInUse([older, newer], "2026-10-26").get("umu-bsc-cs")!.version).toBe("b");
  });
  it("reports approval in the stored rule set the engine receives", () => {
    const approved = v("ok", { approvalStatus: "approved", approvedBy: "Academic Registrar", approvalReference: "Minute 12/2026" });
    expect(toStored(approved)!.approvalStatus).toBe("approved");
    expect(toStored(approved)!.ruleSet.meta.approval).toBe("Approved by Academic Registrar (Minute 12/2026)");
  });
});

describe("rule content validation", () => {
  const good = ruleContent(compileFileRuleSet("umu-bsc-cs"));
  it("accepts a compiled rule set", () => {
    expect(validateRuleSetContent(good)).toEqual([]);
  });
  it("rejects content the engine could not screen", () => {
    expect(validateRuleSetContent({})).not.toEqual([]);
    expect(validateRuleSetContent({ ...good, routes: [] })).not.toEqual([]);
    expect(validateRuleSetContent({ ...good, level: "masters" })).not.toEqual([]);
    expect(validateRuleSetContent({ ...good, routes: [{ id: "R", rules: [{ id: "x", type: "NOT_A_RULE" }] }] })).not.toEqual([]);
    expect(validateRuleSetContent({ ...good, routes: [{ id: "R", rules: [{ id: "x", type: "MIN_PRINCIPAL_PASSES", count: -1, sameSitting: true }] }] })).not.toEqual([]);
  });
  it("describes approval in words", () => {
    expect(approvalLine({ approvalStatus: "pending", approvedBy: null, approvalReference: null })).toBe("Pending UMU admissions approval");
    expect(approvalLine({ approvalStatus: "rejected", approvedBy: "X", approvalReference: null, approvalNote: "Wrong subjects" })).toBe("Rejected by UMU: Wrong subjects");
  });
});
