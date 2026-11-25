import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applicantDocuments, applicationProgrammes, auditEvents, notifications, screeningRuns, users } from "../drizzle/schema";
import {
  TEST_DB, TWO_PRINCIPALS, caller, connectTestDb, makeUser, makeWorld, rejectsWith, resetDb, submittedApplication,
  type Harness, type World,
} from "./testing/harness";

const suite = TEST_DB ? describe : describe.skip;

suite("roles and faculty scoping (real MySQL)", () => {
  let h: Harness;
  let w: World;
  let a1: { id: string; reference: string };  // applied to Science and Law
  let a2: { id: string; reference: string };  // applied to Law only

  beforeAll(async () => { h = await connectTestDb(); });
  afterAll(async () => { await h.conn.end(); });
  beforeEach(async () => {
    await resetDb(h.conn);
    w = await makeWorld(h);
    a1 = await submittedApplication(h, w.app1, "Applicant One", ["umu-bsc-cs", "umu-llb"]);
    a2 = await submittedApplication(h, w.app2, "Applicant Two", ["umu-llb"]);
  });

  describe("who may call what", () => {
    it("keeps applicants out of staff and registrar procedures", async () => {
      const c = caller(h, w.app1);
      await rejectsWith("FORBIDDEN", c.staff.queue());
      await rejectsWith("FORBIDDEN", c.staff.users());
      await rejectsWith("FORBIDDEN", c.rules.list());
      await rejectsWith("FORBIDDEN", c.profile.setRole({ userId: w.app1.id, role: "registrar" }));
    });
    it("keeps faculty administrators out of registrar procedures", async () => {
      const c = caller(h, w.faSci);
      await rejectsWith("FORBIDDEN", c.staff.users());
      await rejectsWith("FORBIDDEN", c.rules.list());
      await rejectsWith("FORBIDDEN", c.rules.seedFromFiles());
      await rejectsWith("FORBIDDEN", c.profile.setRole({ userId: w.faSci.id, role: "registrar" }));
      await rejectsWith("FORBIDDEN", c.staff.importResultsCsv({ csvText: "reference,exam,subject,grade,subjectLevel,sitting\n" }));
    });
    it("does not let a faculty administrator edit an applicant's data or create applications", async () => {
      const c = caller(h, w.faSci);
      await rejectsWith("FORBIDDEN", c.applications.saveResults({ id: a1.id, results: TWO_PRINCIPALS }));
      await rejectsWith("FORBIDDEN", c.applications.saveQualifications({ id: a1.id, qualifications: [] }));
      await rejectsWith("FORBIDDEN", c.applications.setProgrammeChoices({ id: a1.id, programmeIds: ["umu-bsc-cs"] }));
      await rejectsWith("FORBIDDEN", c.applications.create({ applicantName: "Someone", intake: "2026/27", level: "bachelors" }));
    });
    it("lets the registrar enter results on an applicant's behalf, recorded as staff-entered", async () => {
      await caller(h, w.reg).applications.saveResults({ id: a1.id, results: TWO_PRINCIPALS });
      const detail = await caller(h, w.reg).applications.get({ id: a1.id });
      expect(detail.results.every((row) => row.source === "staff_entered")).toBe(true);
    });
    it("treats the project owner account as a registrar", async () => {
      const c = caller(h, w.owner);
      expect((await c.staff.queue()).map((row) => row.id).sort()).toEqual([a1.id, a2.id].sort());
      expect((await c.staff.users()).length).toBeGreaterThan(0);
    });
  });

  describe("what each role sees", () => {
    it("shows each faculty administrator only the applications that applied to their faculty", async () => {
      const ids = async (u: typeof w.faSci) => (await caller(h, u).staff.queue()).map((row) => row.id).sort();
      expect(await ids(w.faSci)).toEqual([a1.id]);
      expect(await ids(w.faLaw)).toEqual([a1.id, a2.id].sort());
      expect(await ids(w.reg)).toEqual([a1.id, a2.id].sort());
      expect(await ids(w.faEdu)).toEqual([]);
      expect(await ids(w.faNone)).toEqual([]);
    });
    it("shows applicants only their own applications", async () => {
      expect((await caller(h, w.app1).applications.list()).map((row) => row.id)).toEqual([a1.id]);
      expect((await caller(h, w.app2).applications.list()).map((row) => row.id)).toEqual([a2.id]);
      expect((await caller(h, w.faSci).applications.list()).map((row) => row.id)).toEqual([a1.id]);
      expect(await caller(h, w.faNone).applications.list()).toEqual([]);
    });
    it("reports out-of-scope applications as not found, on every per-application procedure", async () => {
      const out = caller(h, w.faSci);   // Science cannot see a2
      await rejectsWith("NOT_FOUND", out.applications.get({ id: a2.id }));
      await rejectsWith("NOT_FOUND", out.documents.list({ applicationId: a2.id }));
      await rejectsWith("NOT_FOUND", out.staff.audit({ applicationId: a2.id }));
      await rejectsWith("NOT_FOUND", out.staff.advisory({ applicationId: a2.id }));
      await rejectsWith("NOT_FOUND", out.screening.run({ applicationId: a2.id }));
      await rejectsWith("NOT_FOUND", out.screening.one({ applicationId: a2.id, programmeId: "umu-bsc-cs" }));
      await rejectsWith("NOT_FOUND", out.staff.reopenApplication({ applicationId: a2.id, reason: "Not my faculty at all" }));
      await rejectsWith("NOT_FOUND", out.staff.setDocumentDeadline({ applicationId: a2.id, deadline: "2026-12-01", reason: "Not my faculty at all" }));
      await rejectsWith("NOT_FOUND", caller(h, w.faNone).applications.get({ id: a1.id }));
      await rejectsWith("NOT_FOUND", caller(h, w.app2).applications.get({ id: a1.id }));
      await rejectsWith("NOT_FOUND", caller(h, w.faEdu).applications.get({ id: a1.id }));
    });
    it("shows a faculty administrator only their own faculty's screening runs", async () => {
      const sci = await caller(h, w.faSci).applications.get({ id: a1.id });
      const law = await caller(h, w.faLaw).applications.get({ id: a1.id });
      expect(sci.screenings.length).toBeGreaterThan(0);
      expect(sci.screenings.every((run) => run.facultyId === "science")).toBe(true);
      expect(law.screenings.length).toBeGreaterThan(0);
      expect(law.screenings.every((run) => run.facultyId === "law")).toBe(true);
      const all = await caller(h, w.reg).applications.get({ id: a1.id });
      expect(new Set(all.screenings.map((run) => run.facultyId)).size).toBeGreaterThan(2);
      expect((await caller(h, w.app1).applications.get({ id: a1.id })).screenings).toEqual([]);
    });
    it("keeps rule data behind staff procedures", async () => {
      const applicant = caller(h, w.app1);
      await rejectsWith("FORBIDDEN", applicant.screening.run({ applicationId: a1.id }));
      await rejectsWith("FORBIDDEN", applicant.catalog.list());
      await rejectsWith("FORBIDDEN", applicant.rules.proxyStatus());
      const choices = await applicant.catalog.choices();
      expect(choices.length).toBeGreaterThan(0);
      expect(choices[0]).not.toHaveProperty("ruleIds");
      expect(choices[0]).not.toHaveProperty("mappingStatus");
    });
    it("returns only the screening results for the administrator's faculty from a full re-screen", async () => {
      const results = await caller(h, w.faSci).screening.run({ applicationId: a1.id });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((item) => item.mapping.facultyId === "science")).toBe(true);
    });
    it("hides programme choices in other faculties from a faculty administrator", async () => {
      const sci = await caller(h, w.faSci).applications.get({ id: a1.id });
      const law = await caller(h, w.faLaw).applications.get({ id: a1.id });
      const reg = await caller(h, w.reg).applications.get({ id: a1.id });
      expect(sci.choices.map((c) => c.programmeId)).toEqual(["umu-bsc-cs"]);
      expect(law.choices.map((c) => c.programmeId)).toEqual(["umu-llb"]);
      expect(reg.choices.map((c) => c.programmeId)).toEqual(["umu-bsc-cs", "umu-llb"]);
      expect(sci.application.requestedProgrammeId).toBe("umu-bsc-cs");
      expect(law.application.requestedProgrammeId).toBeNull();      // first choice is a Science programme
      const queueLaw = (await caller(h, w.faLaw).staff.queue()).find((row) => row.id === a1.id)!;
      expect(queueLaw.requestedProgrammeId).toBeNull();
    });
    it("redacts history: applicants see only their own actions, faculty administrators lose other faculties' counts", async () => {
      const appView = await caller(h, w.app1).applications.get({ id: a1.id });
      expect(appView.history.length).toBeGreaterThan(0);
      expect(appView.history.every((event) => event.actorUserId === w.app1.id)).toBe(true);
      const lawView = await caller(h, w.faLaw).applications.get({ id: a1.id });
      const regView = await caller(h, w.reg).applications.get({ id: a1.id });
      const runEventLaw = lawView.history.find((event) => event.action === "screening_run");
      const runEventReg = regView.history.find((event) => event.action === "screening_run");
      expect(runEventReg && "outcomes" in ((runEventReg.afterData ?? {}) as object)).toBe(true);
      expect(runEventLaw && "outcomes" in ((runEventLaw.afterData ?? {}) as object)).toBe(false);
      const audit = await caller(h, w.faLaw).staff.audit({ applicationId: a1.id });
      expect(audit.every((event) => !("outcomes" in ((event.afterData ?? {}) as object)))).toBe(true);
    });
    it("limits the CSV export to the administrator's applications", async () => {
      const sci = (await caller(h, w.faSci).staff.exportCsv()).csv;
      const law = (await caller(h, w.faLaw).staff.exportCsv()).csv;
      expect(sci).toContain(a1.reference);
      expect(sci).not.toContain(a2.reference);
      expect(law).toContain(a1.reference);
      expect(law).toContain(a2.reference);
    });
    it("scopes the document queue, appeals and evaluation counts", async () => {
      await h.db.insert(applicantDocuments).values([
        { applicationId: a1.id, documentType: "NATIONAL_ID", status: "uploaded" },
        { applicationId: a2.id, documentType: "NATIONAL_ID", status: "uploaded" },
      ]);
      expect((await caller(h, w.faSci).staff.applications()).length).toBe(1);
      expect((await caller(h, w.faLaw).staff.applications()).length).toBe(2);
      expect((await caller(h, w.faEdu).staff.applications()).length).toBe(0);

      await caller(h, w.app2).applicant.appeal({ applicationId: a2.id, message: "Please review my screening result." });
      expect((await caller(h, w.faSci).staff.appeals()).length).toBe(0);
      expect((await caller(h, w.faLaw).staff.appeals()).length).toBe(1);
      expect((await caller(h, w.reg).staff.appeals()).length).toBe(1);

      const evalSci = await caller(h, w.faSci).evaluation();
      const evalLaw = await caller(h, w.faLaw).evaluation();
      const sciRuns = await h.db.select().from(screeningRuns).where(and(eq(screeningRuns.applicationId, a1.id), eq(screeningRuns.facultyId, "science")));
      expect(evalSci.counts.applications).toBe(1);
      expect(evalLaw.counts.applications).toBe(2);
      expect(evalSci.counts.screeningRuns).toBe(sciRuns.length);
      expect(evalSci.counts.documents).toBe(1);
    });
    it("fails closed: a faculty administrator with no faculty sees nothing at all", async () => {
      const c = caller(h, w.faNone);
      expect(await c.staff.queue()).toEqual([]);
      expect(await c.staff.applications()).toEqual([]);
      expect(await c.staff.appeals()).toEqual([]);
      expect((await c.staff.exportCsv()).csv.split("\r\n").length).toBe(1);   // header only
      expect((await c.evaluation()).counts.applications).toBe(0);
    });
  });

  describe("programme choices", () => {
    it("withdrawing a faculty's only choice removes that faculty's access but keeps the history", async () => {
      await caller(h, w.app1).applications.setProgrammeChoices({ id: a1.id, programmeIds: ["umu-llb"] });
      await rejectsWith("NOT_FOUND", caller(h, w.faSci).applications.get({ id: a1.id }));
      expect(await caller(h, w.faSci).staff.queue()).toEqual([]);
      expect((await caller(h, w.faLaw).staff.queue()).map((row) => row.id).sort()).toEqual([a1.id, a2.id].sort());
      const stillThere = await h.db.select().from(screeningRuns).where(and(eq(screeningRuns.applicationId, a1.id), eq(screeningRuns.facultyId, "science")));
      expect(stillThere.length).toBeGreaterThan(0);
      const choices = await h.db.select().from(applicationProgrammes).where(eq(applicationProgrammes.applicationId, a1.id));
      expect(choices.find((c) => c.programmeId === "umu-bsc-cs")!.status).toBe("withdrawn");
    });
    it("adding a choice gives that faculty access and notifies only its administrators", async () => {
      await h.db.delete(notifications);
      await caller(h, w.app2).applications.setProgrammeChoices({ id: a2.id, programmeIds: ["umu-llb", "umu-bsc-it"] });
      expect((await caller(h, w.faSci).staff.queue()).map((row) => row.id).sort()).toEqual([a1.id, a2.id].sort());
      const recipients = (await h.db.select().from(notifications)).map((row) => row.recipientUserId).sort();
      expect(recipients).toEqual([w.faSci.id, w.faLaw.id].sort());   // not Education, not the unassigned administrator, not the registrar
    });
    it("sends an appeal to the administrators of the faculties applied to, and to nobody else", async () => {
      await h.db.delete(notifications);
      await caller(h, w.app1).applicant.appeal({ applicationId: a1.id, message: "Please review my screening result." });
      const recipients = (await h.db.select().from(notifications)).map((row) => row.recipientUserId).sort();
      expect(recipients).toEqual([w.faSci.id, w.faLaw.id].sort());
    });
    it("notifies the registrars when an application has no submitted choice yet", async () => {
      await h.db.delete(notifications);
      await caller(h, w.app1).applications.setProgrammeChoices({ id: a1.id, programmeIds: [] });
      await h.db.delete(notifications);
      await caller(h, w.app1).applicant.appeal({ applicationId: a1.id, message: "Nobody can see my application yet." });
      // Registrars, including the project owner account, which acts as a registrar.
      expect((await h.db.select().from(notifications)).map((row) => row.recipientUserId).sort()).toEqual([w.reg.id, w.owner.id].sort());
    });
    it("will not submit without a programme choice", async () => {
      const c = caller(h, w.app1);
      const { id } = await c.applications.create({ applicantName: "No Choice", intake: "2026/27", level: "bachelors" });
      await rejectsWith("PRECONDITION_FAILED", c.applications.updateProfile({ id, applicantName: "No Choice", intake: "2026/27", level: "bachelors", submit: true }));
      await c.applications.updateProfile({ id, applicantName: "No Choice", intake: "2026/27", level: "bachelors", requestedProgrammeId: "umu-bsc-cs", submit: true });   // the requested programme becomes the first choice
      expect((await caller(h, w.faSci).staff.queue()).map((row) => row.id)).toContain(id);
    });
    it("rejects umbrella entries, unknown programmes and too many choices, without changing existing choices", async () => {
      const c = caller(h, w.app1);
      await rejectsWith("BAD_REQUEST", c.applications.setProgrammeChoices({ id: a1.id, programmeIds: ["umu-postgraduates"] }));
      await rejectsWith("BAD_REQUEST", c.applications.setProgrammeChoices({ id: a1.id, programmeIds: ["umu-bsc-cs", "not-a-programme"] }));
      await rejectsWith("BAD_REQUEST", c.applications.setProgrammeChoices({ id: a1.id, programmeIds: ["umu-bsc-cs", "umu-bsc-it", "umu-bagric", "umu-bbam", "umu-llb", "umu-bsc-general"] }));
      const detail = await caller(h, w.reg).applications.get({ id: a1.id });
      expect(detail.choices.filter((c) => c.status === "submitted").map((c) => c.programmeId)).toEqual(["umu-bsc-cs", "umu-llb"]);
    });
    it("rejects a choice made by someone else's applicant", async () => {
      await rejectsWith("NOT_FOUND", caller(h, w.app2).applications.setProgrammeChoices({ id: a1.id, programmeIds: ["umu-llb"] }));
    });
  });

  describe("committee decisions", () => {
    it("lets a faculty administrator decide only on programmes in their own faculty", async () => {
      await rejectsWith("FORBIDDEN", caller(h, w.faLaw).staff.decisions({ applicationId: a1.id, programmeId: "umu-bsc-cs", decision: "decline", reason: "Not in my faculty at all" }));
      await rejectsWith("FORBIDDEN", caller(h, w.faSci).staff.decisions({ applicationId: a1.id, programmeId: "umu-llb", decision: "decline", reason: "Not in my faculty at all" }));
    });
    it("requires that the applicant applied to the programme", async () => {
      await rejectsWith("PRECONDITION_FAILED", caller(h, w.faSci).staff.decisions({ applicationId: a1.id, programmeId: "umu-bsc-it", decision: "decline", reason: "The applicant never applied here" }));
    });
    it("records a decision against the faculty and shows it only to the right people", async () => {
      await caller(h, w.faSci).staff.decisions({ applicationId: a1.id, programmeId: "umu-bsc-cs", decision: "decline", reason: "Insufficient evidence for this programme" });
      const sci = await caller(h, w.faSci).applications.get({ id: a1.id });
      const law = await caller(h, w.faLaw).applications.get({ id: a1.id });
      const app = await caller(h, w.app1).applications.get({ id: a1.id });
      const reg = await caller(h, w.reg).applications.get({ id: a1.id });
      expect(sci.decisions).toHaveLength(1);
      expect(sci.decisions[0]).toMatchObject({ facultyId: "science", reason: "Insufficient evidence for this programme" });
      expect(law.decisions).toHaveLength(0);
      expect(reg.decisions).toHaveLength(1);
      expect(app.decisions).toHaveLength(1);
      expect(app.decisions[0]).toEqual({ id: expect.any(Number), programmeId: "umu-bsc-cs", decision: "decline", decidedAt: expect.any(Date) });
      expect("reason" in app.decisions[0]!).toBe(false);
      const trail = await h.db.select().from(auditEvents).where(eq(auditEvents.action, "committee_decision_recorded"));
      expect(trail).toHaveLength(1);
      // Law cannot learn of the Science decision through its own history either
      expect((await caller(h, w.faLaw).staff.audit({ applicationId: a1.id })).some((event) => event.action === "committee_decision_recorded")).toBe(false);
    });
  });

  describe("role assignment", () => {
    it("requires a faculty for a faculty administrator and forbids one for anyone else", async () => {
      const c = caller(h, w.reg);
      const target = await makeUser(h, "new-staff", "applicant");
      await rejectsWith("BAD_REQUEST", c.profile.setRole({ userId: target.id, role: "faculty_administrator" }));
      await rejectsWith("BAD_REQUEST", c.profile.setRole({ userId: target.id, role: "faculty_administrator", facultyId: "no-such-faculty" }));
      await rejectsWith("BAD_REQUEST", c.profile.setRole({ userId: target.id, role: "registrar", facultyId: "science" }));
      await rejectsWith("BAD_REQUEST", c.profile.setRole({ userId: target.id, role: "applicant", facultyId: "science" }));
      await c.profile.setRole({ userId: target.id, role: "faculty_administrator", facultyId: "education" });
      const after = (await h.db.select().from(users).where(eq(users.id, target.id)))[0]!;
      expect(after).toMatchObject({ aspireRole: "faculty_administrator", facultyId: "education" });
      await c.profile.setRole({ userId: target.id, role: "applicant" });
      expect((await h.db.select().from(users).where(eq(users.id, target.id)))[0]).toMatchObject({ aspireRole: "applicant", facultyId: null });
      const trail = await h.db.select().from(auditEvents).where(eq(auditEvents.action, "user_role_changed"));
      expect(trail.length).toBe(2);
    });
    it("lets a newly assigned faculty administrator see their faculty immediately", async () => {
      const target = await makeUser(h, "new-staff-2", "applicant");
      await caller(h, w.reg).profile.setRole({ userId: target.id, role: "faculty_administrator", facultyId: "science" });
      const fresh = (await h.db.select().from(users).where(eq(users.id, target.id)))[0]!;
      expect((await caller(h, fresh).staff.queue()).map((row) => row.id)).toEqual([a1.id]);
      expect((await caller(h, fresh).profile.me()).facultyName).toBe("Faculty of Science");
    });
    it("protects the project owner and the last registrar", async () => {
      await rejectsWith("FORBIDDEN", caller(h, w.reg).profile.setRole({ userId: w.owner.id, role: "applicant" }));
      // With the owner present, the other registrar may step down; the owner then is the last registrar.
      await caller(h, w.reg).profile.setRole({ userId: w.reg.id, role: "applicant" });
      await rejectsWith("FORBIDDEN", caller(h, w.owner).profile.setRole({ userId: w.owner.id, role: "applicant" }));
    });
    it("never lets the only registrar demote themselves", async () => {
      await resetDb(h.conn);
      const solo = await makeWorld(h, { owner: false });
      await rejectsWith("FORBIDDEN", caller(h, solo.reg).profile.setRole({ userId: solo.reg.id, role: "applicant" }));
    });
  });
});
