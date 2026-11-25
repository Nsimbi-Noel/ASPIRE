import { and, desc, eq, inArray, isNotNull, ne, or, sql, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  advisoryOutputs,
  applicantDocuments,
  applicantQualifications,
  applicationProgrammes,
  applications,
  appeals,
  auditEvents,
  committeeDecisions,
  examResults,
  faculties,
  notifications,
  ruleSets,
  screeningRuns,
  users,
} from "../../drizzle/schema";
import { getDb, getUserByEmail } from "../db";
import { fileStore } from "../storage";
import { generateTemporaryPassword, hashPassword } from "../services/passwords";
import { loadApplicationForActor } from "../services/applicationAccess";
import { buildEngineApplicant, compileFileRuleSet, facultyOfProgramme, getProgrammeById, listFaculties, listProgrammes, mappingProposalSummary, screenAllProgrammes, screenProgramme } from "../services/screeningService";
import { ASPIRE_ROLES, applicationVisibility, canSeeFaculty, decisionVisibility, redactDecisionForApplicant, redactHistory, roleOf, runVisibility, scopeOf, validateRoleAssignment, type ActorUser, type AspireRole, type Scope } from "../services/access";
import { MAX_PROGRAMME_CHOICES, planProgrammeChoices } from "../services/programmeChoices";
import { approvalLine, buildSeedRows, isInUse, ruleContent, ruleSetFromRow, ruleSetRecordId, storedLookup, validateRuleSetContent } from "../services/ruleSetStore";
import { detectApplicantAnomalies } from "../services/anomalies";
import { assessCommitteeDecision } from "../services/committeeDecisionPolicy";
import { parseResultsCsv } from "../services/resultsCsv";
import { extractDocument } from "../services/documentExtraction";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

const appRoleValues = ASPIRE_ROLES;

function allowRoles(...allowed: AspireRole[]) {
  return protectedProcedure.use(({ ctx, next }) => {
    const role = roleOf(ctx.user!);
    if (!allowed.includes(role)) throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission for this ASPIRE action." });
    return next({ ctx: { ...ctx, aspireRole: role } });
  });
}

const staff = allowRoles("faculty_administrator", "registrar");
const registrar = allowRoles("registrar");
const applicantOrStaff = allowRoles("applicant", "faculty_administrator", "registrar");
const applicantOrRegistrar = allowRoles("applicant", "registrar");

async function database() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "ASPIRE database is unavailable." });
  return db;
}
type Db = Awaited<ReturnType<typeof database>>;

const everything = sql`1 = 1`;
const appFilter = (db: Db, scope: Scope): SQL => applicationVisibility(db, scope) ?? everything;
const runFilter = (scope: Scope): SQL => runVisibility(scope) ?? everything;
const decisionFilter = (scope: Scope): SQL => decisionVisibility(scope) ?? everything;
const today = () => new Date().toISOString().slice(0, 10);

/** Loads an application only if the actor may see it. Out-of-scope cases are reported as not found. */
async function applicationForActor(applicationId: string, user: ActorUser) {
  const db = await database();
  const found = await loadApplicationForActor(db, applicationId, user);
  if (!found) throw new TRPCError({ code: "NOT_FOUND", message: "Application not found." });
  return { db, application: found.application, scope: found.scope };
}

/** A faculty administrator must not learn of choices in other faculties. */
function redactApplication<T extends { requestedProgrammeId: string | null }>(row: T, scope: Scope): T {
  if (scope.kind === "faculty" && row.requestedProgrammeId && facultyOfProgramme(row.requestedProgrammeId) !== scope.facultyId) return { ...row, requestedProgrammeId: null };
  return row;
}

async function writeAudit(input: {
  actorUserId: number | null;
  action: string;
  entityType: string;
  entityId: string;
  reason?: string;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
}) {
  const db = await database();
  await db.insert(auditEvents).values({
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    reason: input.reason ?? null,
    beforeData: input.beforeData ?? null,
    afterData: input.afterData ?? null,
  });
}

/**
 * Staff who should hear about an application: the faculty administrators of the faculties it has a submitted
 * choice in. With no submitted choice yet, only registrars can see it, so they are notified instead.
 */
async function staffRecipients(db: Db, applicationId: string): Promise<number[]> {
  const choices = await db.select({ facultyId: applicationProgrammes.facultyId }).from(applicationProgrammes).where(and(eq(applicationProgrammes.applicationId, applicationId), eq(applicationProgrammes.status, "submitted")));
  const facultyIds = [...new Set(choices.map((row) => row.facultyId))];
  const rows = facultyIds.length
    ? await db.select({ id: users.id }).from(users).where(and(eq(users.aspireRole, "faculty_administrator"), eq(users.isActive, true), inArray(users.facultyId, facultyIds)))
    : await db.select({ id: users.id }).from(users).where(and(eq(users.isActive, true), or(eq(users.aspireRole, "registrar"), eq(users.role, "admin"))));
  return rows.map((row) => row.id);
}

async function notifyStaff(applicationId: string, title: string, message: string) {
  const db = await database();
  const recipients = await staffRecipients(db, applicationId);
  if (recipients.length) await db.insert(notifications).values(recipients.map((id) => ({ recipientUserId: id, applicationId, title, message })));
}

/** The rule sets in use for screening: stored versions that are activated, effective today and not rejected. */
async function ruleLookup(db: Db) {
  const rows = await db.select().from(ruleSets).where(isNotNull(ruleSets.activatedAt));
  return storedLookup(rows, today());
}

