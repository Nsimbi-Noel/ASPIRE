type Candidate = { subject?: unknown; grade?: unknown; line?: unknown };
type Mismatch = { subject?: unknown; enteredGrade?: unknown; extractedGrade?: unknown; line?: unknown };
type Fields = { status?: unknown; candidates?: unknown; mismatches?: unknown; warning?: unknown; mismatchResolution?: unknown } | null;

export function DocumentExtractionSummary({ fields }: { fields: unknown }) {
  const value = fields as Fields;
  if (!value) return <small className="extraction-meta">No advisory extraction recorded.</small>;
  const candidates = Array.isArray(value.candidates) ? value.candidates as Candidate[] : [];
  const mismatches = Array.isArray(value.mismatches) ? value.mismatches as Mismatch[] : [];
  const resolution = value.mismatchResolution as { resolved?: unknown; actorUserId?: unknown; resolvedAt?: unknown; note?: unknown } | null;
  return <div className="document-extraction"><small>Local extraction · {String(value.status ?? "unknown").replaceAll("_", " ")} · advisory only</small>{typeof value.warning === "string" && <small className="extraction-warning">{value.warning}</small>}{candidates.length > 0 && <span className="extraction-candidates">{candidates.slice(0, 8).map((item) => `${String(item.subject)} ${String(item.grade)} (line ${String(item.line)})`).join(" · ")}{candidates.length > 8 ? ` · +${candidates.length - 8} more` : ""}</span>}{mismatches.length > 0 && <span className={resolution?.resolved === true ? "extraction-resolved" : "extraction-mismatch"}>{mismatches.map((item) => `${String(item.subject)}: entered ${String(item.enteredGrade)} vs extracted ${String(item.extractedGrade)}`).join(" · ")}{resolution?.resolved === true ? " · reviewed by staff" : ""}</span>}</div>;
}

export function documentMismatchCount(fields: unknown): number {
  const value = fields as Fields;
  return Array.isArray(value?.mismatches) ? value.mismatches.length : 0;
}
