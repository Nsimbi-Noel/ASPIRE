import { systemRouter } from "./_core/systemRouter";
import { router } from "./_core/trpc";
import { aspireRouter } from "./routers/aspire";
import { authRouter } from "./routers/auth";

export const appRouter = router({
  system: systemRouter,
  auth: authRouter,
  aspire: aspireRouter,
});

export type AppRouter = typeof appRouter;