/** Replaces an application's programme choices with the given ordered list. First choice becomes the requested programme. */
async function syncChoices(db: Db, applicationId: string, desired: string[]) {
  const wanted = [...new Set(desired)];
  for (const programmeId of wanted) {
    const programme = getProgrammeById(programmeId);
    if (!programme) throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown programme: ${programmeId}.` });
    if (!programme.facultyId) throw new TRPCError({ code: "BAD_REQUEST", message: `${programme.name} cannot be chosen: select an individual programme.` });
  }
  const existing = await db.select().from(applicationProgrammes).where(eq(applicationProgrammes.applicationId, applicationId));
  let plan;
  try { plan = planProgrammeChoices(existing.map((row) => ({ programmeId: row.programmeId, status: row.status, choiceRank: row.choiceRank })), wanted); }
  catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Invalid programme choices." }); }
  for (const item of plan.upserts) {
    const facultyId = getProgrammeById(item.programmeId)!.facultyId!;
    const found = existing.find((row) => row.programmeId === item.programmeId);
    if (found) await db.update(applicationProgrammes).set({ choiceRank: item.choiceRank, status: "submitted", facultyId }).where(eq(applicationProgrammes.id, found.id));
    else await db.insert(applicationProgrammes).values({ applicationId, programmeId: item.programmeId, facultyId, choiceRank: item.choiceRank, status: "submitted" });
  }
  for (const programmeId of plan.withdraw) await db.update(applicationProgrammes).set({ status: "withdrawn" }).where(and(eq(applicationProgrammes.applicationId, applicationId), eq(applicationProgrammes.programmeId, programmeId)));
  await db.update(applications).set({ requestedProgrammeId: wanted[0] ?? null }).where(eq(applications.id, applicationId));
  return plan;
}

async function getApplicantEngineInput(applicationId: string) {
  const db = await database();
  const [results, qualifications, documents] = await Promise.all([
    db.select().from(examResults).where(and(eq(examResults.applicationId, applicationId), eq(examResults.active, true))),
    db.select().from(applicantQualifications).where(and(eq(applicantQualifications.applicationId, applicationId), eq(applicantQualifications.active, true))),
    db.select().from(applicantDocuments).where(eq(applicantDocuments.applicationId, applicationId)),
  ]);
  return {
    results,
    qualifications,
    documents,
    applicant: buildEngineApplicant({
      id: applicationId,
      results: results.map((row) => ({ exam: row.exam, subject: row.subject, grade: row.grade, subjectLevel: row.subjectLevel, sitting: row.sitting })),
      qualifications: qualifications.map((row) => ({ qualificationType: row.qualificationType, classification: row.classification, relatedToProgramme: row.relatedToProgramme })),
      documentTypes: documents.filter((row) => row.status === "verified").map((row) => row.documentType),
    }),
  };
}

async function persistCurrentScreening(applicationId: string, actorUserId: number) {
  const db = await database();
  const applicationRows = await db.select().from(applications).where(eq(applications.id, applicationId)).limit(1);
  const application = applicationRows[0];
  if (!application) throw new TRPCError({ code: "NOT_FOUND", message: "Application not found." });
  const engineInput = await getApplicantEngineInput(applicationId);
  const sameIntakeRows = await db.select({ id: applications.id }).from(applications).where(and(eq(applications.applicantUserId, application.applicantUserId), eq(applications.intake, application.intake)));
  const anomalyFlags = detectApplicantAnomalies(engineInput.results, sameIntakeRows.length);
  const results = screenAllProgrammes(engineInput.applicant, await ruleLookup(db));
  const snapshot = {
    application: { id: application.id, reference: application.reference, applicantName: application.applicantName, intake: application.intake, level: application.level, requestedProgrammeId: application.requestedProgrammeId, status: application.status, documentDeadline: application.documentDeadline, updatedAt: application.updatedAt },
    results: engineInput.results.map(({ id: _id, applicationId: _appId, createdAt: _createdAt, ...row }) => row),
    qualifications: engineInput.qualifications.map(({ id: _id, applicationId: _appId, createdAt: _createdAt, ...row }) => row),
    documentTypes: engineInput.applicant.documents,
    anomalyFlags,
  };
  if (results.length) await db.insert(screeningRuns).values(results.map((item) => ({
    applicationId,
    programmeId: item.mapping.id,
    programmeName: item.mapping.name,
    outcome: item.outcome,
    ruleSetVersion: item.result.ruleSet.id,
    ruleStatus: item.mappingReviewRequired ? "needs-review" as const : item.result.ruleSet.status,
    ruleSetRecordId: item.ruleSetRecordId,
    facultyId: item.mapping.facultyId,
    inputSnapshot: snapshot,
    resultTrace: { ...item.result, outcome: item.outcome, mapping: item.mapping, mappingReviewRequired: item.mappingReviewRequired, ruleApproval: item.ruleApproval, explanation: item.explanation, recommendation: item.recommendation ?? null, anomalyFlags, documentDeadline: application.documentDeadline },
  })));
  if (anomalyFlags.length) await db.insert(advisoryOutputs).values({ applicationId, kind: "anomaly", status: "review_required", modelVersion: "deterministic-anomaly-v1", value: { flags: anomalyFlags, source: "applicant results and same-intake application count" } });
  if (application.status === "submitted" || application.status === "in_review") await db.update(applications).set({ status: "in_review" }).where(eq(applications.id, applicationId));
  const held = results.filter((result) => result.outcome === "ON_HOLD");
  if (held.length) {
    const deadline = application.documentDeadline ? ` Please submit any outstanding evidence by ${application.documentDeadline.toLocaleDateString("en-GB", { timeZone: "UTC" })}.` : "";
    const message = `Admissions is reviewing your application.${deadline} You will be contacted directly if anything else is needed.`;
    const previous = await db.select({ message: notifications.message }).from(notifications).where(and(eq(notifications.applicationId, applicationId), eq(notifications.recipientUserId, application.applicantUserId), eq(notifications.title, "Application update"))).orderBy(desc(notifications.createdAt)).limit(1);
    if (previous[0]?.message !== message) await db.insert(notifications).values({ recipientUserId: application.applicantUserId, applicationId, title: "Application update", message });
  }
  await writeAudit({ actorUserId, action: "screening_run", entityType: "application", entityId: applicationId, afterData: {
    programmesScreened: results.length,
    outcomes: { eligible: results.filter((r) => r.outcome === "ELIGIBLE").length, notEligible: results.filter((r) => r.outcome === "NOT_ELIGIBLE").length, onHold: results.filter((r) => r.outcome === "ON_HOLD").length },
    anomalyFlags: anomalyFlags.map((flag) => flag.code),
  } });
  return { results, anomalyFlags };
}

const resultSchema = z.object({
  exam: z.enum(["UCE", "UACE"]),
  subject: z.string().trim().min(2).max(120),
  grade: z.string().trim().min(1).max(20),
  subjectLevel: z.enum(["PRINCIPAL", "SUBSIDIARY"]).optional(),
  sitting: z.string().trim().regex(/^(19|20)\d{2}$/, "Enter a four-digit exam year."),
}).superRefine((row, ctx) => {
  const grade = row.grade.toUpperCase();
  const uce = new Set(["D1", "D2", "C3", "C4", "C5", "C6", "P7", "P8", "F9"]);
  const principal = new Set(["A", "B", "C", "D", "E", "O", "F"]);
  if (row.exam === "UCE" && (!uce.has(grade) || row.subjectLevel !== undefined)) ctx.addIssue({ code: "custom", path: ["grade"], message: "UCE requires a grade D1–F9 and no subject level." });
  if (row.exam === "UACE" && row.subjectLevel === undefined) ctx.addIssue({ code: "custom", path: ["subjectLevel"], message: "Choose PRINCIPAL or SUBSIDIARY for each UACE result." });
  if (row.exam === "UACE" && row.subjectLevel === "PRINCIPAL" && !principal.has(grade)) ctx.addIssue({ code: "custom", path: ["grade"], message: "UACE principal grades must be A, B, C, D, E, O or F." });
  if (row.exam === "UACE" && row.subjectLevel === "SUBSIDIARY" && !uce.has(grade)) ctx.addIssue({ code: "custom", path: ["grade"], message: "UACE subsidiary grades must be D1–F9." });
});

function makeReference() {
  return `AS-${new Date().getFullYear()}-${nanoid(7).toUpperCase()}`;
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export const aspireRouter = router({
  profile: router({
    me: protectedProcedure.query(async ({ ctx }) => {
      const db = await database();
      let facultyName: string | null = null;
      if (ctx.user!.facultyId) {
        const found = await db.select({ name: faculties.name }).from(faculties).where(eq(faculties.id, ctx.user!.facultyId)).limit(1);
        facultyName = found[0]?.name ?? null;
      }
      return {
        id: ctx.user!.id,
        name: ctx.user!.name,
        email: ctx.user!.email,
        role: roleOf(ctx.user!),
        facultyId: ctx.user!.facultyId ?? null,
        facultyName,
      };
    }),
    /** Registrar only. A faculty administrator must be given a faculty; nobody else may have one. */
    setRole: registrar.input(z.object({
      userId: z.number().int().positive(),
      role: z.enum(appRoleValues),
      facultyId: z.string().max(80).nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      const db = await database();
      const found = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      const target = found[0];
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
      if (target.role === "admin" && input.role !== "registrar") throw new TRPCError({ code: "FORBIDDEN", message: "The project owner account must stay a registrar." });
      let facultyExists = false;
      if (input.facultyId) {
        const faculty = await db.select({ id: faculties.id }).from(faculties).where(eq(faculties.id, input.facultyId)).limit(1);
        facultyExists = !!faculty[0];
      }
      const problem = validateRoleAssignment({ role: input.role, facultyId: input.facultyId }, facultyExists);
      if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
      const targetIsRegistrar = target.role === "admin" || target.aspireRole === "registrar";
      if (targetIsRegistrar && input.role !== "registrar") {
        const others = await db.select({ id: users.id }).from(users).where(and(eq(users.isActive, true), or(eq(users.aspireRole, "registrar"), eq(users.role, "admin")), ne(users.id, input.userId))).limit(1);
        if (!others[0]) throw new TRPCError({ code: "FORBIDDEN", message: "There must always be at least one registrar." });
      }
      const facultyId = input.role === "faculty_administrator" ? input.facultyId! : null;
      const before = { aspireRole: target.aspireRole, facultyId: target.facultyId };
      await db.update(users).set({ aspireRole: input.role, facultyId }).where(eq(users.id, input.userId));
      await writeAudit({ actorUserId: ctx.user!.id, action: "user_role_changed", entityType: "user", entityId: String(input.userId), reason: "Registrar role assignment", beforeData: before, afterData: { aspireRole: input.role, facultyId } });
      return { success: true };
    }),
  }),

  catalog: router({
    /** Applicant-facing programme names only: no rule identifiers, mapping status or approval data. */
    choices: protectedProcedure.query(async () => {
      return listProgrammes()
        .filter((programme) => programme.facultyId)
        .map((programme) => ({ id: programme.id, name: programme.name, level: programme.level, facultyId: programme.facultyId! }));
    }),
    list: staff.query(async () => {
      const db = await database();
      const rows = await db.select().from(ruleSets).where(eq(ruleSets.status, "adopted-proxy"));
      const latest = new Map<string, (typeof rows)[number]>();
      for (const row of rows) {
        const current = latest.get(row.programmeId);
        if (!current || row.createdAt > current.createdAt || (row.createdAt === current.createdAt && row.effectiveFrom > current.effectiveFrom)) latest.set(row.programmeId, row);
      }
      return listProgrammes().map((programme) => {
        const row = latest.get(programme.id);
        return row ? { ...programme, approval: approvalLine(row), ruleApprovalStatus: row.approvalStatus } : programme;
      });
    }),
    faculties: protectedProcedure.query(() => listFaculties()),
    mappingSummary: registrar.query(async () => {
      const summary = mappingProposalSummary();
      const db = await database();
      const rows = await db.select({ approvalStatus: ruleSets.approvalStatus, approvedBy: ruleSets.approvedBy }).from(ruleSets).where(eq(ruleSets.status, "adopted-proxy"));
      const allApproved = rows.length > 0 && rows.every((row) => row.approvalStatus === "approved");
      return allApproved ? { ...summary, approval: `Approved by ${rows.find((row) => row.approvedBy)?.approvedBy ?? "UMU"}` } : summary;
    }),
  }),

  /**
   * Rule sets are versioned. Content is never edited: publish a new version instead.
   * A version is used for screening once activated; an admit decision needs UMU's approval to be recorded.
   */
  rules: router({
    list: registrar.query(async () => {
      const db = await database();
      const rows = await db.select().from(ruleSets).orderBy(desc(ruleSets.createdAt)).limit(500);
      const now = today();
      return rows.map((row) => ({ ...row, inUse: isInUse(row, now) }));
    }),
    proxyStatus: staff.query(async () => {
      const db = await database();
      const rows = await db.select({ approvalStatus: ruleSets.approvalStatus }).from(ruleSets).where(eq(ruleSets.status, "adopted-proxy"));
      const count = (status: "pending" | "approved" | "rejected") => rows.filter((row) => row.approvalStatus === status).length;
      return { total: rows.length, approved: count("approved"), pending: count("pending"), rejected: count("rejected") };
    }),
    /** The rules currently used for a programme, as editable content for a new version. */
    current: registrar.input(z.object({ programmeId: z.string().min(1) })).query(async ({ input }) => {
      const programme = getProgrammeById(input.programmeId);
      if (!programme?.screenable) throw new TRPCError({ code: "BAD_REQUEST", message: "That programme is not screened automatically." });
      const db = await database();
      const stored = (await ruleLookup(db))(input.programmeId);
      return { recordId: stored?.recordId ?? null, content: ruleContent(stored?.ruleSet ?? compileFileRuleSet(input.programmeId)) };
    }),
    /** Creates the first version for every screenable programme from the data files. Safe to repeat. */
    seedFromFiles: registrar.mutation(async ({ ctx }) => {
      const db = await database();
      const seed = buildSeedRows(new Date(), ctx.user!.id);
      const existing = new Set((await db.select({ id: ruleSets.id }).from(ruleSets)).map((row) => row.id));
      const fresh = seed.filter((row) => !existing.has(row.id!));
      if (fresh.length) await db.insert(ruleSets).values(fresh);
      await writeAudit({ actorUserId: ctx.user!.id, action: "rule_sets_seeded", entityType: "ruleset", entityId: "seed", afterData: { created: fresh.length, skipped: seed.length - fresh.length } });
      return { created: fresh.length, skipped: seed.length - fresh.length };
    }),
    propose: registrar.input(z.object({
      programmeId: z.string().trim().min(1).max(60),
      version: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9._-]+$/, "Use letters, numbers, dots, dashes or underscores."),
      effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD."),
      source: z.string().trim().min(5).max(2000),
      edition: z.string().trim().min(1).max(40),
      /** Provenance of the rules. A proposal cannot claim to be official: only UMU publishes official rules. */
      status: z.enum(["adopted-proxy", "assumed"]).default("assumed"),
      rules: z.record(z.string(), z.unknown()),
    })).mutation(async ({ ctx, input }) => {
      const programme = getProgrammeById(input.programmeId);
      if (!programme) throw new TRPCError({ code: "NOT_FOUND", message: "Programme ID is not in the current catalogue." });
      if (!programme.screenable) throw new TRPCError({ code: "BAD_REQUEST", message: "That programme is not screened automatically." });
      if (JSON.stringify(input.rules).length > 100_000) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Rule proposal is limited to 100 KB." });
      const problems = validateRuleSetContent(input.rules);
      if (problems.length) throw new TRPCError({ code: "BAD_REQUEST", message: `The rules cannot be screened: ${problems.join("; ")}` });
      if ((input.rules as { level?: string }).level !== programme.level) throw new TRPCError({ code: "BAD_REQUEST", message: `The rules' level must match the programme's level (${programme.level}).` });
      const db = await database();
      const duplicate = await db.select({ id: ruleSets.id }).from(ruleSets).where(and(eq(ruleSets.programmeId, input.programmeId), eq(ruleSets.version, input.version))).limit(1);
      if (duplicate[0]) throw new TRPCError({ code: "CONFLICT", message: "That programme/version already exists. Create a new version instead of editing history." });
      const id = ruleSetRecordId(input.programmeId, input.version);
      await db.insert(ruleSets).values({ id, programmeId: input.programmeId, version: input.version, effectiveFrom: input.effectiveFrom, status: input.status, source: input.source, edition: input.edition, approvalStatus: "pending", approval: approvalLine({ approvalStatus: "pending", approvedBy: null, approvalReference: null }), rules: input.rules, updatedBy: ctx.user!.id });
      await writeAudit({ actorUserId: ctx.user!.id, action: "rule_version_proposed", entityType: "ruleset", entityId: id, afterData: { programmeId: input.programmeId, version: input.version, effectiveFrom: input.effectiveFrom, status: input.status } });
      return { id, status: input.status, inUse: false };
    }),
    /** Puts a version into use for screening. It does not mean UMU has approved it. */
    activate: registrar.input(z.object({ ruleSetId: z.string().min(1), reason: z.string().trim().min(10).max(1000) })).mutation(async ({ ctx, input }) => {
      const db = await database();
      const rows = await db.select().from(ruleSets).where(eq(ruleSets.id, input.ruleSetId)).limit(1);
      const row = rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Rule set not found." });
      if (row.activatedAt) throw new TRPCError({ code: "CONFLICT", message: "This version is already activated." });
      if (row.approvalStatus === "rejected") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "A rejected version cannot be activated." });
      if (row.status === "needs-review" || !ruleSetFromRow(row)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This version's rules cannot be screened. Publish a corrected new version." });
      await db.update(ruleSets).set({ activatedAt: new Date(), activatedBy: ctx.user!.id, updatedBy: ctx.user!.id }).where(eq(ruleSets.id, input.ruleSetId));
      await writeAudit({ actorUserId: ctx.user!.id, action: "rule_version_activated", entityType: "ruleset", entityId: input.ruleSetId, reason: input.reason, afterData: { programmeId: row.programmeId, version: row.version } });
      return { success: true };
    }),
    /** Ends a version's use from a date. History is kept. */
    retire: registrar.input(z.object({ ruleSetId: z.string().min(1), effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().min(10).max(1000) })).mutation(async ({ ctx, input }) => {
      const db = await database();
      const rows = await db.select().from(ruleSets).where(eq(ruleSets.id, input.ruleSetId)).limit(1);
      const row = rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Rule set not found." });
      if (input.effectiveTo <= row.effectiveFrom) throw new TRPCError({ code: "BAD_REQUEST", message: "The end date must be after the version's start date." });
      await db.update(ruleSets).set({ effectiveTo: input.effectiveTo, updatedBy: ctx.user!.id }).where(eq(ruleSets.id, input.ruleSetId));
      await writeAudit({ actorUserId: ctx.user!.id, action: "rule_version_retired", entityType: "ruleset", entityId: input.ruleSetId, reason: input.reason, beforeData: { effectiveTo: row.effectiveTo }, afterData: { effectiveTo: input.effectiveTo } });
      return { success: true };
    }),
    /** Records UMU's decision about a version. Only an approved version can support an admit decision. */
    recordApproval: registrar.input(z.object({
      ruleSetId: z.string().min(1),
      decision: z.enum(["approved", "rejected"]),
      approvedBy: z.string().trim().min(3).max(255),
      reference: z.string().trim().min(3).max(255).optional(),
      note: z.string().trim().min(5).max(1000).optional(),
    })).mutation(async ({ ctx, input }) => {
      if (input.decision === "approved" && !input.reference) throw new TRPCError({ code: "BAD_REQUEST", message: "Record the UMU reference (letter, minute or email) that confirms the approval." });
      if (input.decision === "rejected" && !input.note) throw new TRPCError({ code: "BAD_REQUEST", message: "Record why UMU rejected this version." });
      const db = await database();
      const rows = await db.select().from(ruleSets).where(eq(ruleSets.id, input.ruleSetId)).limit(1);
      const row = rows[0];
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Rule set not found." });
      if (row.status === "needs-review") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This legacy proposal has no usable rules. Publish a new version first." });
      const next = { approvalStatus: input.decision, approvedBy: input.approvedBy, approvalReference: input.reference ?? null, approvalNote: input.note ?? null };
      await db.update(ruleSets).set({ ...next, approval: approvalLine(next), approvedAt: new Date(), approvalRecordedBy: ctx.user!.id, updatedBy: ctx.user!.id }).where(eq(ruleSets.id, input.ruleSetId));
      await writeAudit({ actorUserId: ctx.user!.id, action: input.decision === "approved" ? "rule_version_approved" : "rule_version_rejected", entityType: "ruleset", entityId: input.ruleSetId, reason: input.note ?? input.reference, beforeData: { approvalStatus: row.approvalStatus, approvedBy: row.approvedBy }, afterData: { approvalStatus: input.decision, approvedBy: input.approvedBy, approvalReference: input.reference ?? null } });
      return { success: true, approval: approvalLine(next) };
    }),
  }),

  applications: router({
    list: applicantOrStaff.query(async ({ ctx }) => {
      const db = await database();
      const scope = scopeOf(ctx.user!);
      const rows = await db.select().from(applications).where(appFilter(db, scope)).orderBy(desc(applications.updatedAt)).limit(200);
      return rows.map((row) => redactApplication(row, scope));
    }),
    create: applicantOrRegistrar.input(z.object({
      applicantName: z.string().trim().min(2).max(255),
      intake: z.string().trim().min(4).max(20),
      level: z.enum(["bachelors", "diploma", "certificate", "higher_education_certificate"]),
      requestedProgrammeId: z.string().max(80).optional(),
    })).mutation(async ({ ctx, input }) => {
      const db = await database();
      if (input.requestedProgrammeId) {
        const programme = getProgrammeById(input.requestedProgrammeId);
        if (!programme?.facultyId) throw new TRPCError({ code: "BAD_REQUEST", message: "Choose an individual programme from the catalogue." });
      }
      const id = nanoid(24);
      const reference = makeReference();
      await db.insert(applications).values({
        id,
        reference,
        applicantUserId: ctx.user!.id,
        applicantName: input.applicantName,
        intake: input.intake,
        level: input.level,
        requestedProgrammeId: null,
        status: "draft",
      });
      if (input.requestedProgrammeId) await syncChoices(db, id, [input.requestedProgrammeId]);
      await writeAudit({ actorUserId: ctx.user!.id, action: "application_created", entityType: "application", entityId: id, afterData: { reference, intake: input.intake, level: input.level } });
      return { id, reference };
    }),
    get: applicantOrStaff.input(z.object({ id: z.string().min(1) })).query(async ({ ctx, input }) => {
      const { db, application, scope } = await applicationForActor(input.id, ctx.user!);
      const [results, qualifications, documents, runs, decisionRows, appealRows, history, choiceRows] = await Promise.all([
        db.select().from(examResults).where(and(eq(examResults.applicationId, input.id), eq(examResults.active, true))).orderBy(examResults.exam, examResults.subject),
        db.select().from(applicantQualifications).where(and(eq(applicantQualifications.applicationId, input.id), eq(applicantQualifications.active, true))),
        db.select().from(applicantDocuments).where(eq(applicantDocuments.applicationId, input.id)).orderBy(desc(applicantDocuments.createdAt)),
        db.select().from(screeningRuns).where(and(eq(screeningRuns.applicationId, input.id), runFilter(scope))).orderBy(desc(screeningRuns.createdAt), desc(screeningRuns.id)).limit(100),
        db.select().from(committeeDecisions).where(and(eq(committeeDecisions.applicationId, input.id), decisionFilter(scope))).orderBy(desc(committeeDecisions.decidedAt), desc(committeeDecisions.id)),
        db.select().from(appeals).where(eq(appeals.applicationId, input.id)).orderBy(desc(appeals.createdAt)),
        db.select().from(auditEvents).where(and(eq(auditEvents.entityType, "application"), eq(auditEvents.entityId, input.id))).orderBy(desc(auditEvents.createdAt)).limit(100),
        db.select().from(applicationProgrammes).where(eq(applicationProgrammes.applicationId, input.id)).orderBy(applicationProgrammes.choiceRank),
      ]);
      return {
        application: redactApplication(application, scope),
        results,
        qualifications,
        documents: documents.map(({ storageKey: _storageKey, ...doc }) => doc),
        // Applicants get a simple progress status from the application itself, never the screening trace.
        screenings: scope.kind === "own" ? [] : runs,
        // Applicants see the outcome and date of a decision, never the committee's reasoning.
        decisions: scope.kind === "own" ? decisionRows.map(redactDecisionForApplicant) : decisionRows,
        appeals: scope.kind === "own" ? appealRows.map(({ resolution: _resolution, resolvedBy: _resolvedBy, ...appeal }) => appeal) : appealRows,
        history: redactHistory(history, scope, ctx.user!.id, facultyOfProgramme),
        // A faculty administrator sees only the choices in their own faculty.
        choices: choiceRows
          .filter((row) => scope.kind !== "faculty" || row.facultyId === scope.facultyId)
          .map((row) => ({ programmeId: row.programmeId, facultyId: row.facultyId, choiceRank: row.choiceRank, status: row.status })),
      };
    }),
    /** Sets the programmes this application is for (at most five, in order of preference). */
    setProgrammeChoices: applicantOrRegistrar.input(z.object({
      id: z.string().min(1),
      programmeIds: z.array(z.string().min(1).max(80)).max(MAX_PROGRAMME_CHOICES),
    })).mutation(async ({ ctx, input }) => {
      const { db, application } = await applicationForActor(input.id, ctx.user!);
      if (application.status === "completed") throw new TRPCError({ code: "CONFLICT", message: "A completed application is locked; programme choices cannot change." });
      const before = (await db.select().from(applicationProgrammes).where(and(eq(applicationProgrammes.applicationId, input.id), eq(applicationProgrammes.status, "submitted"))).orderBy(applicationProgrammes.choiceRank)).map((row) => row.programmeId);
      const plan = await syncChoices(db, input.id, input.programmeIds);
      await writeAudit({ actorUserId: ctx.user!.id, action: "programme_choices_updated", entityType: "application", entityId: input.id, beforeData: { programmeIds: before }, afterData: { programmeIds: plan.upserts.map((item) => item.programmeId) } });
      if (application.status !== "draft") await notifyStaff(input.id, "Programme choices changed", `Application ${application.reference} changed its programme choices.`);
      return { success: true, choices: plan.upserts };
    }),
    updateProfile: applicantOrRegistrar.input(z.object({
      id: z.string().min(1),
      applicantName: z.string().trim().min(2).max(255),
      intake: z.string().trim().min(4).max(20),
      level: z.enum(["bachelors", "diploma", "certificate", "higher_education_certificate"]),
      requestedProgrammeId: z.string().max(80).nullable().optional(),
      submit: z.boolean().default(false),
    })).mutation(async ({ ctx, input }) => {
      const { db, application } = await applicationForActor(input.id, ctx.user!);
      if (application.status === "completed") throw new TRPCError({ code: "CONFLICT", message: "A completed application can only be changed through a staff correction workflow." });
      if (input.requestedProgrammeId) {
        // The requested programme becomes the first choice; any other choices keep their order.
        const existing = await db.select().from(applicationProgrammes).where(and(eq(applicationProgrammes.applicationId, input.id), eq(applicationProgrammes.status, "submitted"))).orderBy(applicationProgrammes.choiceRank);
        const others = existing.map((row) => row.programmeId).filter((id) => id !== input.requestedProgrammeId);
        await syncChoices(db, input.id, [input.requestedProgrammeId, ...others].slice(0, MAX_PROGRAMME_CHOICES));
      }
      if (input.submit) {
        const chosen = await db.select({ id: applicationProgrammes.id }).from(applicationProgrammes).where(and(eq(applicationProgrammes.applicationId, input.id), eq(applicationProgrammes.status, "submitted"))).limit(1);
        if (!chosen[0]) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Choose at least one programme before submitting, so the application reaches the right faculty." });
      }
      const status = input.submit ? "submitted" : application.status === "draft" ? "draft" : "submitted";
      await db.update(applications).set({
        applicantName: input.applicantName,
        intake: input.intake,
        level: input.level,
        status,
        ...(input.submit && !application.submittedAt ? { submittedAt: new Date() } : {}),
      }).where(eq(applications.id, input.id));
      await writeAudit({ actorUserId: ctx.user!.id, action: input.submit ? "application_submitted" : "application_profile_updated", entityType: "application", entityId: input.id, beforeData: { applicantName: application.applicantName, intake: application.intake, level: application.level }, afterData: { applicantName: input.applicantName, intake: input.intake, level: input.level, status } });
      if (input.submit) {
        await persistCurrentScreening(input.id, ctx.user!.id);
        if (roleOf(ctx.user!) === "applicant") await notifyStaff(input.id, "Application submitted", `Application ${application.reference} was submitted and screened. Please review its evidence and provisional-rule flags.`);
      }
      return { success: true, status };
    }),
    saveResults: applicantOrRegistrar.input(z.object({ id: z.string().min(1), results: z.array(resultSchema).max(80) })).mutation(async ({ ctx, input }) => {
      const { db, application } = await applicationForActor(input.id, ctx.user!);
      if (application.status === "completed") throw new TRPCError({ code: "CONFLICT", message: "A completed application cannot be edited directly." });
      const current = await db.select().from(examResults).where(and(eq(examResults.applicationId, input.id), eq(examResults.active, true)));
      await db.update(examResults).set({ active: false }).where(and(eq(examResults.applicationId, input.id), eq(examResults.active, true)));
      if (input.results.length) {
        await db.insert(examResults).values(input.results.map((row) => ({
          applicationId: input.id,
          exam: row.exam,
          subject: row.subject,
          grade: row.grade.toUpperCase(),
          subjectLevel: row.exam === "UACE" ? row.subjectLevel ?? "PRINCIPAL" : null,
          sitting: row.sitting,
          source: roleOf(ctx.user!) === "applicant" ? "applicant_entered" as const : "staff_entered" as const,
          confirmed: false,
          active: true,
        })));
      }
      await writeAudit({ actorUserId: ctx.user!.id, action: "results_updated", entityType: "application", entityId: input.id, reason: "Previous result rows retained as inactive; new submission recorded.", beforeData: { results: current.map(({ exam, subject, grade, subjectLevel, sitting, source, confirmed }) => ({ exam, subject, grade, subjectLevel, sitting, source, confirmed })) }, afterData: { results: input.results.map((row) => ({ ...row, grade: row.grade.toUpperCase() })) } });
      await persistCurrentScreening(input.id, ctx.user!.id);
      if (roleOf(ctx.user!) === "applicant") await notifyStaff(input.id, "Applicant results updated", `Results for application ${application.reference} were corrected; a new screening trace is available.`);
      await db.update(applications).set({ updatedAt: new Date() }).where(eq(applications.id, input.id));
      return { success: true, count: input.results.length };
    }),
    confirmOfficialResults: staff.input(z.object({ id: z.string().min(1), reviewNote: z.string().trim().min(10).max(1000) })).mutation(async ({ ctx, input }) => {
      const { db, application } = await applicationForActor(input.id, ctx.user!);
      if (application.status === "completed") throw new TRPCError({ code: "CONFLICT", message: "Reopen this completed case through the staff correction workflow before changing verification records." });
      const active = await db.select().from(examResults).where(and(eq(examResults.applicationId, input.id), eq(examResults.active, true)));
      if (!active.length) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "There are no active result rows to confirm." });
      const verifiedSlips = await db.select({ id: applicantDocuments.id, documentType: applicantDocuments.documentType }).from(applicantDocuments).where(and(eq(applicantDocuments.applicationId, input.id), eq(applicantDocuments.status, "verified")));
      if (!verifiedSlips.some((doc) => ["UCE_RESULT_SLIP", "UACE_RESULT_SLIP"].includes(doc.documentType))) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Verify an official UCE or UACE result-slip document before confirming marks." });
      await db.update(examResults).set({ confirmed: true }).where(and(eq(examResults.applicationId, input.id), eq(examResults.active, true)));
      await writeAudit({ actorUserId: ctx.user!.id, action: "official_results_confirmed", entityType: "application", entityId: input.id, reason: input.reviewNote, beforeData: { confirmedResultIds: active.filter((row) => row.confirmed).map((row) => row.id), unconfirmedCount: active.filter((row) => !row.confirmed).length }, afterData: { confirmedResultIds: active.map((row) => row.id), verificationSource: verifiedSlips.filter((doc) => ["UCE_RESULT_SLIP", "UACE_RESULT_SLIP"].includes(doc.documentType)).map((doc) => doc.id) } });
      await notifyStaff(input.id, "Official results confirmed", `Official examination results for ${application.reference} were human-verified. Review the case audit before recording any committee decision.`);
      return { success: true, confirmed: active.length };
    }),
    saveQualifications: applicantOrRegistrar.input(z.object({
      id: z.string().min(1),
      qualifications: z.array(z.object({
        qualificationType: z.enum(["DIPLOMA", "CERTIFICATE", "HEAC"]),
        classification: z.enum(["DISTINCTION", "CREDIT", "PASS", "FIRST_CLASS", "SECOND_CLASS", "PASS_CLASS"]),
        qualificationName: z.string().trim().min(2).max(255),
        institution: z.string().max(255).optional(),
        relatedToProgramme: z.boolean().nullable().optional(),
        completedYear: z.string().max(10).optional(),
      })).max(20),
    })).mutation(async ({ ctx, input }) => {
      const { db, application } = await applicationForActor(input.id, ctx.user!);
      if (application.status === "completed") throw new TRPCError({ code: "CONFLICT", message: "A completed application is locked. A staff member must reopen it after reviewing the appeal before qualifications can change." });
      const previous = await db.select().from(applicantQualifications).where(and(eq(applicantQualifications.applicationId, input.id), eq(applicantQualifications.active, true)));
      await db.update(applicantQualifications).set({ active: false }).where(and(eq(applicantQualifications.applicationId, input.id), eq(applicantQualifications.active, true)));
      if (input.qualifications.length) await db.insert(applicantQualifications).values(input.qualifications.map((row) => ({ ...row, applicationId: input.id, institution: row.institution ?? null, relatedToProgramme: row.relatedToProgramme ?? null, completedYear: row.completedYear ?? null, active: true })));
      await writeAudit({ actorUserId: ctx.user!.id, action: "qualifications_updated", entityType: "application", entityId: input.id, beforeData: { qualifications: previous.map((row) => ({ qualificationType: row.qualificationType, classification: row.classification, qualificationName: row.qualificationName, relatedToProgramme: row.relatedToProgramme })) }, afterData: { qualifications: input.qualifications.map((row) => ({ qualificationType: row.qualificationType, classification: row.classification, qualificationName: row.qualificationName, relatedToProgramme: row.relatedToProgramme })) } });
      await persistCurrentScreening(input.id, ctx.user!.id);
      if (roleOf(ctx.user!) === "applicant") await notifyStaff(input.id, "Applicant qualifications updated", `Qualifications for application ${application.reference} were updated and re-screened.`);
      await db.update(applications).set({ updatedAt: new Date() }).where(eq(applications.id, input.id));
      return { success: true };
    }),
  }),

  screening: router({
    run: staff.input(z.object({ applicationId: z.string().min(1) })).mutation(async ({ ctx, input }) => {
      const { application, scope } = await applicationForActor(input.applicationId, ctx.user!);
      if (application.status === "completed") throw new TRPCError({ code: "CONFLICT", message: "A completed case is locked. A staff member must reopen it before a new screening run." });
      const { results } = await persistCurrentScreening(input.applicationId, ctx.user!.id);
      // Every programme is screened, but a faculty administrator only receives their own faculty's results.
      return scope.kind === "faculty" ? results.filter((item) => item.mapping.facultyId === scope.facultyId) : results;
    }),
    one: staff.input(z.object({ applicationId: z.string().min(1), programmeId: z.string().min(1) })).mutation(async ({ ctx, input }) => {
      const { db, application, scope } = await applicationForActor(input.applicationId, ctx.user!);
      if (application.status === "completed") throw new TRPCError({ code: "CONFLICT", message: "A completed case is locked. Reopen it through the staff correction workflow before screening again." });
      const programme = getProgrammeById(input.programmeId);
      if (!programme) throw new TRPCError({ code: "NOT_FOUND", message: "Programme not found." });
      if (!canSeeFaculty(scope, programme.facultyId)) throw new TRPCError({ code: "FORBIDDEN", message: "That programme belongs to another faculty." });
      const engineInput = await getApplicantEngineInput(input.applicationId);
      const item = screenProgramme(engineInput.applicant, input.programmeId, (await ruleLookup(db))(input.programmeId));
      const snapshot = { application: { id: application.id, reference: application.reference, intake: application.intake }, results: engineInput.results, qualifications: engineInput.qualifications, documentTypes: engineInput.applicant.documents };
      await db.insert(screeningRuns).values({
        applicationId: input.applicationId,
        programmeId: item.mapping.id,
        programmeName: item.mapping.name,
        outcome: item.outcome,
        ruleSetVersion: item.result.ruleSet.id,
        ruleStatus: item.mappingReviewRequired ? "needs-review" : item.result.ruleSet.status,
        ruleSetRecordId: item.ruleSetRecordId,
        facultyId: item.mapping.facultyId,
        inputSnapshot: snapshot,
        resultTrace: { ...item.result, outcome: item.outcome, mapping: item.mapping, mappingReviewRequired: item.mappingReviewRequired, ruleApproval: item.ruleApproval, explanation: item.explanation },
      });
      await writeAudit({ actorUserId: ctx.user!.id, action: "screening_run_single", entityType: "application", entityId: input.applicationId, afterData: { programmeId: item.mapping.id, outcome: item.outcome } });
      return item;
    }),
  }),

  documents: router({
    list: applicantOrStaff.input(z.object({ applicationId: z.string().min(1) })).query(async ({ ctx, input }) => {
      const { db } = await applicationForActor(input.applicationId, ctx.user!);
      const rows = await db.select().from(applicantDocuments).where(eq(applicantDocuments.applicationId, input.applicationId)).orderBy(desc(applicantDocuments.createdAt));
      return rows.map(({ storageKey: _storageKey, ...row }) => row);
    }),
    upload: applicantOrRegistrar.input(z.object({
      applicationId: z.string().min(1),
      documentType: z.string().trim().min(2).max(80),
      fileName: z.string().trim().min(1).max(255),
      contentType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
      base64: z.string().min(32).max(6_000_000),
    })).mutation(async ({ ctx, input }) => {
      const { db, application } = await applicationForActor(input.applicationId, ctx.user!);
      if (application.status === "completed") throw new TRPCError({ code: "CONFLICT", message: "This completed application is locked for direct document changes." });
      const bytes = Buffer.from(input.base64, "base64");
      if (bytes.byteLength > 4_000_000) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "Each document must be 4 MB or smaller." });
      if (bytes.byteLength < 8) throw new TRPCError({ code: "BAD_REQUEST", message: "The uploaded file is empty or invalid." });
      const isPdf = input.contentType === "application/pdf" && bytes.subarray(0, 5).toString("ascii") === "%PDF-";
      const isPng = input.contentType === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const isJpeg = input.contentType === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      if (!isPdf && !isPng && !isJpeg) throw new TRPCError({ code: "BAD_REQUEST", message: "The file contents do not match the declared PDF, PNG or JPEG type." });
      const extraction = await extractDocument(bytes, input.contentType);
      const existingResults = await db.select({ subject: examResults.subject, grade: examResults.grade }).from(examResults).where(and(eq(examResults.applicationId, input.applicationId), eq(examResults.active, true)));
      const normalizeSubject = (value: string) => value.toLocaleLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
      const mismatches = extraction.candidates.flatMap((candidate) => {
        const matched = existingResults.find((result) => normalizeSubject(result.subject) === normalizeSubject(candidate.subject));
        if (matched && matched.grade.toUpperCase() !== candidate.grade.toUpperCase()) return [{ subject: candidate.subject, enteredGrade: matched.grade, extractedGrade: candidate.grade, line: candidate.line }];
        return [];
      });
      const advisoryFields = { status: extraction.status, candidates: extraction.candidates, warning: extraction.warning ?? null, mismatches, source: "local-only advisory extraction; never auto-confirms results" };
      const needsReview = extraction.status !== "extracted" || mismatches.length > 0;
      const key = `private-applications/${input.applicationId}/${nanoid(20)}`;
      await fileStore.put(key, bytes);
      try {
      await db.insert(applicantDocuments).values({
        applicationId: input.applicationId,
        documentType: input.documentType,
        fileName: input.fileName,
        contentType: input.contentType,
        storageKey: key,
        status: needsReview ? "needs_review" : "uploaded",
        extractionConfidence: extraction.confidence === null ? null : extraction.confidence / 100,
        extractedFields: advisoryFields,
        uploadedAt: new Date(),
      });
      } catch (error) {
        await fileStore.remove(key).catch(() => undefined);   // never leave a file with no record
        throw error;
      }
      await writeAudit({ actorUserId: ctx.user!.id, action: "document_uploaded", entityType: "application", entityId: input.applicationId, afterData: { documentType: input.documentType, fileName: input.fileName, byteLength: bytes.byteLength, extraction: advisoryFields } });
      await persistCurrentScreening(input.applicationId, ctx.user!.id);
      await db.insert(notifications).values({ recipientUserId: application.applicantUserId, applicationId: input.applicationId, title: "Document received", message: "Your document was received and is awaiting review by admissions staff." });
      return { success: true };
    }),
    download: applicantOrStaff.input(z.object({ documentId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await database();
      const rows = await db.select().from(applicantDocuments).where(eq(applicantDocuments.id, input.documentId)).limit(1);
      const document = rows[0];
      if (!document?.storageKey) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found." });
      await applicationForActor(document.applicationId, ctx.user!);
      return { url: `/api/documents/${document.id}/file` };
    }),
    review: staff.input(z.object({ documentId: z.number().int().positive(), status: z.enum(["needs_review", "verified", "rejected"]), reviewNote: z.string().trim().min(3).max(1000), mismatchesResolved: z.boolean().default(false) })).mutation(async ({ ctx, input }) => {
      const db = await database();
      const rows = await db.select().from(applicantDocuments).where(eq(applicantDocuments.id, input.documentId)).limit(1);
      const document = rows[0];
      if (!document) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found." });
      const { application } = await applicationForActor(document.applicationId, ctx.user!);
      if (application.status === "completed") throw new TRPCError({ code: "CONFLICT", message: "A completed case is locked. Reopen it through the staff correction workflow before reviewing documents." });
      const extracted = document.extractedFields as { mismatches?: unknown[] } | null;
      const mismatchCount = extracted?.mismatches?.length ?? 0;
      if (input.status === "verified" && mismatchCount > 0 && !input.mismatchesResolved) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "This document has grade discrepancies. Review the extracted candidates and explicitly resolve the discrepancy before verification." });
      const extractedFields = input.status === "verified" && mismatchCount > 0 && extracted ? { ...extracted, mismatchResolution: { resolved: true, actorUserId: ctx.user!.id, resolvedAt: new Date().toISOString(), note: input.reviewNote } } : document.extractedFields;
      await db.update(applicantDocuments).set({ status: input.status, reviewNote: input.reviewNote, reviewedBy: ctx.user!.id, reviewedAt: new Date(), extractedFields }).where(eq(applicantDocuments.id, input.documentId));
      await writeAudit({ actorUserId: ctx.user!.id, action: "document_reviewed", entityType: "application", entityId: document.applicationId, reason: input.reviewNote, beforeData: { status: document.status }, afterData: { documentId: document.id, status: input.status, mismatchCount, mismatchesResolved: input.mismatchesResolved } });
      await persistCurrentScreening(document.applicationId, ctx.user!.id);
      await db.insert(notifications).values({ recipientUserId: application.applicantUserId, applicationId: document.applicationId, title: "Document review updated", message: "Admissions updated the review status of one of your documents. Your application is still being reviewed." });
      return { success: true };
    }),
  }),

  staff: router({
    setDocumentDeadline: staff.input(z.object({ applicationId: z.string().min(1), deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), reason: z.string().trim().min(10).max(1000) })).mutation(async ({ ctx, input }) => {
      const { db, application } = await applicationForActor(input.applicationId, ctx.user!);
      if (application.status === "completed") throw new TRPCError({ code: "CONFLICT", message: "A completed case is locked. Reopen it through the staff correction workflow before changing deadlines." });
      const deadline = input.deadline ? new Date(`${input.deadline}T23:59:59.000Z`) : null;
      if (deadline && (Number.isNaN(deadline.getTime()) || deadline.toISOString().slice(0, 10) !== input.deadline)) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid calendar deadline date." });
      await db.update(applications).set({ documentDeadline: deadline }).where(eq(applications.id, input.applicationId));
      const formatted = deadline ? deadline.toLocaleDateString("en-GB", { timeZone: "UTC" }) : null;
      await writeAudit({ actorUserId: ctx.user!.id, action: "document_deadline_set", entityType: "application", entityId: input.applicationId, reason: input.reason, beforeData: { documentDeadline: application.documentDeadline }, afterData: { documentDeadline: deadline } });
      await persistCurrentScreening(input.applicationId, ctx.user!.id);
      await db.insert(notifications).values({ recipientUserId: application.applicantUserId, applicationId: input.applicationId, title: formatted ? "Document deadline updated" : "Document deadline cleared", message: formatted ? `Admissions set ${formatted} as your document submission deadline. Please upload outstanding evidence before this date.` : "Admissions cleared the document submission deadline for this case." });
      return { success: true, documentDeadline: formatted };
    }),
    applications: staff.query(async ({ ctx }) => {
      const db = await database();
      const scope = scopeOf(ctx.user!);
      const rows = await db.select({
        document: applicantDocuments,
        applicantName: applications.applicantName,
        reference: applications.reference,
        intake: applications.intake,
      }).from(applicantDocuments).innerJoin(applications, eq(applicantDocuments.applicationId, applications.id)).where(appFilter(db, scope)).orderBy(desc(applicantDocuments.createdAt)).limit(300);
      return rows.map(({ document, ...application }) => {
        const { storageKey: _storageKey, ...safeDocument } = document;
        return { ...safeDocument, ...application };
      });
    }),
    /** Creates an account with a one-time password, shown once. The person must choose their own at first sign-in. */
    createUser: registrar.input(z.object({
      name: z.string().trim().min(2).max(255),
      email: z.string().trim().toLowerCase().email().max(320),
      role: z.enum(appRoleValues),
      facultyId: z.string().max(80).nullable().optional(),
    })).mutation(async ({ ctx, input }) => {
      const db = await database();
      let facultyExists = false;
      if (input.facultyId) facultyExists = !!(await db.select({ id: faculties.id }).from(faculties).where(eq(faculties.id, input.facultyId)).limit(1))[0];
      const problem = validateRoleAssignment({ role: input.role, facultyId: input.facultyId }, facultyExists);
      if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
      if (await getUserByEmail(input.email)) throw new TRPCError({ code: "CONFLICT", message: "An account with this email already exists." });
      const temporaryPassword = generateTemporaryPassword();
      const facultyId = input.role === "faculty_administrator" ? input.facultyId! : null;
      let id: number;
      try {
        const result = await db.insert(users).values({
          openId: `local-${nanoid(20)}`, name: input.name, email: input.email, loginMethod: "password", role: "user",
          aspireRole: input.role, facultyId, passwordHash: await hashPassword(temporaryPassword), passwordChangedAt: new Date(), mustChangePassword: true,
        });
        id = result[0].insertId;
      } catch (error) {
        const code = error as { code?: string; cause?: { code?: string } };
        if (code.code === "ER_DUP_ENTRY" || code.cause?.code === "ER_DUP_ENTRY") throw new TRPCError({ code: "CONFLICT", message: "An account with this email already exists." });
        throw error;
      }
      await writeAudit({ actorUserId: ctx.user!.id, action: "user_created", entityType: "user", entityId: String(id), reason: "Registrar created the account", afterData: { email: input.email, aspireRole: input.role, facultyId } });
      return { id, email: input.email, temporaryPassword };
    }),
    /** Issues a new one-time password and ends the person's sessions. */
    resetPassword: registrar.input(z.object({ userId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user!.id) throw new TRPCError({ code: "BAD_REQUEST", message: "Use Change password for your own account." });
      const db = await database();
      const target = (await db.select().from(users).where(eq(users.id, input.userId)).limit(1))[0];
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
      if (target.role === "admin") throw new TRPCError({ code: "FORBIDDEN", message: "The project owner account's password can only be changed by its owner." });
      const temporaryPassword = generateTemporaryPassword();
      await db.update(users).set({ passwordHash: await hashPassword(temporaryPassword), passwordChangedAt: new Date(), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null, sessionVersion: target.sessionVersion + 1 }).where(eq(users.id, input.userId));
      await writeAudit({ actorUserId: ctx.user!.id, action: "password_reset_by_registrar", entityType: "user", entityId: String(input.userId), reason: "Registrar issued a temporary password" });
      return { temporaryPassword };
    }),
    /** Deactivates or reactivates an account. Accounts are never deleted, because history refers to them. */
    setUserActive: registrar.input(z.object({ userId: z.number().int().positive(), active: z.boolean() })).mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user!.id) throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot deactivate your own account." });
      const db = await database();
      const target = (await db.select().from(users).where(eq(users.id, input.userId)).limit(1))[0];
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "User not found." });
      if (!input.active) {
        if (target.role === "admin") throw new TRPCError({ code: "FORBIDDEN", message: "The project owner account cannot be deactivated." });
        if (target.aspireRole === "registrar") {
          const others = await db.select({ id: users.id }).from(users).where(and(eq(users.isActive, true), or(eq(users.aspireRole, "registrar"), eq(users.role, "admin")), ne(users.id, input.userId))).limit(1);
          if (!others[0]) throw new TRPCError({ code: "FORBIDDEN", message: "There must always be at least one active registrar." });
        }
      }
      await db.update(users).set({ isActive: input.active, sessionVersion: target.sessionVersion + 1 }).where(eq(users.id, input.userId));
      await writeAudit({ actorUserId: ctx.user!.id, action: input.active ? "user_reactivated" : "user_deactivated", entityType: "user", entityId: String(input.userId), reason: "Registrar changed the account state", beforeData: { isActive: target.isActive }, afterData: { isActive: input.active } });
      return { success: true };
    }),
    users: registrar.query(async () => {
      const db = await database();
      return db.select({ id: users.id, name: users.name, email: users.email, role: users.role, aspireRole: users.aspireRole, facultyId: users.facultyId, isActive: users.isActive, mustChangePassword: users.mustChangePassword, lockedUntil: users.lockedUntil, createdAt: users.createdAt, lastSignedIn: users.lastSignedIn }).from(users).orderBy(desc(users.lastSignedIn)).limit(500);
    }),
    exportCsv: staff.query(async ({ ctx }) => {
      const db = await database();
      const scope = scopeOf(ctx.user!);
      const applicationRows = await db.select().from(applications).where(appFilter(db, scope)).orderBy(desc(applications.updatedAt)).limit(1000);
      const ids = applicationRows.map((row) => row.id);
      const resultRows = ids.length ? await db.select().from(examResults).where(and(inArray(examResults.applicationId, ids), eq(examResults.active, true))).orderBy(examResults.applicationId, examResults.exam, examResults.subject) : [];
      const byApplication = new Map<string, typeof resultRows>();
      for (const row of resultRows) byApplication.set(row.applicationId, [...(byApplication.get(row.applicationId) ?? []), row]);
      const header = ["reference", "applicantName", "intake", "level", "status", "exam", "subject", "grade", "subjectLevel", "sitting"];
      const lines = [header.map(csvCell).join(",")];
      for (const application of applicationRows) {
        const rows = byApplication.get(application.id) ?? [];
        const exportRows = rows.length ? rows : [null];
        for (const row of exportRows) lines.push([
          application.reference, application.applicantName, application.intake, application.level, application.status,
          row?.exam ?? "", row?.subject ?? "", row?.grade ?? "", row?.subjectLevel ?? "", row?.sitting ?? "",
        ].map(csvCell).join(","));
      }
      return { filename: `aspire-applications-${new Date().toISOString().slice(0, 10)}.csv`, csv: lines.join("\r\n") };
    }),
    /** Bulk results import spans faculties, so it is registrar only. */
    importResultsCsv: registrar.input(z.object({ csvText: z.string().min(1).max(1_100_000) })).mutation(async ({ ctx, input }) => {
      let parsed;
      try { parsed = parseResultsCsv(input.csvText); }
      catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "CSV validation failed." }); }
      if (!parsed.length) throw new TRPCError({ code: "BAD_REQUEST", message: "The CSV contains only a header; add at least one result row." });
      const grouped = new Map<string, typeof parsed>();
      for (const row of parsed) grouped.set(row.reference, [...(grouped.get(row.reference) ?? []), row]);
      for (const [reference, rows] of grouped) if (rows.length > 80) throw new TRPCError({ code: "BAD_REQUEST", message: `${reference}: more than 80 result rows in this import.` });
      const db = await database();
      const references = [...grouped.keys()];
      const matchingApplications = await db.select().from(applications).where(inArray(applications.reference, references));
      const byReference = new Map(matchingApplications.map((row) => [row.reference, row]));
      const missing = references.filter((reference) => !byReference.has(reference));
      if (missing.length) throw new TRPCError({ code: "NOT_FOUND", message: `Unknown application reference(s): ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? "…" : ""}` });
      const completed = matchingApplications.filter((row) => row.status === "completed").map((row) => row.reference);
      if (completed.length) throw new TRPCError({ code: "CONFLICT", message: `Completed cases cannot be edited by CSV: ${completed.slice(0, 10).join(", ")}` });
      for (const [reference, rows] of grouped) {
        const application = byReference.get(reference)!;
        const current = await db.select().from(examResults).where(and(eq(examResults.applicationId, application.id), eq(examResults.active, true)));
        await db.update(examResults).set({ active: false }).where(and(eq(examResults.applicationId, application.id), eq(examResults.active, true)));
        await db.insert(examResults).values(rows.map((row) => ({ applicationId: application.id, exam: row.exam, subject: row.subject, grade: row.grade, subjectLevel: row.exam === "UACE" ? row.subjectLevel ?? "PRINCIPAL" as const : null, sitting: row.sitting, source: "staff_entered" as const, confirmed: false, active: true })));
        await writeAudit({ actorUserId: ctx.user!.id, action: "results_imported_from_csv", entityType: "application", entityId: application.id, reason: "CSV import; previous active entries retained as inactive.", beforeData: { results: current.map(({ exam, subject, grade, subjectLevel, sitting }) => ({ exam, subject, grade, subjectLevel, sitting })) }, afterData: { results: rows } });
        await persistCurrentScreening(application.id, ctx.user!.id);
        await db.update(applications).set({ updatedAt: new Date() }).where(eq(applications.id, application.id));
      }
      return { success: true, applicationsUpdated: grouped.size, resultsImported: parsed.length };
    }),
    queue: staff.query(async ({ ctx }) => {
      const db = await database();
      const scope = scopeOf(ctx.user!);
      const rows = await db.select().from(applications).where(appFilter(db, scope)).orderBy(desc(applications.updatedAt)).limit(200);
      const ids = rows.map((row) => row.id);
      const runs = ids.length ? await db.select({ applicationId: screeningRuns.applicationId, programmeId: screeningRuns.programmeId, outcome: screeningRuns.outcome, createdAt: screeningRuns.createdAt }).from(screeningRuns).where(and(inArray(screeningRuns.applicationId, ids), runFilter(scope))).orderBy(desc(screeningRuns.createdAt), desc(screeningRuns.id)) : [];
      // Outcomes only count for programmes the applicant applied to (when they have chosen any).
      const choiceRows = ids.length ? await db.select({ applicationId: applicationProgrammes.applicationId, programmeId: applicationProgrammes.programmeId }).from(applicationProgrammes).where(and(inArray(applicationProgrammes.applicationId, ids), eq(applicationProgrammes.status, "submitted"))) : [];
      const chosen = new Map<string, Set<string>>();
      for (const choice of choiceRows) chosen.set(choice.applicationId, (chosen.get(choice.applicationId) ?? new Set()).add(choice.programmeId));
      const latestByApplication = new Map<string, Map<string, string>>();
      for (const run of runs) {
        const wanted = chosen.get(run.applicationId);
        if (wanted && !wanted.has(run.programmeId)) continue;
        if (!latestByApplication.has(run.applicationId)) latestByApplication.set(run.applicationId, new Map());
        const byProgramme = latestByApplication.get(run.applicationId)!;
        if (!byProgramme.has(run.programmeId)) byProgramme.set(run.programmeId, run.outcome);
      }
      const docs = ids.length ? await db.select({ applicationId: applicantDocuments.applicationId, status: applicantDocuments.status }).from(applicantDocuments).where(inArray(applicantDocuments.applicationId, ids)) : [];
      const pendingDocs = new Map<string, number>();
      for (const doc of docs) if (doc.status === "uploaded" || doc.status === "needs_review") pendingDocs.set(doc.applicationId, (pendingDocs.get(doc.applicationId) ?? 0) + 1);
      return rows.map((row) => {
        const latestOutcomes = [...(latestByApplication.get(row.id)?.values() ?? [])];
        return { ...redactApplication(row, scope), latestOutcomes, pendingDocuments: pendingDocs.get(row.id) ?? 0, needsReview: latestOutcomes.includes("ON_HOLD") || (pendingDocs.get(row.id) ?? 0) > 0 };
      });
    }),
    decisions: staff.input(z.object({
      applicationId: z.string().min(1),
      programmeId: z.string().min(1),
      decision: z.enum(["admit", "decline", "defer", "request_information"]),
      reason: z.string().trim().min(10).max(2000),
      overrideSystemResult: z.boolean().default(false),
    })).mutation(async ({ ctx, input }) => {
      const { db, application, scope } = await applicationForActor(input.applicationId, ctx.user!);
      const programme = getProgrammeById(input.programmeId);
      if (!programme) throw new TRPCError({ code: "NOT_FOUND", message: "Programme not found." });
      if (!canSeeFaculty(scope, programme.facultyId)) throw new TRPCError({ code: "FORBIDDEN", message: "That programme belongs to another faculty." });
      const choice = await db.select({ id: applicationProgrammes.id }).from(applicationProgrammes).where(and(eq(applicationProgrammes.applicationId, input.applicationId), eq(applicationProgrammes.programmeId, input.programmeId), eq(applicationProgrammes.status, "submitted"))).limit(1);
      if (!choice[0]) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "The applicant has not applied to this programme." });
      if (application.status === "draft") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Submit the application before recording a committee decision." });
      if (application.status === "completed") throw new TRPCError({ code: "CONFLICT", message: "A completed case already has a committee record. Review any appeal and reopen the case before recording a revised decision." });
      const latest = await db.select().from(screeningRuns).where(and(eq(screeningRuns.applicationId, input.applicationId), eq(screeningRuns.programmeId, input.programmeId), runFilter(scope))).orderBy(desc(screeningRuns.createdAt), desc(screeningRuns.id)).limit(1);
      if (!latest[0]) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Run and review screening before recording a committee decision." });
      // The rule set the screening used must have a recorded UMU approval, and the programme mapping must be settled.
      const ruleRow = latest[0].ruleSetRecordId ? (await db.select().from(ruleSets).where(eq(ruleSets.id, latest[0].ruleSetRecordId)).limit(1))[0] : undefined;
      const mappingReviewRequired = (latest[0].resultTrace as { mappingReviewRequired?: boolean }).mappingReviewRequired === true;
      const ruleApproved = ruleRow?.approvalStatus === "approved" && !mappingReviewRequired;
      const policy = assessCommitteeDecision({ decision: input.decision, outcome: latest[0].outcome, ruleApproved, overrideSystemResult: input.overrideSystemResult });
      if (!policy.allowed) throw new TRPCError({ code: "PRECONDITION_FAILED", message: policy.message });
      if (input.decision === "admit") {
        const currentResults = await db.select().from(examResults).where(and(eq(examResults.applicationId, input.applicationId), eq(examResults.active, true)));
        const officialSlips = await db.select({ id: applicantDocuments.id, documentType: applicantDocuments.documentType }).from(applicantDocuments).where(and(eq(applicantDocuments.applicationId, input.applicationId), eq(applicantDocuments.status, "verified")));
        if (!currentResults.length || currentResults.some((row) => !row.confirmed) || !officialSlips.some((doc) => ["UCE_RESULT_SLIP", "UACE_RESULT_SLIP"].includes(doc.documentType))) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Before recording an admit decision, a faculty administrator must verify an official UNEB result slip and confirm each active examination result row." });
        }
      }
      const rows = await db.insert(committeeDecisions).values({ applicationId: input.applicationId, programmeId: input.programmeId, decision: input.decision, reason: input.reason, facultyId: programme.facultyId, ruleSetRecordId: latest[0].ruleSetRecordId, decidedBy: ctx.user!.id });
      await db.update(applications).set({ status: policy.nextApplicationStatus }).where(eq(applications.id, input.applicationId));
      await writeAudit({ actorUserId: ctx.user!.id, action: policy.overrideApplied ? "committee_override" : "committee_decision_recorded", entityType: "application", entityId: input.applicationId, reason: input.reason, beforeData: { applicationStatus: application.status, screeningOutcome: latest[0].outcome }, afterData: { decision: input.decision, programmeId: input.programmeId, applicationStatus: policy.nextApplicationStatus, overrideSystemResult: policy.overrideApplied, ruleSetRecordId: latest[0].ruleSetRecordId, recordId: rows[0].insertId } });
      await db.insert(notifications).values({ recipientUserId: application.applicantUserId, applicationId: input.applicationId, title: "Committee decision recorded", message: "A decision has been recorded for your application. This system notice is not an admission offer." });
      return { success: true, message: "Committee decision recorded. This action does not issue an admission offer." };
    }),
    reopenApplication: staff.input(z.object({ applicationId: z.string().min(1), reason: z.string().trim().min(10).max(1000) })).mutation(async ({ ctx, input }) => {
      const { db, application } = await applicationForActor(input.applicationId, ctx.user!);
      if (application.status !== "completed") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Only a completed case can be reopened." });
      await db.update(applications).set({ status: "in_review" }).where(eq(applications.id, input.applicationId));
      await writeAudit({ actorUserId: ctx.user!.id, action: "application_reopened", entityType: "application", entityId: input.applicationId, reason: input.reason, beforeData: { status: application.status }, afterData: { status: "in_review" } });
      await persistCurrentScreening(input.applicationId, ctx.user!.id);
      await db.insert(notifications).values({ recipientUserId: application.applicantUserId, applicationId: input.applicationId, title: "Application reopened for review", message: "Admissions reopened your case for correction and further review. This is not an admission offer." });
      return { success: true };
    }),
    appeals: staff.query(async ({ ctx }) => {
      const db = await database();
      const scope = scopeOf(ctx.user!);
      const rows = await db.select({ appeal: appeals }).from(appeals).innerJoin(applications, eq(appeals.applicationId, applications.id)).where(appFilter(db, scope)).orderBy(desc(appeals.createdAt)).limit(200);
      return rows.map((row) => row.appeal);
    }),
    resolveAppeal: staff.input(z.object({ appealId: z.number().int().positive(), status: z.enum(["reviewing", "resolved"]), resolution: z.string().trim().min(5).max(1500).optional() })).mutation(async ({ ctx, input }) => {
      const db = await database();
      const rows = await db.select().from(appeals).where(eq(appeals.id, input.appealId)).limit(1);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Appeal not found." });
      await applicationForActor(rows[0].applicationId, ctx.user!);
      await db.update(appeals).set({ status: input.status, resolution: input.resolution ?? null, resolvedBy: ctx.user!.id, ...(input.status === "resolved" ? { resolvedAt: new Date() } : {}) }).where(eq(appeals.id, input.appealId));
      await writeAudit({ actorUserId: ctx.user!.id, action: "appeal_status_changed", entityType: "application", entityId: rows[0].applicationId, reason: input.resolution ?? input.status, beforeData: { status: rows[0].status }, afterData: { status: input.status } });
      await db.insert(notifications).values({ recipientUserId: rows[0].applicantUserId, applicationId: rows[0].applicationId, title: input.status === "resolved" ? "Review request resolved" : "Review request in progress", message: input.resolution ?? `Your review request is now ${input.status}.` });
      return { success: true };
    }),
    audit: staff.input(z.object({ applicationId: z.string().min(1) })).query(async ({ ctx, input }) => {
      const { db, scope } = await applicationForActor(input.applicationId, ctx.user!);
      const rows = await db.select().from(auditEvents).where(and(eq(auditEvents.entityType, "application"), eq(auditEvents.entityId, input.applicationId))).orderBy(desc(auditEvents.createdAt)).limit(200);
      return redactHistory(rows, scope, ctx.user!.id, facultyOfProgramme);
    }),
    advisory: staff.input(z.object({ applicationId: z.string().min(1) })).query(async ({ ctx, input }) => {
      const { db } = await applicationForActor(input.applicationId, ctx.user!);
      const saved = await db.select().from(advisoryOutputs).where(eq(advisoryOutputs.applicationId, input.applicationId)).orderBy(desc(advisoryOutputs.createdAt));
      return { saved, progressStatus: "unvalidated", notice: "A progression model is unavailable until approved anonymized historical outcomes exist. No synthetic prediction is shown." };
    }),
  }),

  applicant: router({
    appeal: allowRoles("applicant").input(z.object({ applicationId: z.string().min(1), message: z.string().trim().min(10).max(2000) })).mutation(async ({ ctx, input }) => {
      const { db } = await applicationForActor(input.applicationId, ctx.user!);
      const inserted = await db.insert(appeals).values({ applicationId: input.applicationId, applicantUserId: ctx.user!.id, message: input.message });
      await writeAudit({ actorUserId: ctx.user!.id, action: "appeal_submitted", entityType: "application", entityId: input.applicationId, afterData: { appealId: inserted[0].insertId } });
      await notifyStaff(input.applicationId, "New applicant appeal", `An applicant submitted an appeal for application ${input.applicationId}.`);
      return { success: true };
    }),
    notifications: protectedProcedure.query(async ({ ctx }) => {
      const db = await database();
      const rows = await db.select().from(notifications).where(eq(notifications.recipientUserId, ctx.user!.id)).orderBy(desc(notifications.createdAt)).limit(100);
      return rows;
    }),
    markNotificationRead: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
      const db = await database();
      const rows = await db.select().from(notifications).where(and(eq(notifications.id, input.id), eq(notifications.recipientUserId, ctx.user!.id))).limit(1);
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "Notification not found." });
      if (!rows[0].readAt) await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, input.id), eq(notifications.recipientUserId, ctx.user!.id)));
      return { success: true };
    }),
  }),

  evaluation: staff.query(async ({ ctx }) => {
    const db = await database();
    const scope = scopeOf(ctx.user!);
    const visibleApplications = db.select({ id: applications.id }).from(applications).where(appFilter(db, scope));
    const runs = await db.select().from(screeningRuns).where(and(inArray(screeningRuns.applicationId, visibleApplications), runFilter(scope))).orderBy(desc(screeningRuns.createdAt), desc(screeningRuns.id)).limit(1000);
    const applicationsList = await db.select({ id: applications.id }).from(applications).where(appFilter(db, scope));
    const docs = await db.select({ id: applicantDocuments.id, status: applicantDocuments.status, extractionConfidence: applicantDocuments.extractionConfidence }).from(applicantDocuments).where(inArray(applicantDocuments.applicationId, visibleApplications));
    const outcomes = { ELIGIBLE: 0, NOT_ELIGIBLE: 0, ON_HOLD: 0 };
    for (const run of runs) outcomes[run.outcome] += 1;
    return {
      counts: { applications: applicationsList.length, screeningRuns: runs.length, documents: docs.length },
      outcomes,
      extraction: { reviewed: docs.filter((doc) => doc.status === "verified").length, pending: docs.filter((doc) => ["uploaded", "needs_review"].includes(doc.status)).length },
      fairness: { status: "requires approved anonymized evaluation data; protected attributes are not model inputs" },
      progressModel: { status: "not validated; no predictions produced" },
      note: "Operational counts describe recorded cases; they are not validation evidence. Rule correctness and predictive fairness require approved historical cases and human review.",
    };
  }),
});
