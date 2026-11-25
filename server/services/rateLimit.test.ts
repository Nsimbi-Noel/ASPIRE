import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rateLimit";

describe("RateLimiter", () => {
  it("allows attempts up to the limit and then refuses with a retry time", () => {
    let now = 1_000;
    const limiter = new RateLimiter(2, 1_000, () => now);

    expect(limiter.hit("ip")).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.hit("ip")).toEqual({ allowed: true, retryAfterSeconds: 0 });
    const refused = limiter.hit("ip");
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(1);
  });

  it("slides the window instead of resetting on a fixed boundary", () => {
    let now = 0;
    const limiter = new RateLimiter(1, 1_000, () => now);

    expect(limiter.hit("ip").allowed).toBe(true);
    expect(limiter.hit("ip").allowed).toBe(false);
    now = 999;
    expect(limiter.hit("ip").allowed).toBe(false);
    now = 1_000;
    expect(limiter.hit("ip").allowed).toBe(true);
  });

  it("keeps separate counters for separate keys", () => {
    let now = 0;
    const limiter = new RateLimiter(1, 1_000, () => now);

    expect(limiter.hit("192.168.0.1").allowed).toBe(true);
    expect(limiter.hit("192.168.0.2").allowed).toBe(true);
    expect(limiter.hit("192.168.0.1").allowed).toBe(false);
    expect(limiter.hit("192.168.0.2").allowed).toBe(false);
  });

  it("reports how long until the oldest hit leaves the window", () => {
    let now = 0;
    const limiter = new RateLimiter(1, 10_000, () => now);
    limiter.hit("ip");
    now = 4_000;
    expect(limiter.hit("ip")).toMatchObject({
      allowed: false,
      retryAfterSeconds: 6,
    });
  });

  it("forgets all keys on reset", () => {
    const limiter = new RateLimiter(1, 60_000);
    limiter.hit("ip");
    expect(limiter.hit("ip").allowed).toBe(false);
    limiter.reset();
    expect(limiter.hit("ip").allowed).toBe(true);
  });

  it("evicts stale keys once the map grows large", () => {
    let now = 0;
    const limiter = new RateLimiter(1, 1_000, () => now);
    for (let i = 0; i < 10_001; i++) limiter.hit(`old-${i}`);
    now = 2_000;
    expect(limiter.hit("new").allowed).toBe(true);
    const internal = limiter as unknown as { hits: Map<string, number[]> };
    expect(internal.hits.size).toBeLessThan(10_001);
    expect(internal.hits.has("new")).toBe(true);
  });
});
