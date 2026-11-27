import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applicantDocuments, applicationProgrammes, applications, auditEvents, examResults, notifications, screeningRuns, users } from "../drizzle/schema";
import {
  TEST_DB, TWO_PRINCIPALS, caller, connectTestDb, makeUser, makeWorld, rejectsWith, resetDb, submittedApplication,
  type Harness, type World,
} from "./testing/harness";
import { LAUNCH_INTAKE } from "@shared/const";
import { facultyOfProgramme } from "./services/screeningService";

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
    it("lets faculty administrators verify academic evidence, not registrars", async () => {
      const inserted = await h.db.insert(applicantDocuments).values([
        { applicationId: a1.id, documentType: "UACE_RESULT_SLIP", status: "uploaded" },
        { applicationId: a1.id, documentType: "NATIONAL_ID", status: "uploaded" },
      ]);
      const rows = await h.db.select().from(applicantDocuments).where(eq(applicantDocuments.applicationId, a1.id));
      for (const document of rows) {
        await rejectsWith("FORBIDDEN", caller(h, w.reg).documents.review({ documentId: document.id, status: "verified", reviewNote: "Registrar must not verify faculty evidence.", mismatchesResolved: false }));
        await caller(h, w.faSci).documents.review({ documentId: document.id, status: "verified", reviewNote: "Compared with the original source document.", mismatchesResolved: false });
      }
      await rejectsWith("FORBIDDEN", caller(h, w.reg).applications.confirmOfficialResults({ id: a1.id, reviewNote: "Registrar must not confirm academic marks." }));
      await caller(h, w.faSci).applications.confirmOfficialResults({ id: a1.id, reviewNote: "Marks checked against the verified UNEB slip." });
      const verified = await h.db.select().from(applicantDocuments).where(eq(applicantDocuments.applicationId, a1.id));
      expect(verified.every((doc) => doc.status === "verified" && doc.reviewedBy === w.faSci.id)).toBe(true);
      expect(inserted.length).toBe(2);
    });
    it("normalizes numeric UCE and UACE subsidiary grades through saveResults", async () => {
      await caller(h, w.reg).applications.saveResults({ id: a1.id, results: [
        { exam: "UCE", subject: "Maths", grade: "3", sitting: "2025" },
        { exam: "UACE", subject: "General Paper", grade: "O", subjectLevel: "SUBSIDIARY", sitting: "2025" },
        { exam: "UACE", subject: "Subsidiary Mathematics", grade: "d1", subjectLevel: "SUBSIDIARY", sitting: "2025" },
      ] });
      const detail = await caller(h, w.reg).applications.get({ id: a1.id });
      expect(detail.results).toEqual(expect.arrayContaining([
        expect.objectContaining({ exam: "UCE", subject: "Mathematics", grade: "3" }),
        expect.objectContaining({ exam: "UACE", subject: "General Paper", grade: "O", subjectLevel: "SUBSIDIARY" }),
        expect.objectContaining({ exam: "UACE", subject: "Subsidiary Mathematics", grade: "1", subjectLevel: "SUBSIDIARY" }),
      ]));
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
    it("shows faculty administrators only programmes in their own faculty", async () => {
      const sci = await caller(h, w.faSci).catalog.list();
      const law = await caller(h, w.faLaw).catalog.list();
      const all = await caller(h, w.reg).catalog.list();
      expect(sci.length).toBeGreaterThan(0);
      expect(sci.every((programme) => facultyOfProgramme(programme.id) === "science")).toBe(true);
      expect(law.every((programme) => facultyOfProgramme(programme.id) === "law")).toBe(true);
      expect(sci.some((programme) => programme.id === "umu-bsc-cs")).toBe(true);
      expect(sci.some((programme) => programme.id === "umu-llb")).toBe(false);
      expect(all.some((programme) => programme.id === "umu-postgraduates")).toBe(true);
      expect(await caller(h, w.faNone).catalog.list()).toEqual([]);
      expect((await caller(h, w.faSci).catalog.faculties()).map((faculty) => faculty.id)).toEqual(["science"]);
      expect((await caller(h, w.faSci).catalog.choices()).every((programme) => programme.facultyId === "science")).toBe(true);
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
      await h.db.insert(notifications).values({ recipientUserId: w.faSci.id, applicationId: a1.id, title: "Science case", message: "A case reference from a now out-of-scope application." });
      expect((await caller(h, w.faSci).applicant.notifications()).some((row) => row.title === "Science case")).toBe(true);
      await caller(h, w.app1).applications.setProgrammeChoices({ id: a1.id, programmeIds: ["umu-llb"] });
      expect((await caller(h, w.faSci).applicant.notifications()).some((row) => row.title === "Science case")).toBe(false);
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
    it("keeps applicant preference order independent of outcome-sorted recommendations", async () => {
      const c = caller(h, w.app1);
      await c.applications.setProgrammeChoices({ id: a1.id, programmeIds: ["umu-llb", "umu-bsc-cs"] });
      await h.db.delete(screeningRuns).where(eq(screeningRuns.applicationId, a1.id));
      await h.db.insert(screeningRuns).values([
        { applicationId: a1.id, programmeId: "umu-bsc-cs", programmeName: "Bachelor of Science in Computer Science", outcome: "ELIGIBLE", ruleSetVersion: "test", ruleStatus: "assumed", facultyId: "science", inputSnapshot: {}, resultTrace: { explanation: "eligible for this test" } },
        { applicationId: a1.id, programmeId: "umu-llb", programmeName: "Bachelor of Laws", outcome: "ON_HOLD", ruleSetVersion: "test", ruleStatus: "needs-review", facultyId: "law", inputSnapshot: {}, resultTrace: { explanation: "on hold for this test" } },
      ]);
      const detail = await c.applications.get({ id: a1.id });
      expect(detail.choices.filter((row) => row.status === "submitted").map(({ programmeId, choiceRank }) => ({ programmeId, choiceRank }))).toEqual([{ programmeId: "umu-llb", choiceRank: 1 }, { programmeId: "umu-bsc-cs", choiceRank: 2 }]);
      expect((detail.recommendations ?? []).map((item) => item.programmeId)).toEqual(["umu-bsc-cs", "umu-llb"]);
    });
    it("rejects a choice made by someone else's applicant", async () => {
      await rejectsWith("NOT_FOUND", caller(h, w.app2).applications.setProgrammeChoices({ id: a1.id, programmeIds: ["umu-llb"] }));
    });
  });

  describe("supported intake", () => {
    it("accepts only the launch intake when creating and updating applications", async () => {
      const c = caller(h, w.app1);
      const created = await c.applications.create({ applicantName: "Supported Intake", intake: LAUNCH_INTAKE, level: "bachelors" });
      expect((await c.applications.get({ id: created.id })).application.intake).toBe(LAUNCH_INTAKE);
      await rejectsWith("BAD_REQUEST", c.applications.create({ applicantName: "Legacy Intake", intake: "2025/26", level: "bachelors" }));
      await rejectsWith("BAD_REQUEST", c.applications.create({ applicantName: "Future Intake", intake: "2027/28", level: "bachelors" }));
      await rejectsWith("BAD_REQUEST", c.applications.create({ applicantName: "Unknown Intake", intake: "not-an-intake", level: "bachelors" }));
      await c.applications.updateProfile({ id: a1.id, applicantName: "Applicant One", intake: LAUNCH_INTAKE, level: "bachelors" });
      await rejectsWith("BAD_REQUEST", c.applications.updateProfile({ id: a1.id, applicantName: "Applicant One", intake: "2025/26", level: "bachelors" }));
      await rejectsWith("BAD_REQUEST", c.applications.updateProfile({ id: a1.id, applicantName: "Applicant One", intake: "2027/28", level: "bachelors" }));
      await rejectsWith("BAD_REQUEST", c.applications.updateProfile({ id: a1.id, applicantName: "Applicant One", intake: "not-an-intake", level: "bachelors" }));
      const detail = await c.applications.get({ id: a1.id });
      expect(detail.application.intake).toBe(LAUNCH_INTAKE);
    });
    it("blocks screening and record changes on a legacy intake until it is corrected, without writing new traces", async () => {
      await h.db.update(applications).set({ intake: "2025/26" }).where(eq(applications.id, a1.id));
      const runCount = () => h.db.select().from(screeningRuns).where(eq(screeningRuns.applicationId, a1.id));
      const resultCount = () => h.db.select().from(examResults).where(eq(examResults.applicationId, a1.id));
      const runsBefore = (await runCount()).length;
      const resultsBefore = await resultCount();

      await rejectsWith("PRECONDITION_FAILED", caller(h, w.reg).screening.run({ applicationId: a1.id }));
      await rejectsWith("PRECONDITION_FAILED", caller(h, w.reg).screening.one({ applicationId: a1.id, programmeId: "umu-bsc-cs" }));
      await rejectsWith("PRECONDITION_FAILED", caller(h, w.app1).applications.saveResults({ id: a1.id, results: [{ exam: "UACE", subject: "Chemistry", grade: "A", subjectLevel: "PRINCIPAL", sitting: "2025" }] }));
      expect((await runCount()).length).toBe(runsBefore);
      expect(await resultCount()).toEqual(resultsBefore);

      await caller(h, w.app1).applications.updateProfile({ id: a1.id, applicantName: "Applicant One", intake: LAUNCH_INTAKE, level: "bachelors" });
      expect((await caller(h, w.app1).applications.get({ id: a1.id })).application.intake).toBe(LAUNCH_INTAKE);
      await caller(h, w.reg).screening.run({ applicationId: a1.id });
      expect((await runCount()).length).toBeGreaterThan(runsBefore);
    });
    it("refuses a results CSV for a legacy intake before changing any results", async () => {
      await h.db.update(applications).set({ intake: "2025/26" }).where(eq(applications.id, a1.id));
      const before = (await h.db.select().from(examResults).where(eq(examResults.applicationId, a1.id))).length;
      const csvText = `reference,exam,subject,grade,sitting,subjectLevel\n${a1.reference},UACE,Chemistry,A,2025,PRINCIPAL\n`;
      await rejectsWith("PRECONDITION_FAILED", caller(h, w.reg).staff.importResultsCsv({ csvText }));
      expect((await h.db.select().from(examResults).where(eq(examResults.applicationId, a1.id))).length).toBe(before);
    });
    it("keeps a legacy intake readable and unchanged until it is explicitly corrected", async () => {
      await h.db.update(applications).set({ intake: "2027/28" }).where(eq(applications.id, a1.id));
      const before = (await h.db.select().from(applications).where(eq(applications.id, a1.id)))[0]!;
      const detail = await caller(h, w.app1).applications.get({ id: a1.id });
      expect(detail.application.intake).toBe("2027/28");
      const afterRead = (await h.db.select().from(applications).where(eq(applications.id, a1.id)))[0]!;
      expect(afterRead).toEqual(before);
      await caller(h, w.app1).applications.updateProfile({ id: a1.id, applicantName: "Applicant One", intake: LAUNCH_INTAKE, level: "bachelors" });
      expect((await caller(h, w.app1).applications.get({ id: a1.id })).application.intake).toBe(LAUNCH_INTAKE);
    });
    it("omits provisional rank and fit from applicant recommendations and orders them by outcome, name and programme id", async () => {
      const historicalTrace = (explanation: string, rank: number, closenessCoefficient: number) => ({ explanation, recommendation: { rank, closenessCoefficient, method: "stored-historical" } });
      await h.db.delete(screeningRuns).where(eq(screeningRuns.applicationId, a1.id));
      await h.db.insert(screeningRuns).values([
        { applicationId: a1.id, programmeId: "elig-z", programmeName: "Zulu Science", outcome: "ELIGIBLE", ruleSetVersion: "test", ruleStatus: "assumed", facultyId: "science", inputSnapshot: {}, resultTrace: historicalTrace("eligible explanation", 4, 0.1) },
        { applicationId: a1.id, programmeId: "hold-a", programmeName: "Alpha Law", outcome: "ON_HOLD", ruleSetVersion: "test", ruleStatus: "needs-review", facultyId: "law", inputSnapshot: {}, resultTrace: historicalTrace("hold a explanation", 1, 0.9) },
        { applicationId: a1.id, programmeId: "hold-b", programmeName: "Beta Law", outcome: "ON_HOLD", ruleSetVersion: "test", ruleStatus: "needs-review", facultyId: "law", inputSnapshot: {}, resultTrace: historicalTrace("hold b explanation", 2, 0.8) },
        { applicationId: a1.id, programmeId: "hold-c", programmeName: "Alpha Law", outcome: "ON_HOLD", ruleSetVersion: "test", ruleStatus: "needs-review", facultyId: "law", inputSnapshot: {}, resultTrace: historicalTrace("hold c explanation", 3, 0.7) },
        { applicationId: a1.id, programmeId: "not-eligible-a", programmeName: "Aaaa Not Eligible", outcome: "NOT_ELIGIBLE", ruleSetVersion: "test", ruleStatus: "assumed", facultyId: "science", inputSnapshot: {}, resultTrace: historicalTrace("not eligible explanation", 0, 1) },
      ]);
      const traceBefore = await h.db.select({ programmeId: screeningRuns.programmeId, resultTrace: screeningRuns.resultTrace }).from(screeningRuns).where(eq(screeningRuns.applicationId, a1.id));
      const rankOf = (programmeId: string) => Number((traceBefore.find((row) => row.programmeId === programmeId)!.resultTrace as any).recommendation.rank);
      expect(rankOf("hold-a")).toBeLessThan(rankOf("elig-z"));
      const first = await caller(h, w.app1).applications.get({ id: a1.id });
      const second = await caller(h, w.app1).applications.get({ id: a1.id });
      const recommendations = first.recommendations ?? [];
      const expected = ["elig-z", "hold-a", "hold-c", "hold-b"];
      expect(recommendations.map((item) => item.programmeId)).toEqual(expected);
      expect((second.recommendations ?? []).map((item) => item.programmeId)).toEqual(expected);
      expect(recommendations.map((item) => item.outcome)).toEqual(["ELIGIBLE", "ON_HOLD", "ON_HOLD", "ON_HOLD"]);
      expect(recommendations.map((item) => item.programmeName)).toEqual(["Zulu Science", "Alpha Law", "Alpha Law", "Beta Law"]);
      for (const item of recommendations) {
        expect(item).not.toHaveProperty("rank");
        expect(item).not.toHaveProperty("closenessCoefficient");
      }
      expect(recommendations.some((item) => item.programmeId === "not-eligible-a")).toBe(false);
      const traceAfter = await h.db.select({ programmeId: screeningRuns.programmeId, resultTrace: screeningRuns.resultTrace }).from(screeningRuns).where(eq(screeningRuns.applicationId, a1.id));
      expect(traceAfter).toEqual(traceBefore);
    });
  });

  describe("faculty recommendation and registrar verdict", () => {
    it("keeps recommendations in the faculty and the final verdict with the registrar", async () => {
      await rejectsWith("FORBIDDEN", caller(h, w.faSci).staff.decisions({ applicationId: a1.id, programmeId: "umu-bsc-cs", decision: "decline", reason: "Faculty cannot record the final verdict." }));
      await rejectsWith("FORBIDDEN", caller(h, w.faLaw).staff.recommend({ applicationId: a1.id, programmeId: "umu-bsc-cs", recommendation: "decline", reason: "Not in my faculty at all" }));
      await rejectsWith("FORBIDDEN", caller(h, w.faSci).staff.recommend({ applicationId: a1.id, programmeId: "umu-llb", recommendation: "decline", reason: "Not in my faculty at all" }));
    });
    it("requires that the applicant applied to the programme", async () => {
      await rejectsWith("PRECONDITION_FAILED", caller(h, w.faSci).staff.recommend({ applicationId: a1.id, programmeId: "umu-bsc-it", recommendation: "decline", reason: "The applicant never applied here" }));
      await rejectsWith("PRECONDITION_FAILED", caller(h, w.faSci).screening.one({ applicationId: a1.id, programmeId: "umu-bsc-it" }));
    });
    it("blocks the registrar's verdict until the faculty has recommended", async () => {
      await rejectsWith("PRECONDITION_FAILED", caller(h, w.reg).staff.decisions({ applicationId: a1.id, programmeId: "umu-bsc-cs", decision: "decline", reason: "Deciding before the faculty has spoken." }));
    });
    it("records the faculty's say and the registrar's verdict, visible only to the right people", async () => {
      await caller(h, w.faSci).staff.recommend({ applicationId: a1.id, programmeId: "umu-bsc-cs", recommendation: "decline", reason: "Insufficient evidence for this programme" });
      await caller(h, w.reg).staff.decisions({ applicationId: a1.id, programmeId: "umu-bsc-cs", decision: "decline", reason: "Registrar accepted the faculty's recommendation." });
      const sci = await caller(h, w.faSci).applications.get({ id: a1.id });
      const law = await caller(h, w.faLaw).applications.get({ id: a1.id });
      const app = await caller(h, w.app1).applications.get({ id: a1.id });
      const reg = await caller(h, w.reg).applications.get({ id: a1.id });
      expect(sci.decisions).toHaveLength(1);
      expect(sci.decisions[0]).toMatchObject({ facultyId: "science", reason: "Registrar accepted the faculty's recommendation." });
      expect(sci.facultyRecommendations).toHaveLength(1);
      expect(sci.facultyRecommendations[0]).toMatchObject({ recommendation: "decline", facultyId: "science" });
      expect(law.decisions).toHaveLength(0);
      expect(law.facultyRecommendations).toHaveLength(0);
      expect(reg.decisions).toHaveLength(1);
      expect(reg.facultyRecommendations).toHaveLength(1);
      expect(app.decisions).toHaveLength(1);
      expect(app.decisions[0]).toEqual({ id: expect.any(Number), programmeId: "umu-bsc-cs", decision: "decline", decidedAt: expect.any(Date) });
      expect("reason" in app.decisions[0]!).toBe(false);
      expect(app.facultyRecommendations).toEqual([]);
      const trail = await h.db.select().from(auditEvents).where(eq(auditEvents.action, "registrar_final_decision"));
      expect(trail).toHaveLength(1);
      // Law cannot learn of the Science decision through its own history either
      expect((await caller(h, w.faLaw).staff.audit({ applicationId: a1.id })).some((event) => event.action === "registrar_final_decision")).toBe(false);
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
