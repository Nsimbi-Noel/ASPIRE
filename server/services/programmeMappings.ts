export const PROGRAMME_LEVELS = [
  "bachelors",
  "diploma",
  "certificate",
  "higher_education_certificate",
] as const;

export type ProgrammeLevel = (typeof PROGRAMME_LEVELS)[number];
export type MappingRole = "primary" | "alternate";
export type MappingMatch = "exact" | "close" | "partial";

export interface ProgrammeRuleReference {
  rule: string;
  role: MappingRole;
  match: MappingMatch;
}

export interface ProgrammeMappingEntry {
  id: string;
  umu_programme: string;
  level: string;
  rules: ProgrammeRuleReference[];
  note?: string;
  needs_review?: boolean;
  [key: string]: unknown;
}

export interface ProgrammeMappingDataset {
  meta?: Record<string, unknown>;
  mapped: ProgrammeMappingEntry[];
  no_equivalent?: unknown[];
  [key: string]: unknown;
}

export interface ProgrammeWeightDataset {
  rules: Array<{ id: string; [key: string]: unknown }>;
}

export type MappingIssueCode =
  | "invalid_dataset"
  | "empty_id"
  | "duplicate_id"
  | "invalid_level"
  | "invalid_rules"
  | "invalid_role"
  | "invalid_match"
  | "missing_primary"
  | "multiple_primary"
  | "unknown_rule"
  | "needs_review";

export interface MappingIssue {
  code: MappingIssueCode;
  message: string;
  programmeId?: string;
  ruleId?: string;
  path?: string;
}

export interface MappingValidationResult {
  valid: boolean;
  issues: MappingIssue[];
  /** Maps with at least one issue that compromises rule safety are not usable. */
  usableMappings: UsableProgrammeMapping[];
}

export interface UsableProgrammeMapping {
  id: string;
  umu_programme: string;
  level: ProgrammeLevel;
  rules: ProgrammeRuleReference[];
  note?: string;
  /** Source metadata is exposed for provenance; it does not imply official approval. */
  meta?: Record<string, unknown>;
  approvalStatus: unknown;
  needsReview: false;
  officiallyApproved: false;
}

