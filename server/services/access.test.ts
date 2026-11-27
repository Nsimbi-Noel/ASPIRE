import { describe, expect, it } from "vitest";
import { canSeeFaculty, redactDecisionForApplicant, redactHistory, roleOf, scopeOf, validateRoleAssignment } from "./access";

describe("roles", () => {
  it("maps the project owner account to registrar", () => {
    expect(roleOf({ role: "admin", aspireRole: "applicant" })).toBe("registrar");
  });
  it("accepts the three roles and treats anything else as applicant", () => {
    expect(roleOf({ role: "user", aspireRole: "registrar" })).toBe("registrar");
    expect(roleOf({ role: "user", aspireRole: "faculty_administrator" })).toBe("faculty_administrator");
    expect(roleOf({ role: "user", aspireRole: "applicant" })).toBe("applicant");
    expect(roleOf({ role: "user", aspireRole: "officer" })).toBe("applicant");
    expect(roleOf({ role: "user", aspireRole: "committee" })).toBe("applicant");
    expect(roleOf({ role: "user", aspireRole: "administrator" })).toBe("applicant");
  });
});

describe("scope", () => {
  it("gives the registrar everything and applicants only their own", () => {
    expect(scopeOf({ id: 1, role: "user", aspireRole: "registrar" })).toEqual({ kind: "all" });
    expect(scopeOf({ id: 7, role: "user", aspireRole: "applicant" })).toEqual({ kind: "own", userId: 7 });
  });
  it("limits a faculty administrator to their faculty and fails closed without one", () => {
    expect(scopeOf({ id: 2, role: "user", aspireRole: "faculty_administrator", facultyId: "science" })).toEqual({ kind: "faculty", facultyId: "science" });
    expect(scopeOf({ id: 2, role: "user", aspireRole: "faculty_administrator", facultyId: null })).toEqual({ kind: "none" });
    expect(scopeOf({ id: 2, role: "user", aspireRole: "faculty_administrator" })).toEqual({ kind: "none" });
  });
  it("decides which faculty records are visible", () => {
    expect(canSeeFaculty({ kind: "all" }, "law")).toBe(true);
    expect(canSeeFaculty({ kind: "all" }, null)).toBe(true);
    expect(canSeeFaculty({ kind: "faculty", facultyId: "science" }, "science")).toBe(true);
    expect(canSeeFaculty({ kind: "faculty", facultyId: "science" }, "law")).toBe(false);
    expect(canSeeFaculty({ kind: "faculty", facultyId: "science" }, null)).toBe(false);
    expect(canSeeFaculty({ kind: "own", userId: 1 }, "science")).toBe(false);
    expect(canSeeFaculty({ kind: "none" }, "science")).toBe(false);
  });
});

describe("role assignment", () => {
  it("requires an existing faculty for a faculty administrator and forbids one for anyone else", () => {
    expect(validateRoleAssignment({ role: "faculty_administrator", facultyId: "science" }, true)).toBeNull();
    expect(validateRoleAssignment({ role: "faculty_administrator" }, false)).toMatch(/must be assigned/);
    expect(validateRoleAssignment({ role: "faculty_administrator", facultyId: "nope" }, false)).toMatch(/does not exist/);
    expect(validateRoleAssignment({ role: "registrar", facultyId: "science" }, true)).toMatch(/Only a faculty administrator/);
    expect(validateRoleAssignment({ role: "applicant", facultyId: null }, false)).toBeNull();
    expect(validateRoleAssignment({ role: "registrar" }, false)).toBeNull();
  });
});

describe("history redaction", () => {
  const faculty = (id: string) => ({ "umu-bsc-cs": "science", "umu-llb": "law" } as Record<string, string>)[id];
  const events = [
    { id: 1, actorUserId: 10, action: "application_created", afterData: { reference: "X" } },
    { id: 2, actorUserId: 11, action: "registrar_final_decision", afterData: { programmeId: "umu-llb", decision: "admit" } },
    { id: 3, actorUserId: 12, action: "registrar_final_decision", afterData: { programmeId: "umu-bsc-cs", decision: "decline" } },
    { id: 4, actorUserId: null, action: "screening_run", afterData: { programmesScreened: 37, outcomes: { eligible: 3 }, anomalyFlags: [] } },
  ];
  it("shows the registrar everything", () => {
    expect(redactHistory(events, { kind: "all" }, 1, faculty)).toHaveLength(4);
  });
  it("hides other faculties' events and per-outcome counts from a faculty administrator", () => {
    const out = redactHistory(events, { kind: "faculty", facultyId: "science" }, 1, faculty);
    expect(out.map((event) => event.id)).toEqual([1, 3, 4]);
    expect(out.find((event) => event.id === 4)!.afterData).toEqual({ anomalyFlags: [] });
  });
  it("shows an applicant only their own actions, and nothing to a user with no scope", () => {
    expect(redactHistory(events, { kind: "own", userId: 10 }, 10, faculty).map((event) => event.id)).toEqual([1]);
    expect(redactHistory(events, { kind: "none" }, 1, faculty)).toEqual([]);
  });
  it("gives an applicant a decision's outcome and date but never the reason", () => {
    const row = { id: 5, programmeId: "umu-llb", decision: "admit", reason: "private deliberation", decidedBy: 11, decidedAt: new Date("2026-10-01") };
    const shown = redactDecisionForApplicant(row);
    expect(shown).toEqual({ id: 5, programmeId: "umu-llb", decision: "admit", decidedAt: row.decidedAt });
    expect("reason" in shown).toBe(false);
    expect("decidedBy" in shown).toBe(false);
  });
});
