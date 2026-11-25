import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express from "express";
import { registerDocumentRoutes } from "../routes/documentFile";
import { appRouter } from "../routers";
import { createContext } from "./context";

/** The HTTP application, without a listener, so tests can run it. */
export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  // Behind a reverse proxy set TRUST_PROXY=true so the client address used for rate limits is the real one.
  app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    next();
  });
  app.use(express.json({ limit: "8mb" }));
  app.get("/api/health", (_req, res) => void res.json({ ok: true, timestamp: Date.now() }));
  registerDocumentRoutes(app);
  app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));
  return app;
}
