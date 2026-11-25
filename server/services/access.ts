import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { applicationProgrammes, applications, committeeDecisions, screeningRuns } from "../../drizzle/schema";

/**
 * Three roles only (project owner's decision, October 2026):
 *  - applicant: their own applications
 *  - faculty_administrator: applications that have a submitted programme choice in their own faculty,
 *    and the screening runs and decisions for their own faculty's programmes
 *  - registrar: everything
 * A faculty administrator with no faculty assigned sees nothing (fail closed).
 */
export const ASPIRE_ROLES = ["applicant", "registrar", "faculty_administrator"] as const;
export type AspireRole = (typeof ASPIRE_ROLES)[number];

export const STAFF_ROLES: readonly AspireRole[] = ["faculty_administrator", "registrar"];

export interface ActorUser {
  id: number;
  /** The platform role. "admin" is the project owner account, which acts as registrar. */
  role: string;
  aspireRole: string;
  facultyId?: string | null;
}

export function roleOf(user: Pick<ActorUser, "role" | "aspireRole">): AspireRole {
  if (user.role === "admin") return "registrar";
  return (ASPIRE_ROLES as readonly string[]).includes(user.aspireRole) ? (user.aspireRole as AspireRole) : "applicant";
}

export type Scope =
  | { kind: "all" }
  | { kind: "faculty"; facultyId: string }
  | { kind: "own"; userId: number }
  | { kind: "none" };

export function scopeOf(user: ActorUser): Scope {
  const role = roleOf(user);
  if (role === "registrar") return { kind: "all" };
  if (role === "faculty_administrator") return user.facultyId ? { kind: "faculty", facultyId: user.facultyId } : { kind: "none" };
  return { kind: "own", userId: user.id };
}

/** Whether a record that belongs to a faculty (a programme's run or decision) is inside the scope. */
export function canSeeFaculty(scope: Scope, facultyId: string | null | undefined): boolean {
  if (scope.kind === "all") return true;
  if (scope.kind === "faculty") return !!facultyId && facultyId === scope.facultyId;
  return false;
}

/** Validates a role assignment made by the registrar. Returns an error message, or null when valid. */
export function validateRoleAssignment(input: { role: AspireRole; facultyId?: string | null }, facultyExists: boolean): string | null {
  if (input.role === "faculty_administrator") {
    if (!input.facultyId) return "A faculty administrator must be assigned to a faculty.";
    if (!facultyExists) return "That faculty does not exist.";
    return null;
  }
  if (input.facultyId) return "Only a faculty administrator belongs to a faculty.";
  return null;
}

type AuditLike = { actorUserId: number | null; action: string; afterData: unknown; beforeData?: unknown };

/**
 * Filters and redacts a case's audit history for the viewer.
 *  - applicants see only their own actions
 *  - faculty administrators do not see events about other faculties' programmes, and the per-outcome
 *    counts of full screenings (which include other faculties) are removed
 *  - the registrar sees everything
 */
export function redactHistory<T extends AuditLike>(
  events: T[],
  scope: Scope,
  viewerId: number,
  facultyOfProgramme: (programmeId: string) => string | null | undefined,
): T[] {
  if (scope.kind === "all") return events;
  if (scope.kind === "own") {
    const internalActions = new Set(["screening_run", "screening_run_single"]);
    return events.filter((event) => event.actorUserId === viewerId && !internalActions.has(event.action));
  }
  if (scope.kind === "none") return [];
  const out: T[] = [];
  for (const event of events) {
    const after = (event.afterData ?? null) as Record<string, unknown> | null;
    const programmeId = typeof after?.programmeId === "string" ? after.programmeId : null;
    if (programmeId && facultyOfProgramme(programmeId) !== scope.facultyId) continue;
    if (after && "outcomes" in after) {
      const { outcomes: _outcomes, programmesScreened: _screened, ...rest } = after;
      out.push({ ...event, afterData: rest });
    } else out.push(event);
  }
  return out;
}

/** What an applicant may see of a committee decision: the outcome and date, never the deliberation. */
export function redactDecisionForApplicant<T extends { id: number; programmeId: string; decision: string; decidedAt: Date }>(row: T) {
  return { id: row.id, programmeId: row.programmeId, decision: row.decision, decidedAt: row.decidedAt };
}

// ---------- SQL conditions ----------
// `db` is only used to build a subquery, so any Drizzle MySQL database works.
type AnyDb = { select: (...args: any[]) => any };

/** Which applications the actor may see. Undefined means no restriction. */
export function applicationVisibility(db: AnyDb, scope: Scope): SQL | undefined {
  switch (scope.kind) {
    case "all":
      return undefined;
    case "own":
      return eq(applications.applicantUserId, scope.userId);
    case "faculty":
      return inArray(
        applications.id,
        db
          .select({ id: applicationProgrammes.applicationId })
          .from(applicationProgrammes)
          .where(and(eq(applicationProgrammes.facultyId, scope.facultyId), eq(applicationProgrammes.status, "submitted"))),
      );
    case "none":
      return sql`1 = 0`;
  }
}

/** Which screening runs (and decisions) the actor may see, given the application is already visible. */
export function runVisibility(scope: Scope): SQL | undefined {
  switch (scope.kind) {
    case "all":
    case "own":
      return undefined;
    case "faculty":
      return eq(screeningRuns.facultyId, scope.facultyId);
    case "none":
      return sql`1 = 0`;
  }
}

/** Which committee decisions the actor may see, given the application is already visible. */
export function decisionVisibility(scope: Scope): SQL | undefined {
  switch (scope.kind) {
    case "all":
    case "own":
      return undefined;
    case "faculty":
      return eq(committeeDecisions.facultyId, scope.facultyId);
    case "none":
      return sql`1 = 0`;
  }
}
