import { eq } from "drizzle-orm";
import type { Express } from "express";
import { applicantDocuments, auditEvents } from "../../drizzle/schema";
import { authenticateRequest } from "../_core/auth";
import { getDb } from "../db";
import { loadApplicationForActor } from "../services/applicationAccess";
import { fileStore } from "../storage";

const SERVED_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);

/**
 * Documents are only ever served here. The request must carry a valid session and the document's application
 * must be inside the user's scope; anything else looks like "not found". Every view is recorded in the audit log.
 */
export function registerDocumentRoutes(app: Express) {
  app.get("/api/documents/:id/file", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return void res.status(404).json({ error: "Document not found." });
    try {
      const user = await authenticateRequest(req);
      if (!user) return void res.status(401).json({ error: "Sign in to view this document." });
      if (user.mustChangePassword) return void res.status(403).json({ error: "Choose your own password before continuing." });
      const db = await getDb();
      if (!db) return void res.status(503).json({ error: "The database is unavailable." });
      const document = (await db.select().from(applicantDocuments).where(eq(applicantDocuments.id, id)).limit(1))[0];
      if (!document?.storageKey) return void res.status(404).json({ error: "Document not found." });
      if (!(await loadApplicationForActor(db, document.applicationId, user))) return void res.status(404).json({ error: "Document not found." });
      const bytes = await fileStore.get(document.storageKey).catch(() => null);
      if (!bytes) return void res.status(404).json({ error: "Document not found." });
      await db.insert(auditEvents).values({ actorUserId: user.id, action: "document_viewed", entityType: "application", entityId: document.applicationId, reason: null, beforeData: null, afterData: { documentId: id, documentType: document.documentType } });
      const type = SERVED_TYPES.has(document.contentType ?? "") ? document.contentType! : "application/octet-stream";
      const filename = (document.fileName ?? `document-${id}`).replace(/[^\w.\- ]+/g, "_");
      res.setHeader("Content-Type", type);
      res.setHeader("Content-Length", String(bytes.byteLength));
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'");
      res.end(bytes);
    } catch (error) {
      console.error("[documents] serve failed:", error);
      res.status(500).json({ error: "The document could not be served." });
    }
  });
}
