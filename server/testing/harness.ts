import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import { applicantDocuments, screeningRuns, users, type User } from "../../drizzle/schema";

/** Integration tests run only when TEST_DATABASE_URL points at a disposable MySQL database. */
export const TEST_DB = process.env.TEST_DATABASE_URL;

/** The tests empty every table, so refuse to touch anything that is not clearly a disposable test database. */
export function assertDisposable(url: string) {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(name)) throw new Error(`Refusing to run: the database name "${name}" does not contain "test". These tests delete all data; use a disposable database.`);
}

export async function connectTestDb() {
  assertDisposable(TEST_DB!);
  process.env.DATABASE_URL = TEST_DB;
  const conn = await mysql.createConnection(TEST_DB!);
  const db = drizzle(conn);
  await migrate(db, { migrationsFolder: "./drizzle" });
  const { appRouter } = await import("../routers");
  return { conn, db, appRouter };
}
export type Harness = Awaited<ReturnType<typeof connectTestDb>>;

/** Empties every table except the migration journal and the faculty reference data. */
export async function resetDb(conn: Harness["conn"]) {
  await conn.query("SET FOREIGN_KEY_CHECKS = 0");
  const [rows] = (await conn.query("SHOW TABLES")) as unknown as [Array<Record<string, string>>];
  for (const row of rows) {
    const table = Object.values(row)[0]!;
    if (table === "__drizzle_migrations" || table === "faculties") continue;
    await conn.query(`TRUNCATE TABLE \`${table}\``);
  }
  await conn.query("SET FOREIGN_KEY_CHECKS = 1");
}

export async function makeUser(h: Harness, openId: string, aspireRole: User["aspireRole"], facultyId: string | null = null, role: User["role"] = "user") {
  await h.db.insert(users).values({ openId, name: openId, email: `${openId}@test.org`, loginMethod: "test", role, aspireRole, facultyId });
  const rows = await h.db.select().from(users).where(eq(users.openId, openId));
  return rows[0]!;
}

export const caller = (h: Harness, user: User | null) => h.appRouter.createCaller({ user, req: {} as never, res: {} as never }).aspire;

export interface World {
  reg: User; owner: User;
  faSci: User; faLaw: User; faEdu: User; faNone: User;
  app1: User; app2: User;
}

export async function makeWorld(h: Harness, options: { owner?: boolean } = {}): Promise<World> {
  const reg = await makeUser(h, "registrar-1", "registrar");
  const owner = options.owner === false ? reg : await makeUser(h, "project-owner", "applicant", null, "admin");
  return {
    reg, owner,
    faSci: await makeUser(h, "fa-science", "faculty_administrator", "science"),
    faLaw: await makeUser(h, "fa-law", "faculty_administrator", "law"),
    faEdu: await makeUser(h, "fa-education", "faculty_administrator", "education"),
    // A faculty administrator with no faculty (for example migrated from the old officer role) sees nothing.
    faNone: await makeUser(h, "fa-unassigned", "faculty_administrator", null),
    app1: await makeUser(h, "applicant-1", "applicant"),
    app2: await makeUser(h, "applicant-2", "applicant"),
  };
}

export const TWO_PRINCIPALS = [
  { exam: "UACE" as const, subject: "Mathematics", grade: "A", subjectLevel: "PRINCIPAL" as const, sitting: "2025" },
  { exam: "UACE" as const, subject: "Physics", grade: "B", subjectLevel: "PRINCIPAL" as const, sitting: "2025" },
];

/** An applicant creates, fills in and submits an application for the given programmes. */
export async function submittedApplication(h: Harness, applicant: User, name: string, programmeIds: string[]) {
  const c = caller(h, applicant);
  const { id, reference } = await c.applications.create({ applicantName: name, intake: "2026/27", level: "bachelors" });
  await c.applications.saveResults({ id, results: TWO_PRINCIPALS });
  if (programmeIds.length) await c.applications.setProgrammeChoices({ id, programmeIds });
  await c.applications.updateProfile({ id, applicantName: name, intake: "2026/27", level: "bachelors", submit: true });
  return { id, reference };
}

/** Faculty verification path that supplies the evidence an admit decision needs, then screens again. */
export async function makeAdmitReady(h: Harness, facultyAdmin: User, applicationId: string) {
  await h.db.insert(applicantDocuments).values([
    { applicationId, documentType: "UACE_RESULT_SLIP", status: "uploaded" },
    { applicationId, documentType: "NATIONAL_ID", status: "uploaded" },
  ]);
  const documents = await h.db.select().from(applicantDocuments).where(eq(applicantDocuments.applicationId, applicationId));
  for (const document of documents) {
    await caller(h, facultyAdmin).documents.review({ documentId: document.id, status: "verified", reviewNote: "Compared with the uploaded source document; no unresolved discrepancies.", mismatchesResolved: false });
  }
  await caller(h, facultyAdmin).applications.confirmOfficialResults({ id: applicationId, reviewNote: "Each active grade was checked against the verified UNEB result slip." });
  await caller(h, facultyAdmin).screening.run({ applicationId });
}

/** Records the faculty's say before a registrar final verdict. */
export async function recommend(h: Harness, facultyAdmin: User, applicationId: string, programmeId: string, recommendation: "admit" | "decline" | "defer" | "request_information" = "admit", reason = "Faculty reviewed the screening evidence and the verified academic record.") {
  await caller(h, facultyAdmin).staff.recommend({ applicationId, programmeId, recommendation, reason });
}

export async function latestRun(h: Harness, applicationId: string, programmeId: string) {
  const rows = await h.db.select().from(screeningRuns).where(eq(screeningRuns.applicationId, applicationId));
  return rows.filter((row) => row.programmeId === programmeId).sort((a, b) => b.id - a.id)[0];
}

export async function rejectsWith(code: string, promise: Promise<unknown>) {
  await promise.then(
    () => { throw new Error(`Expected the call to fail with ${code}, but it succeeded.`); },
    (error: { code?: string; message?: string }) => {
      if (error.code !== code) throw new Error(`Expected ${code} but got ${error.code}: ${error.message}`);
    },
  );
}
