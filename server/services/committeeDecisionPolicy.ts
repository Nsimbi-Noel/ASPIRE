export type CommitteeOutcome = "ELIGIBLE" | "NOT_ELIGIBLE" | "ON_HOLD";
export type CommitteeAction = "admit" | "decline" | "defer" | "request_information";

export type CommitteeDecisionPolicy =
  | { allowed: false; message: string }
  | {
      allowed: true;
      nextApplicationStatus: "completed" | "in_review";
      overrideApplied: boolean;
    };

/**
 * Pure policy: an admission can only be recorded when UMU has approved the rule set the screening used
 * (the registrar records that approval) and the programme mapping is not awaiting review.
 */
export function assessCommitteeDecision(input: {
  decision: CommitteeAction;
  outcome: CommitteeOutcome;
  /** True when the rule set used by the latest screening has a recorded UMU approval. */
  ruleApproved: boolean;
  overrideSystemResult: boolean;
}): CommitteeDecisionPolicy {
  if (
    input.decision === "admit" &&
    input.outcome !== "ELIGIBLE" &&
    !input.overrideSystemResult
  ) {
    return {
      allowed: false,
      message:
        "This result is not eligible or remains on hold. Admitting against that result requires an explicit committee override and reason.",
    };
  }

  if (input.decision === "admit" && !input.ruleApproved) {
    return {
      allowed: false,
      message:
        "An admit decision needs rules that UMU has approved. The rules used for this programme are provisional, unresolved or not yet approved: ask the registrar to record UMU's approval, then screen the case again.",
    };
  }

  const overrideApplied =
    input.decision === "admit" &&
    input.outcome !== "ELIGIBLE" &&
    input.overrideSystemResult;

  return {
    allowed: true,
    nextApplicationStatus:
      input.decision === "admit" || input.decision === "decline"
        ? "completed"
        : "in_review",
    overrideApplied,
  };
}
