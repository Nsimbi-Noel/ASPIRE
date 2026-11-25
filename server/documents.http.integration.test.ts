import { execFile, execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "@shared/const";
import {
  applicantDocuments,
  auditEvents,
  users,
  type User,
} from "../drizzle/schema";
import { signSession } from "./_core/auth";
import { createApp } from "./_core/app";
import { hashPassword } from "./services/passwords";
import { fileStore } from "./storage";
import {
  connectTestDb,
  resetDb,
  submittedApplication,
  TEST_DB,
  type Harness,
} from "./testing/harness";

const run = promisify(execFile);
const PASSWORD = "River!Lamp42Cedar";
const STORED_KEYS: string[] = [];

function toolExists(command: string, arg: string): boolean {
  try {
    execFileSync(command, [arg], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

const TOOLS_AVAILABLE = (["pdftotext", "pdftoppm", "tesseract"] as const).every(
  tool => toolExists(tool, tool === "tesseract" ? "--version" : "-v")
);
const suite = TEST_DB && TOOLS_AVAILABLE ? describe : describe.skip;

function makePdf(lines: string[]): Buffer {
  const escape = (text: string) =>
    text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const content = [
    "BT /F1 20 Tf 72 730 Td (ASPIRE RESULT SLIP 42) Tj ET",
    ...lines.map(
      (line, index) =>
        `BT /F1 16 Tf 72 ${690 - index * 28} Td (${escape(line)}) Tj ET`
    ),
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

async function withTempFile(
  bytes: Buffer,
  extension: string,
  work: (file: string) => Promise<void>
) {
  const dir = await mkdtemp(path.join(tmpdir(), "aspire-http-"));
  try {
    const file = path.join(dir, `document${extension}`);
    await writeFile(file, bytes);
    await work(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function pdfText(bytes: Buffer): Promise<string> {
  let text = "";
  await withTempFile(bytes, ".pdf", async file => {
    text = (await run("pdftotext", ["-layout", "-enc", "UTF-8", file, "-"]))
      .stdout;
  });
  return text;
}

async function imageText(bytes: Buffer): Promise<string> {
  let text = "";
  await withTempFile(bytes, ".png", async file => {
    text = (await run("tesseract", [file, "stdout", "txt"])).stdout;
  });
  return text;
}

suite("documents over real HTTP", () => {
  let h: Harness;
  let server: Server;
  let baseUrl: string;
  let workdir: string;
  let owner: User;
  let applicant: User;
  let scienceStaff: User;
  let lawStaff: User;
  let scienceApplicationId: string;
  let pdf!: Buffer;
  let png!: Buffer;
  const documentIds: Record<string, number> = {};

  beforeAll(async () => {
    h = await connectTestDb();
    await resetDb(h.conn);
    workdir = await mkdtemp(path.join(tmpdir(), "aspire-http-fixture-"));
    const app = createApp();
    server = app.listen(0);
    await new Promise<void>(resolve => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const registrar = await h.db.insert(users).values({
      openId: "http-owner",
      name: "Project Owner",
      email: "owner@example.org",
      loginMethod: "password",
      role: "admin",
      aspireRole: "registrar",
      passwordHash: await hashPassword(PASSWORD),
    });
    owner = (
      await h.db.select().from(users).where(eq(users.id, registrar[0].insertId))
    )[0]!;

    const makeStaff = async (
      openId: string,
      email: string,
      facultyId: string
    ) => {
      const result = await h.db.insert(users).values({
        openId,
        name: openId,
        email,
        loginMethod: "password",
        role: "user",
        aspireRole: "faculty_administrator",
        facultyId,
        passwordHash: await hashPassword(PASSWORD),
      });
      return (
        await h.db.select().from(users).where(eq(users.id, result[0].insertId))
      )[0]!;
    };
    scienceStaff = await makeStaff(
      "http-science",
      "science@example.org",
      "science"
    );
    lawStaff = await makeStaff("http-law", "law@example.org", "law");

    const registered = await h.appRouter
      .createCaller({ user: null, req: {} as never, res: {} as never })
      .auth.register({
        name: "HTTP Applicant",
        email: "applicant@example.org",
        password: PASSWORD,
      });
    applicant = (
      await h.db.select().from(users).where(eq(users.id, registered.id))
    )[0]!;
    scienceApplicationId = (
      await submittedApplication(h, applicant, "HTTP Applicant", ["umu-bsc-cs"])
    ).id;

    const pdfFile = path.join(workdir, "slip.pdf");
    pdf = makePdf(["Mathematics A", "Physics B", "Candidate 42 UMU 2026"]);
    await writeFile(pdfFile, pdf);
    await run("pdftoppm", [
      "-f",
      "1",
      "-l",
      "1",
      "-r",
      "200",
      "-png",
      "-singlefile",
      pdfFile,
      path.join(workdir, "slip"),
    ]);
    png = await readFile(path.join(workdir, "slip.png"));

    const caller = h.appRouter.createCaller({
      user: applicant,
      req: {} as never,
      res: {} as never,
    });
    for (const [name, fileName, contentType, bytes] of [
      ["UACE_RESULT_SLIP", "result-slip.pdf", "application/pdf", pdf],
      ["NATIONAL_ID", "result-slip.png", "image/png", png],
    ] as const) {
      await caller.aspire.documents.upload({
        applicationId: scienceApplicationId,
        documentType: name,
        fileName,
        contentType,
        base64: bytes.toString("base64"),
      });
    }
    for (const row of await h.db.select().from(applicantDocuments)) {
      if (row.storageKey) STORED_KEYS.push(row.storageKey);
      if (row.contentType) documentIds[row.contentType] = row.id;
    }
  });

  afterAll(async () => {
    if (server)
      await new Promise<void>(resolve => server.close(() => resolve()));
    if (h) await h.conn.end();
    if (workdir) await rm(workdir, { recursive: true, force: true });
    for (const key of STORED_KEYS)
      await fileStore.remove(key).catch(() => undefined);
  });

  const cookieFor = async (user: User) =>
    `${SESSION_COOKIE}=${await signSession(user)}`;
  const get = async (documentId: number, cookie?: string) =>
    fetch(`${baseUrl}/api/documents/${documentId}/file`, {
      headers: cookie ? { cookie } : {},
      redirect: "manual",
    });

  it("reads the uploaded PDF with pdftotext and the uploaded PNG with tesseract", async () => {
    expect(await pdfText(pdf)).toContain("ASPIRE RESULT SLIP 42");
    expect(await pdfText(pdf)).toContain("Mathematics A");
    const ocr = await imageText(png);
    expect(ocr.replace(/\s+/g, " ").trim().length).toBeGreaterThan(10);
    expect(ocr).toMatch(/ASPIRE|RESULT|SLIP|MATHEMATICS/i);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    );
  });

  it("records advisory extraction without confirming any mark", async () => {
    const rows = await h.db.select().from(applicantDocuments);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.storageKey).toMatch(/^private-applications\//);
      const fields = row.extractedFields as {
        status: string;
        source: string;
        candidates: unknown[];
      };
      expect(["extracted", "low_confidence", "unreadable"]).toContain(
        fields.status
      );
      expect(fields.source).toContain("never auto-confirms");
      expect(await fileStore.get(row.storageKey!)).toBeDefined();
    }
  });

  for (const [label, contentType, bytes] of [
    ["PDF", "application/pdf", pdf],
    ["PNG", "image/png", png],
  ] as const) {
    it(`serves the ${label} over HTTP to the document owner and the project owner`, async () => {
      const documentId = documentIds[contentType]!;
      for (const [name, actor] of [
        ["applicant", applicant],
        ["registrar", owner],
      ] as const) {
        const response = await get(documentId, await cookieFor(actor));
        expect(
          response.status,
          `${name} should be able to read the document`
        ).toBe(200);
        expect(response.headers.get("content-type")).toContain(contentType);
        expect(response.headers.get("cache-control")).toContain("no-store");
        expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
      }
    });

    it(`serves the ${label} to in-scope staff but not out-of-scope or signed-out users`, async () => {
      const documentId = documentIds[contentType]!;
      expect(
        (await get(documentId, await cookieFor(scienceStaff))).status
      ).toBe(200);
      const outOfScope = await get(documentId, await cookieFor(lawStaff));
      expect(outOfScope.status).toBe(404);
      expect(await outOfScope.text()).toContain("Document not found");
      expect((await get(documentId)).status).toBe(401);
    });
  }

  it("refuses the document to a user who still has a temporary password", async () => {
    const result = await h.db.insert(users).values({
      openId: "http-forced",
      name: "Forced User",
      email: "forced@example.org",
      loginMethod: "password",
      role: "user",
      aspireRole: "registrar",
      passwordHash: await hashPassword(PASSWORD),
      mustChangePassword: true,
    });
    const forced = (
      await h.db.select().from(users).where(eq(users.id, result[0].insertId))
    )[0]!;
    const response = await get(
      documentIds["application/pdf"]!,
      await cookieFor(forced)
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("Choose your own password");
  });

  it("audits every successful view and never exposes a storage key", async () => {
    const before = (await h.db.select().from(auditEvents)).filter(
      event => event.action === "document_viewed"
    ).length;
    await get(documentIds["application/pdf"]!, await cookieFor(applicant));
    const views = (await h.db.select().from(auditEvents)).filter(
      event => event.action === "document_viewed"
    );
    expect(views.length).toBe(before + 1);
    const list = await h.appRouter
      .createCaller({ user: applicant, req: {} as never, res: {} as never })
      .aspire.documents.list({ applicationId: scienceApplicationId });
    expect(list).toHaveLength(2);
    expect(JSON.stringify(list)).not.toContain("storageKey");
  });
});