const roles: readonly string[] = ["primary", "alternate"];
const matches: readonly string[] = ["exact", "close", "partial"];
const levels: readonly string[] = PROGRAMME_LEVELS;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate a mapping dataset against the supplied programme-weight registry. */
export function validateProgrammeMappings(
  dataset: unknown,
  weights: unknown,
): MappingValidationResult {
  const issues: MappingIssue[] = [];
  if (!isRecord(dataset) || !Array.isArray(dataset.mapped)) {
    return {
      valid: false,
      issues: [{ code: "invalid_dataset", message: "Mapping dataset must have a mapped array." }],
      usableMappings: [],
    };
  }
  const weightIds = new Set<string>();
  if (isRecord(weights) && Array.isArray(weights.rules)) {
    for (const rule of weights.rules) {
      if (isRecord(rule) && typeof rule.id === "string") weightIds.add(rule.id);
    }
  }

  const seen = new Set<string>();
  const unsafeIds = new Set<string>();
  for (const [index, rawEntry] of dataset.mapped.entries()) {
    const path = `mapped[${index}]`;
    if (!isRecord(rawEntry)) {
      issues.push({ code: "invalid_dataset", message: `${path} must be an object.`, path });
      continue;
    }
    const id = typeof rawEntry.id === "string" ? rawEntry.id.trim() : "";
    const idForIssue = id || undefined;
    if (!id) {
      issues.push({ code: "empty_id", message: `${path}.id must not be empty.`, path: `${path}.id` });
      unsafeIds.add(`@${index}`);
    } else if (seen.has(id)) {
      issues.push({ code: "duplicate_id", message: `Duplicate UMU programme id: ${id}.`, programmeId: id, path: `${path}.id` });
      unsafeIds.add(id);
    } else {
      seen.add(id);
    }

    if (typeof rawEntry.level !== "string" || !levels.includes(rawEntry.level)) {
      issues.push({ code: "invalid_level", message: `Unsupported programme level ${String(rawEntry.level)} for ${id || path}.`, programmeId: idForIssue, path: `${path}.level` });
      if (id) unsafeIds.add(id);
    }
    const entryRules = Array.isArray(rawEntry.rules) ? rawEntry.rules : [];
    if (!Array.isArray(rawEntry.rules)) {
      issues.push({ code: "invalid_rules", message: `${path}.rules must be an array.`, programmeId: idForIssue, path: `${path}.rules` });
      if (id) unsafeIds.add(id);
    }
    const primaryCount = entryRules.filter((r) => isRecord(r) && r.role === "primary").length;
    if (entryRules.length > 0 && primaryCount !== 1) {
      issues.push({
        code: primaryCount === 0 ? "missing_primary" : "multiple_primary",
        message: `${id || path} has ${primaryCount} primary mappings; exactly one is required when mapped.`,
        programmeId: idForIssue,
        path: `${path}.rules`,
      });
      if (id) unsafeIds.add(id);
    }
    if (rawEntry.needs_review === true) {
      issues.push({ code: "needs_review", message: `${id || path} is marked needs_review and cannot be used as a rule mapping.`, programmeId: idForIssue, path });
      if (id) unsafeIds.add(id);
    }
    entryRules.forEach((rawRule, ruleIndex) => {
      const rulePath = `${path}.rules[${ruleIndex}]`;
      if (!isRecord(rawRule)) {
        issues.push({ code: "invalid_rules", message: `${rulePath} must be an object.`, programmeId: idForIssue, path: rulePath });
        if (id) unsafeIds.add(id);
        return;
      }
      if (typeof rawRule.rule !== "string" || !weightIds.has(rawRule.rule)) {
        const missingId = typeof rawRule.rule === "string" ? rawRule.rule : String(rawRule.rule);
        issues.push({ code: "unknown_rule", message: `Unknown programme weight rule ${missingId} for ${id || path}.`, programmeId: idForIssue, ruleId: missingId, path: `${rulePath}.rule` });
        if (id) unsafeIds.add(id);
      }
      if (typeof rawRule.role !== "string" || !roles.includes(rawRule.role)) {
        issues.push({ code: "invalid_role", message: `Invalid mapping role ${String(rawRule.role)}; expected primary or alternate.`, programmeId: idForIssue, path: `${rulePath}.role` });
        if (id) unsafeIds.add(id);
      }
      if (typeof rawRule.match !== "string" || !matches.includes(rawRule.match)) {
        issues.push({ code: "invalid_match", message: `Invalid match value ${String(rawRule.match)}; expected exact, close, or partial.`, programmeId: idForIssue, path: `${rulePath}.match` });
        if (id) unsafeIds.add(id);
      }
      if (rawRule.match === "partial") {
        issues.push({ code: "needs_review", message: `Partial mapping ${String(rawRule.rule)} for ${id || path} requires review.`, programmeId: idForIssue, ruleId: typeof rawRule.rule === "string" ? rawRule.rule : undefined, path: `${rulePath}.match` });
        if (id) unsafeIds.add(id);
      }
    });
  }

  const usableMappings: UsableProgrammeMapping[] = [];
  for (const rawEntry of dataset.mapped) {
    if (!isRecord(rawEntry)) continue;
    const id = typeof rawEntry.id === "string" ? rawEntry.id.trim() : "";
    if (!id || unsafeIds.has(id) || !levels.includes(String(rawEntry.level))) continue;
    const rules = Array.isArray(rawEntry.rules) ? rawEntry.rules : [];
    if (rules.length === 0 || rules.some((r) => !isRecord(r) || typeof r.rule !== "string" || !weightIds.has(r.rule) || !roles.includes(String(r.role)) || !matches.includes(String(r.match)) || r.match === "partial")) continue;
    usableMappings.push({
      id,
      umu_programme: typeof rawEntry.umu_programme === "string" ? rawEntry.umu_programme : "",
      level: rawEntry.level as ProgrammeLevel,
      rules: rules as ProgrammeRuleReference[],
      note: typeof rawEntry.note === "string" ? rawEntry.note : undefined,
      meta: isRecord(dataset.meta) ? dataset.meta : undefined,
      approvalStatus: isRecord(dataset.meta) ? dataset.meta.status : undefined,
      needsReview: false,
      officiallyApproved: false,
    });
  }
  return { valid: issues.length === 0, issues, usableMappings };
}

/** Registry wrapper with validation issues and safe id lookup for future service/RPC use. */
export function createProgrammeMappingRegistry(dataset: unknown, weights: unknown) {
  const validation = validateProgrammeMappings(dataset, weights);
  const byId = new Map(validation.usableMappings.map((mapping) => [mapping.id, mapping]));
  return {
    meta: isRecord(dataset) && isRecord(dataset.meta) ? dataset.meta : undefined,
    issues: validation.issues,
    valid: validation.valid,
    listUsable: () => [...validation.usableMappings],
    getById: (umuProgrammeId: string) => byId.get(umuProgrammeId),
    getIssuesById: (umuProgrammeId: string) => validation.issues.filter((issue) => issue.programmeId === umuProgrammeId),
  };
}
