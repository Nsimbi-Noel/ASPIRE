import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Download, FileCheck2, FileText, Gauge, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";
import { AspireShell } from "@/components/AspireShell";
import { DocumentExtractionSummary, documentMismatchCount } from "@/components/DocumentExtractionSummary";
import { RuleSetsPanel, UsersPanel } from "@/components/GovernancePanels";
import { trpc } from "@/lib/trpc";

function readable(value: string) { return value.replaceAll("_", " ").replaceAll("-", " "); }

export function DocumentsPage() {
  const profile = trpc.aspire.profile.me.useQuery();
  const docs = trpc.aspire.staff.applications.useQuery(undefined, { enabled: Boolean(profile.data && profile.data.role !== "applicant") });
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState("pending");
  const review = trpc.aspire.documents.review.useMutation({ onSuccess: () => { toast.success("Document review recorded."); void utils.aspire.staff.applications.invalidate(); }, onError: (error) => toast.error(error.message) });
  const download = trpc.aspire.documents.download.useMutation({ onSuccess: ({ url }) => window.open(url, "_blank", "noopener,noreferrer") });
  const records = (docs.data ?? []).filter((doc) => filter === "all" || (filter === "pending" ? doc.status === "uploaded" || doc.status === "needs_review" : doc.status === filter));
  const pendingCount = docs.data?.filter((doc) => doc.status === "uploaded" || doc.status === "needs_review").length ?? 0;
  return <AspireShell title="Document review" eyebrow="Evidence desk">
    <div className="operations-banner"><div className="operations-banner-icon"><FileCheck2 size={19} /></div><div><strong>Uploaded files are evidence, not confirmed results.</strong><p>Review documents manually. Any extracted mark must be confirmed by a person against the source; verify official UNEB results before an offer.</p></div><span className="count-emphasis">{pendingCount}<small>pending</small></span></div>
    <div className="toolbar-row"><div className="filter-pills">{[["pending", "Needs review"], ["verified", "Verified"], ["rejected", "Rejected"], ["all", "All files"]].map(([id, label]) => <button key={id} className={`filter-pill ${filter === id ? "filter-pill-active" : ""}`} onClick={() => setFilter(id)}>{label}</button>)}</div><span className="muted">{records.length} documents</span></div>
    <div className="panel table-panel"><div className="table-head documents-table-head"><span>DOCUMENT</span><span>APPLICANT / CASE</span><span>TYPE</span><span>STATUS</span><span>ADDED</span><span /></div>
      {docs.isLoading ? <div className="loading-block">Loading documents…</div> : records.length ? records.map((doc) => { const mismatches = documentMismatchCount(doc.extractedFields); return <div className="table-row documents-table-row" key={doc.id}><div className="document-copy"><strong>{doc.fileName ?? doc.documentType}</strong><small>Private upload · {doc.id}</small><DocumentExtractionSummary fields={doc.extractedFields} /></div><Link href={`/applications/${doc.applicationId}`} className="applicant-link"><strong>{doc.applicantName}</strong><small className="mono">{doc.reference}</small></Link><span className="capitalize">{readable(doc.documentType)}</span><span className={`status-tag status-${doc.status}`}>{readable(doc.status)}</span><span className="muted">{doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString() : "—"}</span><div className="row-actions"><button className="icon-button" title="Download securely" onClick={() => download.mutate({ documentId: doc.id })}><Download size={15} /></button>{doc.status !== "verified" && (mismatches > 0 ? <Link className="verify-mini" href={`/applications/${doc.applicationId}`}>Resolve {mismatches}</Link> : <button className="verify-mini" disabled={review.isPending} onClick={() => review.mutate({ documentId: doc.id, status: "verified", reviewNote: "Manually inspected. Confirm official UNEB records before any admission offer." })}><Check size={14} />Verify</button>)}</div></div>; }) : <div className="empty-state"><div className="empty-icon"><FileText size={22} /></div><h3>Nothing in this view</h3><p>New documents appear here once an applicant securely uploads them.</p></div>}
      <div className="table-foot"><span>Private documents are not exposed as public URLs.</span><span>Each review action is audit logged.</span></div>
    </div>
  </AspireShell>;
}

