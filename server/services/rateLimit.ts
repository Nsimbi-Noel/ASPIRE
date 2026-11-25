/** A small sliding-window limiter kept in memory. It resets when the server restarts. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private limit: number, private windowMs: number, private now: () => number = Date.now) {}

  /** Records an attempt and reports whether it is allowed. */
  hit(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((time) => now - time < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0]! + this.windowMs - now) / 1000)) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (!v.some((time) => now - time < this.windowMs)) this.hits.delete(k);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  reset(): void { this.hits.clear(); }
}
