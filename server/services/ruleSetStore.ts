import { z } from "zod";
import type { ruleSets } from "../../drizzle/schema";
import type { RuleSet } from "../rules-engine";
import { compileFileRuleSet, programmeCatalogue, type StoredRuleSet } from "./screeningService";

export type RuleSetRow = typeof ruleSets.$inferSelect;
export type RuleSetInsert = typeof ruleSets.$inferInsert;

export const SEED_VERSION = "2026-27.1";
export const SEED_EFFECTIVE_FROM = "2026-08-01";

// ---------- content validation ----------
const classification = z.enum(["DISTINCTION", "CREDIT", "PASS", "FIRST_CLASS", "SECOND_CLASS", "PASS_CLASS"]);
const rule = z.discriminatedUnion("type", [
  z.object({ id: z.string().min(1), type: z.literal("MIN_PRINCIPAL_PASSES"), count: z.number().int().min(0), sameSitting: z.boolean() }),
  z.object({ id: z.string().min(1), type: z.literal("MIN_SUBSIDIARY_PASSES"), count: z.number().int().min(0) }),
  z.object({ id: z.string().min(1), type: z.literal("MIN_UCE_PASSES"), count: z.number().int().min(0), sameSitting: z.boolean() }),
  z.object({ id: z.string().min(1), type: z.literal("HAS_UCE_RESULTS") }),
  z.object({
    id: z.string().min(1), type: z.literal("QUALIFICATION_CLASS_AT_LEAST"),
    qualification: z.enum(["DIPLOMA", "CERTIFICATE", "HEAC"]), accepted: z.array(classification).min(1),
    label: z.string().min(1), requireRelated: z.boolean(),
  }),
  z.object({ id: z.string().min(1), type: z.literal("SUBJECTS_RELEVANT_TO_PROGRAMME") }),
  z.object({ id: z.string().min(1), type: z.literal("MATHS_CREDIT_REQUIREMENT") }),
  z.object({ id: z.string().min(1), type: z.literal("OLEVEL_OVERALL_GRADE_NOT_IN"), grades: z.array(z.string().min(1)).min(1) }),
]);

export const ruleSetContentSchema = z.object({
  programmeName: z.string().min(1),
  level: z.enum(["bachelors", "diploma", "certificate", "higher_education_certificate"]),
  routes: z.array(z.object({ id: z.string().min(1), rules: z.array(rule).min(1) })).min(1),
  documents: z.object({ common: z.array(z.string()), byRoute: z.record(z.string(), z.array(z.string())) }),
  weighting: z.object({
    ruleId: z.string(),
    system: z.object({ category_weights: z.object({ essential: z.number(), relevant: z.number(), desirable: z.number() }), alevel_points: z.record(z.string(), z.number()) }),
    variants: z.array(z.object({ id: z.string(), essential: z.array(z.unknown()), relevant: z.array(z.unknown()), desirable: z.array(z.string()) })).min(1),
  }).optional(),
  notes: z.array(z.string()).default([]),
});
export type RuleSetContent = z.infer<typeof ruleSetContentSchema>;

