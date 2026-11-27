import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applications, auditEvents, committeeDecisions, ruleSets } from "../drizzle/schema";
import { programmeCatalogue } from "./services/screeningService";
import {
  TEST_DB, caller, connectTestDb, latestRun, makeAdmitReady, makeWorld, recommend, rejectsWith, resetDb, submittedApplication,
  type Harness, type World,
} from "./testing/harness";

const suite = TEST_DB ? describe : describe.skip;
const SCREENABLE = programmeCatalogue.filter((programme) => programme.screenable).length;
const SEED_ID = "umu-bsc-cs@2026-27.1";

suite("rule sets, approval and admit decisions (real MySQL)", () => {
  let h: Harness;
  let w: World;
  let app: { id: string; reference: string };   // applied to BSc Computer Science, with evidence verified

  const admit = async () => {
    await recommend(h, w.faSci, app.id, "umu-bsc-cs");
    return caller(h, w.reg).staff.decisions({ applicationId: app.id, programmeId: "umu-bsc-cs", decision: "admit", reason: "Faculty recommended admission; registrar reviewed the recorded recommendation." });
  };
  const screenAgain = () => caller(h, w.reg).screening.run({ applicationId: app.id });

  beforeAll(async () => { h = await connectTestDb(); });
  afterAll(async () => { await h.conn.end(); });
  beforeEach(async () => {
    await resetDb(h.conn);
    w = await makeWorld(h);
    app = await submittedApplication(h, w.app1, "Applicant One", ["umu-bsc-cs"]);
    await makeAdmitReady(h, w.faSci, app.id);
  });

  describe("before any rule set is stored", () => {
    it("screens with the data-file rules and cannot record an admit", async () => {
      const run = await latestRun(h, app.id, "umu-bsc-cs");
      expect(run!.outcome).toBe("ELIGIBLE");
      expect(run!.ruleSetRecordId).toBeNull();
      await expect(admit()).rejects.toThrow(/UMU has approved/);
    });
    it("still lets a decline or deferral through after the faculty has said so", async () => {
      await caller(h, w.faSci).staff.recommend({ applicationId: app.id, programmeId: "umu-bsc-cs", recommendation: "defer", reason: "Waiting for a certified copy." });
      await caller(h, w.reg).staff.decisions({ applicationId: app.id, programmeId: "umu-bsc-cs", decision: "defer", reason: "Faculty asked to defer pending a certified copy." });
      const detail = await caller(h, w.faSci).applications.get({ id: app.id });
      expect(detail.facultyRecommendations).toHaveLength(1);
      expect(detail.decisions).toHaveLength(1);
    });
  });

  describe("seeding the first versions", () => {
    it("creates one in-use version per screenable programme, and is safe to repeat", async () => {
      const first = await caller(h, w.reg).rules.seedFromFiles();
      expect(first).toEqual({ created: SCREENABLE, skipped: 0 });
      expect(await caller(h, w.reg).rules.seedFromFiles()).toEqual({ created: 0, skipped: SCREENABLE });
      const rows = await caller(h, w.reg).rules.list();
      expect(rows).toHaveLength(SCREENABLE);
      expect(rows.every((row) => row.inUse)).toBe(true);
      const cs = rows.find((row) => row.id === SEED_ID)!;
      expect(cs).toMatchObject({ status: "adopted-proxy", approvalStatus: "pending", approval: "Pending UMU admissions approval" });
      expect(rows.filter((row) => row.status === "official").every((row) => row.approvalStatus === "approved")).toBe(true);
      expect((await h.db.select().from(auditEvents).where(eq(auditEvents.action, "rule_sets_seeded"))).length).toBe(2);
    });
    it("screens with the stored version afterwards, but pending rules still cannot support an admit", async () => {
      await caller(h, w.reg).rules.seedFromFiles();
      await screenAgain();
      const run = await latestRun(h, app.id, "umu-bsc-cs");
      expect(run!.ruleSetRecordId).toBe(SEED_ID);
      expect((run!.resultTrace as { ruleApproval: string }).ruleApproval).toBe("pending");
      expect(run!.ruleStatus).toBe("adopted-proxy");
      await expect(admit()).rejects.toThrow(/UMU has approved/);
    });
  });

  describe("recording UMU's approval", () => {
    beforeEach(async () => { await caller(h, w.reg).rules.seedFromFiles(); await screenAgain(); });

    it("needs a reference to approve and a reason to reject", async () => {
      const c = caller(h, w.reg);
      await rejectsWith("BAD_REQUEST", c.rules.recordApproval({ ruleSetId: SEED_ID, decision: "approved", approvedBy: "Academic Registrar" }));
      await rejectsWith("BAD_REQUEST", c.rules.recordApproval({ ruleSetId: SEED_ID, decision: "rejected", approvedBy: "Academic Registrar" }));
      await rejectsWith("NOT_FOUND", c.rules.recordApproval({ ruleSetId: "nope@1", decision: "approved", approvedBy: "Academic Registrar", reference: "Minute 1" }));
    });
    it("is registrar only", async () => {
      await rejectsWith("FORBIDDEN", caller(h, w.faSci).rules.recordApproval({ ruleSetId: SEED_ID, decision: "approved", approvedBy: "Me", reference: "My own say-so" }));
    });
    it("keeps the final verdict with the registrar", async () => {
      await rejectsWith("FORBIDDEN", caller(h, w.faSci).staff.decisions({ applicationId: app.id, programmeId: "umu-bsc-cs", decision: "admit", reason: "Faculty cannot issue the final verdict." }));
    });
    it("requires the faculty's recommendation before the registrar's verdict", async () => {
      await caller(h, w.reg).rules.recordApproval({ ruleSetId: SEED_ID, decision: "approved", approvedBy: "Academic Registrar", reference: "Minute 12/2026" });
      await rejectsWith("PRECONDITION_FAILED", caller(h, w.reg).staff.decisions({ applicationId: app.id, programmeId: "umu-bsc-cs", decision: "admit", reason: "Registrar is deciding before the faculty has spoken." }));
    });
    it("lets an admit through once UMU's approval is recorded, and keeps the trail", async () => {
      const result = await caller(h, w.reg).rules.recordApproval({ ruleSetId: SEED_ID, decision: "approved", approvedBy: "Academic Registrar", reference: "Admissions Board minute 12/2026" });
      expect(result.approval).toBe("Approved by Academic Registrar (Admissions Board minute 12/2026)");
      const row = (await h.db.select().from(ruleSets).where(eq(ruleSets.id, SEED_ID)))[0]!;
      expect(row).toMatchObject({ approvalStatus: "approved", approvedBy: "Academic Registrar", approvalRecordedBy: w.reg.id });
      expect(row.approvedAt).toBeInstanceOf(Date);

      await admit();
      expect((await h.db.select().from(applications).where(eq(applications.id, app.id)))[0]!.status).toBe("completed");
      const decision = (await h.db.select().from(committeeDecisions))[0]!;
      expect(decision).toMatchObject({ decision: "admit", facultyId: "science", ruleSetRecordId: SEED_ID });
      const actions = (await h.db.select().from(auditEvents)).map((event) => event.action);
      expect(actions).toContain("rule_version_approved");
      expect(actions).toContain("faculty_recommendation_recorded");
      expect(actions).toContain("registrar_final_decision");
    });
    it("blocks the admit again if the approval is later withdrawn", async () => {
      const c = caller(h, w.reg);
      await c.rules.recordApproval({ ruleSetId: SEED_ID, decision: "approved", approvedBy: "Academic Registrar", reference: "Minute 12/2026" });
      await c.rules.recordApproval({ ruleSetId: SEED_ID, decision: "rejected", approvedBy: "Academic Registrar", note: "Subject weights were wrong." });
      await expect(admit()).rejects.toThrow(/UMU has approved/);
      // A rejected version also stops being used for screening, so the next run falls back to the data files.
      await screenAgain();
      expect((await latestRun(h, app.id, "umu-bsc-cs"))!.ruleSetRecordId).toBeNull();
      await expect(admit()).rejects.toThrow(/UMU has approved/);
    });
    it("does not let approval bypass an unresolved programme mapping", async () => {
      // Inclusive Deaf Education has only a partial rule mapping: its screening is held for review whatever the approval.
      const unmapped = await submittedApplication(h, w.app2, "Applicant Two", ["umu-inclusive-deaf-educ"]);
      await makeAdmitReady(h, w.faEdu, unmapped.id);
      await caller(h, w.reg).screening.run({ applicationId: unmapped.id });
      const run = await latestRun(h, unmapped.id, "umu-inclusive-deaf-educ");
      expect(run!.ruleSetRecordId).toBe("umu-inclusive-deaf-educ@2026-27.1");
      expect((await h.db.select().from(ruleSets).where(eq(ruleSets.id, "umu-inclusive-deaf-educ@2026-27.1")))[0]!.approvalStatus).toBe("approved");   // general rules are UMU-published
      expect((run!.resultTrace as { mappingReviewRequired: boolean }).mappingReviewRequired).toBe(true);
      await recommend(h, w.faEdu, unmapped.id, "umu-inclusive-deaf-educ");
      await expect(caller(h, w.reg).staff.decisions({
        applicationId: unmapped.id, programmeId: "umu-inclusive-deaf-educ", decision: "admit", reason: "Override: reviewed by hand.", overrideSystemResult: true,
      })).rejects.toThrow(/UMU has approved/);
    });
  });

  describe("publishing a new version", () => {
    beforeEach(async () => { await caller(h, w.reg).rules.seedFromFiles(); });
    const strict = async () => {
      const current = await caller(h, w.reg).rules.current({ programmeId: "umu-bsc-cs" });
      const content = JSON.parse(JSON.stringify(current.content)) as { routes: Array<{ id: string; rules: Array<{ type: string; count?: number }> }> };
      for (const rule of content.routes.find((route) => route.id === "UACE_DIRECT")!.rules) if (rule.type === "MIN_PRINCIPAL_PASSES") rule.count = 3;
      return content;
    };
    const proposal = (rules: Record<string, unknown>, version = "v2") => ({
      programmeId: "umu-bsc-cs", version, effectiveFrom: "2026-09-01", source: "Faculty of Science proposal, test", edition: "2026/2027", status: "adopted-proxy" as const, rules,
    });

    it("returns the rules in use as editable content", async () => {
      const current = await caller(h, w.reg).rules.current({ programmeId: "umu-bsc-cs" });
      expect(current.recordId).toBe(SEED_ID);
      expect((current.content as { routes: unknown[] }).routes.length).toBeGreaterThan(0);
    });
    it("rejects rules the engine could not screen, official claims and level mismatches", async () => {
      const c = caller(h, w.reg);
      await rejectsWith("BAD_REQUEST", c.rules.propose(proposal({ routes: [], documents: [] })));
      await rejectsWith("BAD_REQUEST", c.rules.propose({ ...proposal(await strict()), status: "official" as never }));
      await rejectsWith("BAD_REQUEST", c.rules.propose(proposal({ ...(await strict()), level: "diploma" })));
      await rejectsWith("BAD_REQUEST", c.rules.propose({ ...proposal(await strict()), version: "bad version!" }));
      await rejectsWith("NOT_FOUND", c.rules.propose({ ...proposal(await strict()), programmeId: "umu-nonexistent" }));
      await rejectsWith("BAD_REQUEST", c.rules.propose({ ...proposal(await strict()), programmeId: "umu-postgraduates" }));
    });
    it("keeps a proposal out of use until it is activated, then screens with it", async () => {
      const c = caller(h, w.reg);
      await c.rules.propose(proposal(await strict()));
      await rejectsWith("CONFLICT", c.rules.propose(proposal(await strict())));
      expect((await c.rules.list()).find((row) => row.id === "umu-bsc-cs@v2")).toMatchObject({ inUse: false, approvalStatus: "pending", status: "adopted-proxy" });

      await screenAgain();
      expect((await latestRun(h, app.id, "umu-bsc-cs"))).toMatchObject({ ruleSetRecordId: SEED_ID, outcome: "ELIGIBLE" });

      await rejectsWith("BAD_REQUEST", c.rules.activate({ ruleSetId: "umu-bsc-cs@v2", reason: "short" }));
      await rejectsWith("FORBIDDEN", caller(h, w.faSci).rules.activate({ ruleSetId: "umu-bsc-cs@v2", reason: "Faculty request to tighten entry." }));
      await c.rules.activate({ ruleSetId: "umu-bsc-cs@v2", reason: "Faculty request to tighten entry." });
      await rejectsWith("CONFLICT", c.rules.activate({ ruleSetId: "umu-bsc-cs@v2", reason: "Activating a second time." }));

      await screenAgain();
      // Two principal passes no longer meet the stricter stored rule, so the stored version is what screens.
      expect((await latestRun(h, app.id, "umu-bsc-cs"))).toMatchObject({ ruleSetRecordId: "umu-bsc-cs@v2", outcome: "NOT_ELIGIBLE" });
    });
    it("retires a version without losing it, and screening falls back to the one before", async () => {
      const c = caller(h, w.reg);
      await c.rules.propose(proposal(await strict()));
      await c.rules.activate({ ruleSetId: "umu-bsc-cs@v2", reason: "Faculty request to tighten entry." });
      await rejectsWith("BAD_REQUEST", c.rules.retire({ ruleSetId: "umu-bsc-cs@v2", effectiveTo: "2026-09-01", reason: "End date must be after start." }));
      await c.rules.retire({ ruleSetId: "umu-bsc-cs@v2", effectiveTo: "2026-10-01", reason: "Faculty withdrew the proposal." });
      await screenAgain();
      expect((await latestRun(h, app.id, "umu-bsc-cs"))).toMatchObject({ ruleSetRecordId: SEED_ID, outcome: "ELIGIBLE" });
      const kept = (await c.rules.list()).find((row) => row.id === "umu-bsc-cs@v2")!;
      expect(kept).toMatchObject({ inUse: false, effectiveTo: "2026-10-01" });
    });
    it("cannot activate a rejected version", async () => {
      const c = caller(h, w.reg);
      await c.rules.propose(proposal(await strict()));
      await c.rules.recordApproval({ ruleSetId: "umu-bsc-cs@v2", decision: "rejected", approvedBy: "Academic Registrar", note: "Not accepted by the Senate." });
      await rejectsWith("PRECONDITION_FAILED", c.rules.activate({ ruleSetId: "umu-bsc-cs@v2", reason: "Trying to activate anyway." }));
    });
    it("never edits an existing version: its stored content is unchanged by new versions", async () => {
      const before = (await h.db.select().from(ruleSets).where(eq(ruleSets.id, SEED_ID)))[0]!;
      const c = caller(h, w.reg);
      await c.rules.propose(proposal(await strict()));
      await c.rules.activate({ ruleSetId: "umu-bsc-cs@v2", reason: "Faculty request to tighten entry." });
      const after = (await h.db.select().from(ruleSets).where(eq(ruleSets.id, SEED_ID)))[0]!;
      expect(after.rules).toEqual(before.rules);
      expect(after.version).toBe(before.version);
    });
  });
});
