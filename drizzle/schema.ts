import {
  boolean,
  double,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/mysql-core";

/** Faculties, schools and directorates (UMU Courses 2026-2027 brochure). Reference data created by migration. */
export const faculties = mysqlTable("faculties", {
  id: varchar("id", { length: 80 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

/** Email-and-password accounts; ASPIRE permissions are assigned separately. */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  /** The sign-in name. Unique, compared without regard to case (MySQL's default collation). */
  email: varchar("email", { length: 320 }).unique(),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  /** Three roles only. A faculty administrator must have a faculty and sees only that faculty's cases. */
  aspireRole: mysqlEnum("aspireRole", ["applicant", "registrar", "faculty_administrator"])
    .default("applicant")
    .notNull(),
  facultyId: varchar("facultyId", { length: 80 }).references(() => faculties.id, { onDelete: "restrict" }),
  /** scrypt hash, never returned to any client. Null until a password is set. */
  passwordHash: varchar("passwordHash", { length: 255 }),
  passwordChangedAt: timestamp("passwordChangedAt"),
  /** Set when the registrar issues a temporary password; the person must choose their own at first sign-in. */
  mustChangePassword: boolean("mustChangePassword").default(false).notNull(),
  failedLoginCount: int("failedLoginCount").default(0).notNull(),
  lockedUntil: timestamp("lockedUntil"),
  /** Raised on password change, reset and deactivation, which ends every existing session. */
  sessionVersion: int("sessionVersion").default(0).notNull(),
  /** Accounts are deactivated, never deleted, because history rows refer to them. */
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const applications = mysqlTable("applications", {
  id: varchar("id", { length: 36 }).primaryKey(),
  reference: varchar("reference", { length: 32 }).notNull().unique(),
  applicantUserId: int("applicantUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  applicantName: varchar("applicantName", { length: 255 }).notNull(),
  intake: varchar("intake", { length: 20 }).notNull(),
  level: mysqlEnum("level", ["bachelors", "diploma", "certificate", "higher_education_certificate"]).notNull(),
  requestedProgrammeId: varchar("requestedProgrammeId", { length: 80 }),
  status: mysqlEnum("applicationStatus", ["draft", "submitted", "in_review", "completed"]).default("draft").notNull(),
  submittedAt: timestamp("submittedAt"),
  documentDeadline: timestamp("documentDeadline"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * The programmes an application is for. This is what links an application to a faculty:
 * a faculty administrator sees an application only while it has a submitted choice in their faculty.
 * facultyId is copied from the catalogue when the choice is made, so history stays stable.
 */
export const applicationProgrammes = mysqlTable("applicationProgrammes", {
  id: int("id").autoincrement().primaryKey(),
  applicationId: varchar("applicationId", { length: 36 }).notNull().references(() => applications.id, { onDelete: "cascade" }),
  programmeId: varchar("programmeId", { length: 80 }).notNull(),
  facultyId: varchar("facultyId", { length: 80 }).notNull().references(() => faculties.id, { onDelete: "restrict" }),
  choiceRank: int("choiceRank").notNull(),
  status: mysqlEnum("choiceStatus", ["submitted", "withdrawn"]).default("submitted").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  unique("applicationProgrammes_application_programme").on(table.applicationId, table.programmeId),
  index("applicationProgrammes_faculty_status").on(table.facultyId, table.status),
]);

export const examResults = mysqlTable("examResults", {
  id: int("id").autoincrement().primaryKey(),
  applicationId: varchar("applicationId", { length: 36 }).notNull().references(() => applications.id, { onDelete: "cascade" }),
  exam: mysqlEnum("exam", ["UCE", "UACE"]).notNull(),
  subject: varchar("subject", { length: 120 }).notNull(),
  grade: varchar("grade", { length: 20 }).notNull(),
  subjectLevel: mysqlEnum("subjectLevel", ["PRINCIPAL", "SUBSIDIARY"]),
  sitting: varchar("sitting", { length: 20 }).notNull(),
  source: mysqlEnum("source", ["applicant_entered", "staff_entered", "document_extracted"]).default("applicant_entered").notNull(),
  confirmed: boolean("confirmed").default(false).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const applicantQualifications = mysqlTable("applicantQualifications", {
  id: int("id").autoincrement().primaryKey(),
  applicationId: varchar("applicationId", { length: 36 }).notNull().references(() => applications.id, { onDelete: "cascade" }),
  qualificationType: mysqlEnum("qualificationType", ["DIPLOMA", "CERTIFICATE", "HEAC"]).notNull(),
  classification: mysqlEnum("classification", ["DISTINCTION", "CREDIT", "PASS", "FIRST_CLASS", "SECOND_CLASS", "PASS_CLASS"]).notNull(),
  qualificationName: varchar("qualificationName", { length: 255 }).notNull(),
  institution: varchar("institution", { length: 255 }),
  relatedToProgramme: boolean("relatedToProgramme"),
  completedYear: varchar("completedYear", { length: 10 }),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const applicantDocuments = mysqlTable("applicantDocuments", {
  id: int("id").autoincrement().primaryKey(),
  applicationId: varchar("applicationId", { length: 36 }).notNull().references(() => applications.id, { onDelete: "cascade" }),
  documentType: varchar("documentType", { length: 80 }).notNull(),
  fileName: varchar("fileName", { length: 255 }),
  contentType: varchar("contentType", { length: 80 }),
  storageKey: varchar("storageKey", { length: 512 }),
  status: mysqlEnum("documentStatus", ["missing", "uploaded", "needs_review", "verified", "rejected"]).default("missing").notNull(),
  extractionConfidence: double("extractionConfidence"),
  extractedFields: json("extractedFields").$type<Record<string, unknown> | null>(),
  reviewNote: text("reviewNote"),
  reviewedBy: int("reviewedBy").references(() => users.id, { onDelete: "set null" }),
  uploadedAt: timestamp("uploadedAt"),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const ruleSets = mysqlTable("ruleSets", {
  id: varchar("id", { length: 100 }).primaryKey(),
  programmeId: varchar("programmeId", { length: 80 }).notNull(),
  version: varchar("version", { length: 40 }).notNull(),
  effectiveFrom: varchar("effectiveFrom", { length: 20 }).notNull(),
  status: mysqlEnum("ruleStatus", ["official", "adopted-proxy", "assumed", "needs-review"]).notNull(),
  source: text("source").notNull(),
  edition: varchar("edition", { length: 40 }).notNull(),
  /** Human-readable approval line, derived from the structured approval fields below. */
  approval: varchar("approval", { length: 255 }).notNull(),
  effectiveTo: varchar("effectiveTo", { length: 20 }),
  /** pending until UMU confirms; an admit decision needs the rule set used to be approved. */
  approvalStatus: mysqlEnum("ruleApprovalStatus", ["pending", "approved", "rejected"]).default("pending").notNull(),
  approvedBy: varchar("approvedBy", { length: 255 }),
  approvalReference: varchar("approvalReference", { length: 255 }),
  approvalNote: text("approvalNote"),
  approvedAt: timestamp("approvedAt"),
  approvalRecordedBy: int("approvalRecordedBy").references(() => users.id, { onDelete: "set null" }),
  /** In use for screening only once activated. Rule content is never edited; publish a new version instead. */
  activatedAt: timestamp("activatedAt"),
  activatedBy: int("activatedBy").references(() => users.id, { onDelete: "set null" }),
  /** The compiled rule set: programmeName, level, routes, documents, weighting, notes. */
  rules: json("rules").$type<Record<string, unknown>>().notNull(),
  updatedBy: int("updatedBy").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  unique("ruleSets_programme_version").on(table.programmeId, table.version),
  index("ruleSets_programme_effective").on(table.programmeId, table.effectiveFrom),
]);

export const screeningRuns = mysqlTable("screeningRuns", {
  id: int("id").autoincrement().primaryKey(),
  applicationId: varchar("applicationId", { length: 36 }).notNull().references(() => applications.id, { onDelete: "cascade" }),
  programmeId: varchar("programmeId", { length: 80 }).notNull(),
  programmeName: varchar("programmeName", { length: 255 }).notNull(),
  outcome: mysqlEnum("screeningOutcome", ["ELIGIBLE", "NOT_ELIGIBLE", "ON_HOLD"]).notNull(),
  ruleSetVersion: varchar("ruleSetVersion", { length: 100 }).notNull(),
  ruleStatus: mysqlEnum("screeningRuleStatus", ["official", "adopted-proxy", "assumed", "needs-review"]).notNull(),
  /** The rule set row that was used, when screening used a stored rule set. */
  ruleSetRecordId: varchar("ruleSetRecordId", { length: 100 }),
  /** The programme's faculty when the run was made. Null on legacy rows, which only the registrar can see. */
  facultyId: varchar("facultyId", { length: 80 }),
  inputSnapshot: json("inputSnapshot").$type<Record<string, unknown>>().notNull(),
  resultTrace: json("resultTrace").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("screeningRuns_application_faculty").on(table.applicationId, table.facultyId),
]);

export const committeeDecisions = mysqlTable("committeeDecisions", {
  id: int("id").autoincrement().primaryKey(),
  applicationId: varchar("applicationId", { length: 36 }).notNull().references(() => applications.id, { onDelete: "cascade" }),
  programmeId: varchar("programmeId", { length: 80 }).notNull(),
  decision: mysqlEnum("committeeDecision", ["admit", "decline", "defer", "request_information"]).notNull(),
  reason: text("reason").notNull(),
  facultyId: varchar("facultyId", { length: 80 }),
  ruleSetRecordId: varchar("ruleSetRecordId", { length: 100 }),
  decidedBy: int("decidedBy").notNull().references(() => users.id, { onDelete: "restrict" }),
  decidedAt: timestamp("decidedAt").defaultNow().notNull(),
});

export const appeals = mysqlTable("appeals", {
  id: int("id").autoincrement().primaryKey(),
  applicationId: varchar("applicationId", { length: 36 }).notNull().references(() => applications.id, { onDelete: "cascade" }),
  applicantUserId: int("applicantUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  message: text("message").notNull(),
  status: mysqlEnum("appealStatus", ["open", "reviewing", "resolved"]).default("open").notNull(),
  resolution: text("resolution"),
  resolvedBy: int("resolvedBy").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  resolvedAt: timestamp("resolvedAt"),
});

/** Append-only by application policy; there is intentionally no update/delete endpoint. */
export const auditEvents = mysqlTable("auditEvents", {
  id: int("id").autoincrement().primaryKey(),
  actorUserId: int("actorUserId").references(() => users.id, { onDelete: "set null" }),
  action: varchar("action", { length: 100 }).notNull(),
  entityType: varchar("entityType", { length: 80 }).notNull(),
  entityId: varchar("entityId", { length: 100 }).notNull(),
  reason: text("reason"),
  beforeData: json("beforeData").$type<Record<string, unknown> | null>(),
  afterData: json("afterData").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  recipientUserId: int("recipientUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  applicationId: varchar("applicationId", { length: 36 }).references(() => applications.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 180 }).notNull(),
  message: text("message").notNull(),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const advisoryOutputs = mysqlTable("advisoryOutputs", {
  id: int("id").autoincrement().primaryKey(),
  applicationId: varchar("applicationId", { length: 36 }).notNull().references(() => applications.id, { onDelete: "cascade" }),
  programmeId: varchar("programmeId", { length: 80 }),
  kind: mysqlEnum("kind", ["anomaly", "progress"]).notNull(),
  status: mysqlEnum("advisoryStatus", ["review_required", "unvalidated", "resolved"]).notNull(),
  value: json("value").$type<Record<string, unknown>>().notNull(),
  modelVersion: varchar("modelVersion", { length: 80 }),
  reviewedBy: int("reviewedBy").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
