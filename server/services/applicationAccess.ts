import { and, eq, sql } from "drizzle-orm";
import { applications } from "../../drizzle/schema";
import { applicationVisibility, scopeOf, type ActorUser } from "./access";

type Db = Parameters<typeof applicationVisibility>[0] & { select: (...args: any[]) => any };

/** The application if the actor may see it, otherwise null. The one place that decides application visibility. */
export async function loadApplicationForActor(db: Db, applicationId: string, user: ActorUser) {
  const scope = scopeOf(user);
  const visible = applicationVisibility(db, scope) ?? sql`1 = 1`;
  const rows = await db.select().from(applications).where(and(eq(applications.id, applicationId), visible)).limit(1);
  return rows[0] ? { application: rows[0] as typeof applications.$inferSelect, scope } : null;
}
