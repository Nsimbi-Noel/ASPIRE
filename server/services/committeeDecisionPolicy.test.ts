import { describe, expect, it } from "vitest";
import { assessCommitteeDecision } from "./committeeDecisionPolicy";

const base = {
  outcome: "ELIGIBLE" as const,
  ruleApproved: true,
  overrideSystemResult: false,
};

describe("committee decision policy", () => {
  it("allows an eligible admit when UMU has approved the rules used", () => {
    expect(assessCommitteeDecision({ ...base, decision: "admit" })).toEqual({
      allowed: true,
      nextApplicationStatus: "completed",
      overrideApplied: false,
    });
  });

  it("blocks an admit when the rules are not approved, even when the screening says eligible", () => {
    const result = assessCommitteeDecision({
      ...base,
      decision: "admit",
      ruleApproved: false,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.message).toContain("UMU has approved");
  });

  it("does not let an override bypass rules that are not approved", () => {
    const result = assessCommitteeDecision({
      ...base,
      decision: "admit",
      ruleApproved: false,
      outcome: "ON_HOLD",
      overrideSystemResult: true,
    });
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.message).toContain("UMU has approved");
  });

  it("requires an explicit override to admit against a non-eligible or on-hold result", () => {
    const blocked = assessCommitteeDecision({
      ...base,
      decision: "admit",
      outcome: "ON_HOLD",
    });
    expect(blocked.allowed).toBe(false);

    const approvedOverride = assessCommitteeDecision({
      ...base,
      decision: "admit",
      outcome: "ON_HOLD",
      overrideSystemResult: true,
    });
    expect(approvedOverride).toEqual({
      allowed: true,
      nextApplicationStatus: "completed",
      overrideApplied: true,
    });
  });

  it("keeps defer and request-information cases in review", () => {
    for (const decision of ["defer", "request_information"] as const) {
      expect(assessCommitteeDecision({
        ...base,
        decision,
      })).toEqual({
        allowed: true,
        nextApplicationStatus: "in_review",
        overrideApplied: false,
      });
    }
  });

  it("closes decline decisions without claiming they override screening", () => {
    expect(assessCommitteeDecision({
      ...base,
      decision: "decline",
    })).toEqual({
      allowed: true,
      nextApplicationStatus: "completed",
      overrideApplied: false,
    });
  });

  it("still allows decline, defer and request-information when the rules are not approved", () => {
    for (const decision of ["decline", "defer", "request_information"] as const) {
      const result = assessCommitteeDecision({ ...base, ruleApproved: false, decision });
      expect(result.allowed).toBe(true);
    }
  });
});