/** Returns readable problems with proposed rule content, or an empty list when it can be screened. */
export function validateRuleSetContent(content: unknown): string[] {
  const parsed = ruleSetContentSchema.safeParse(content);
  if (parsed.success) return [];
  return parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.join(".") || "rules"}: ${issue.message}`);
}

// ---------- approval ----------
export function approvalLine(row: Pick<RuleSetRow, "approvalStatus" | "approvedBy" | "approvalReference"> & { approvalNote?: string | null }): string {
  if (row.approvalStatus === "approved") return `Approved by ${row.approvedBy ?? "UMU"}${row.approvalReference ? ` (${row.approvalReference})` : ""}`;
  if (row.approvalStatus === "rejected") return `Rejected by UMU${row.approvalNote ? `: ${row.approvalNote}` : ""}`;
  return "Pending UMU admissions approval";
}

// ---------- in-use selection ----------
export function isInUse(row: RuleSetRow, today: string): boolean {
  return (
    row.activatedAt !== null &&
    row.approvalStatus !== "rejected" &&
    row.status !== "needs-review" &&
    row.effectiveFrom <= today &&
    (!row.effectiveTo || row.effectiveTo > today)
  );
}

/** For each programme, the latest effective activated version that has not been rejected. */
export function selectInUse(rows: RuleSetRow[], today: string): Map<string, RuleSetRow> {
  const best = new Map<string, RuleSetRow>();
  for (const row of rows) {
    if (!isInUse(row, today)) continue;
    const current = best.get(row.programmeId);
    if (!current || row.effectiveFrom > current.effectiveFrom || (row.effectiveFrom === current.effectiveFrom && row.createdAt > current.createdAt)) best.set(row.programmeId, row);
  }
  return best;
}

export function ruleSetFromRow(row: RuleSetRow): RuleSet | null {
  const parsed = ruleSetContentSchema.safeParse(row.rules);
  if (!parsed.success) return null;
  const content = parsed.data;
  return {
    programmeId: row.programmeId,
    programmeName: content.programmeName,
    level: content.level,
    meta: {
      id: row.id,
      status: row.status === "needs-review" ? "assumed" : row.status,
      source: row.source,
      edition: row.edition,
      approval: approvalLine(row),
    },
    routes: content.routes,
    documents: content.documents,
    ...(content.weighting ? { weighting: content.weighting as unknown as RuleSet["weighting"] } : {}),
    notes: content.notes,
  } as RuleSet;
}

export function toStored(row: RuleSetRow): StoredRuleSet | undefined {
  const ruleSet = ruleSetFromRow(row);
  return ruleSet ? { recordId: row.id, ruleSet, approvalStatus: row.approvalStatus } : undefined;
}

/** The lookup screening uses: programme id to its in-use stored rule set. */
export function storedLookup(rows: RuleSetRow[], today: string): (programmeId: string) => StoredRuleSet | undefined {
  const inUse = selectInUse(rows, today);
  const cache = new Map<string, StoredRuleSet | undefined>();
  return (programmeId) => {
    if (!cache.has(programmeId)) {
      const row = inUse.get(programmeId);
      cache.set(programmeId, row ? toStored(row) : undefined);
    }
    return cache.get(programmeId);
  };
}

export function ruleContent(ruleSet: RuleSet): Record<string, unknown> {
  return {
    programmeName: ruleSet.programmeName,
    level: ruleSet.level,
    routes: ruleSet.routes,
    documents: ruleSet.documents,
    ...(ruleSet.weighting ? { weighting: ruleSet.weighting } : {}),
    notes: ruleSet.notes,
  };
}

export function ruleSetRecordId(programmeId: string, version: string): string {
  return `${programmeId}@${version}`;
}

/**
 * The first rule set for every screenable programme, compiled from the data files.
 * Rules published by UMU (the brochure's general entry rules) are recorded as approved.
 * Adopted rules start pending until UMU confirms them.
 */
export function buildSeedRows(now: Date, actorUserId: number | null): RuleSetInsert[] {
  return programmeCatalogue.filter((programme) => programme.screenable).map((programme) => {
    const ruleSet = compileFileRuleSet(programme.id);
    const official = ruleSet.meta.status === "official";
    const base = {
      id: ruleSetRecordId(programme.id, SEED_VERSION),
      programmeId: programme.id,
      version: SEED_VERSION,
      effectiveFrom: SEED_EFFECTIVE_FROM,
      status: ruleSet.meta.status,
      source: ruleSet.meta.source,
      edition: ruleSet.meta.edition ?? "2026/2027",
      approvalStatus: official ? ("approved" as const) : ("pending" as const),
      approvedBy: official ? "Uganda Martyrs University (published brochure)" : null,
      approvalReference: official ? "Courses at UMU 2026-2027, p.12 General Entry Requirements" : null,
      approvedAt: official ? now : null,
      approvalRecordedBy: official ? actorUserId : null,
      activatedAt: now,
      activatedBy: actorUserId,
      rules: ruleContent(ruleSet),
      updatedBy: actorUserId,
    };
    return { ...base, approval: approvalLine(base) };
  });
}