export function GovernancePage() {
  const profile = trpc.aspire.profile.me.useQuery();
  const catalog = trpc.aspire.catalog.list.useQuery();
  const summary = trpc.aspire.catalog.mappingSummary.useQuery(undefined, { enabled: profile.data?.role === "registrar" });
  const proxyStatus = trpc.aspire.rules.proxyStatus.useQuery();
  const issueCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of summary.data?.proposalIssues ?? []) counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [summary.data]);
  const safeMappings = catalog.data?.filter((item) => item.mappingStatus === "adopted-proxy").length ?? 0;
  const needsReview = catalog.data?.filter((item) => item.mappingStatus !== "adopted-proxy").length ?? 0;
  if (profile.isLoading) return <AspireShell title="Governance"><div className="loading-block">Loading your role…</div></AspireShell>;
  if (profile.data?.role !== "registrar") return <AspireShell title="Governance"><div className="empty-state"><div className="empty-icon"><ShieldCheck size={22} /></div><h3>Registrar access only</h3><p>Rule versions and workspace accounts are managed by the registrar.</p></div></AspireShell>;
  return <AspireShell title="Rule governance" eyebrow="Registrar workspace">
    <div className="governance-banner"><ShieldCheck size={22} /><div><strong>Adopted rules · approval tracked per version</strong><p>{proxyStatus.data?.pending ? `${proxyStatus.data.pending} adopted-proxy version(s) still await recorded approval.` : `${proxyStatus.data?.approved ?? 0} adopted-proxy version(s) have recorded UMU approval.`} Record each approval under Rule versions: an admit decision is only possible once UMU has approved the version the screening used.</p></div><span className="approval-tag">SEE RULE VERSIONS</span></div>
    <div className="metric-grid compact-metrics"><article className="metric-card"><div className="metric-icon tone-teal"><FileCheck2 size={18} /></div><div className="metric-label">Usable proxy links</div><div className="metric-value">{safeMappings}</div><div className="metric-note">Exact/close link + known rule ID</div></article><article className="metric-card"><div className="metric-icon tone-amber"><AlertTriangle size={18} /></div><div className="metric-label">Need staff review</div><div className="metric-value">{needsReview}</div><div className="metric-note">Partial, missing or unsupported</div></article><article className="metric-card"><div className="metric-icon tone-ink"><Gauge size={18} /></div><div className="metric-label">Proposal issues</div><div className="metric-value">{summary.data?.proposalIssues.length ?? "—"}</div><div className="metric-note">Validation findings; not all unique programmes</div></article></div>
    <div className="governance-columns"><section className="panel case-panel"><div className="panel-heading"><div><p className="eyebrow">MAPPING VALIDATION</p><h2>Issues to resolve</h2></div></div><div className="source-meta"><strong>User mapping proposal</strong><span>{summary.data?.approval ?? "Loading source metadata…"}</span><small>{summary.data?.totalEntries ?? 0} programme entries · {summary.data?.baselineUsableCount ?? 0} baseline links passed safe checks</small></div>
        {summary.isLoading ? <div className="loading-block">Checking mapping registry…</div> : <div className="issue-count-list">{issueCounts.map(([code, count]) => <div key={code} className="issue-count-row"><span className="issue-count-icon"><AlertTriangle size={15} /></span><span><strong>{readable(code)}</strong><small>{(summary.data?.proposalIssues ?? []).find((issue) => issue.code === code)?.message}</small></span><b>{count}</b></div>)}</div>}
        <div className="source-note"><span>RULE SOURCES</span><p>UMU 2026/27 entry requirements are the admission baseline. Public-university programme weights are a separate adopted proxy; mapping confidence itself does not grant institutional approval, but each version's recorded approval is shown per programme.</p><Link href="/programmes">Inspect all programme links<ArrowRight size={14} /></Link></div>
      </section><section className="panel case-panel"><div className="panel-heading"><div><p className="eyebrow">CHANGE CONTROL</p><h2>Version and approval</h2></div></div><div className="governance-timeline"><div className="timeline-item timeline-complete"><i /><div><strong>Source data copied</strong><span>Baseline mapping and user proposal are separate immutable files.</span></div></div><div className={`timeline-item ${proxyStatus.data?.pending ? "timeline-attention" : "timeline-complete"}`}><i /><div><strong>UMU confirmation</strong><span>{proxyStatus.data?.pending ? `${proxyStatus.data.pending} version(s) still need recorded approval.` : `Approval is recorded for ${proxyStatus.data?.approved ?? 0} version(s), with approver and reference.`}</span></div></div><div className="timeline-item timeline-muted"><i /><div><strong>Admit decisions need approval</strong><span>The registrar records UMU’s approval, with who approved it and the reference, before an admit decision can rely on a version.</span></div></div></div><div className="locked-action"><ShieldCheck size={17} /><div><strong>Approval is recorded under Rule versions</strong><p>Save a change as a new version, activate it, and record UMU’s approval when it is confirmed in writing. ASPIRE never approves rules by itself.</p></div></div></section></div>
    <RuleSetsPanel programmes={catalog.data ?? []} />
    <UsersPanel />
  </AspireShell>;
}
