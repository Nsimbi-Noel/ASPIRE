import { Link } from "wouter";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, CircleHelp, Clock3, FileText, Plus, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AspireShell } from "@/components/AspireShell";
import { trpc } from "@/lib/trpc";

function Metric({ label, value, note, icon: Icon, tone }: { label: string; value: string | number; note: string; icon: typeof Users; tone: string }) {
  return <article className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={18} /></div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-note">{note}</div></article>;
}

function ApplicantOverview() {
  const list = trpc.aspire.applications.list.useQuery();
  const applications = list.data ?? [];
  const latest = applications[0];
  return <AspireShell title="Your admissions journey" eyebrow="Applicant portal">
    <section className="welcome-panel applicant-welcome"><div><span className="welcome-kicker">UMU · 2026/27 ADMISSIONS</span><h2>One clear step at a time.</h2><p>Add your results and documents, then follow your application status here. The admissions team will contact you directly if anything else is needed.</p></div><div className="welcome-actions"><Link href={latest ? `/applications/${latest.id}` : "/applications/new"}><Button className="button-primary">{latest ? "Continue application" : "Start an application"}<ArrowRight size={16} /></Button></Link><span className="small-hint">You can save and return later</span></div><div className="welcome-watermark">A</div></section>
    <div className="section-heading"><div><p className="eyebrow">YOUR WORK</p><h2>Applications</h2></div><Link href="/applications/new"><Button variant="outline" className="button-outline"><Plus size={16} />New application</Button></Link></div>
    {list.isLoading ? <div className="loading-block">Loading your applications…</div> : applications.length ? <div className="application-list">{applications.map((app) => <Link href={`/applications/${app.id}`} key={app.id} className="application-row"><div className="application-row-icon"><FileText size={18} /></div><div className="application-main"><strong>{app.applicantName}</strong><span>{app.reference} <i /> {app.intake} intake · {app.level.replaceAll("_", " ")}</span></div><span className={`status-tag status-${app.status}`}>{app.status.replaceAll("_", " ")}</span><ArrowRight size={17} className="row-arrow" /></Link>)}</div> : <div className="empty-state"><div className="empty-icon"><FileText size={22} /></div><h3>No application yet</h3><p>Create a draft to enter academic results and attach supporting documents.</p><Link href="/applications/new"><Button className="button-primary">Create an application<ArrowRight size={16} /></Button></Link></div>}
    <div className="notice-strip"><ShieldCheck size={18} /><div><strong>Admissions decisions are made by people.</strong><span>This workspace helps you submit evidence and follow its review. It does not issue admission offers.</span></div></div>
  </AspireShell>;
}

function StaffOverview() {
  const queue = trpc.aspire.staff.queue.useQuery();
  const evalSummary = trpc.aspire.evaluation.useQuery();
  const profile = trpc.aspire.profile.me.useQuery();
  const rows = queue.data ?? [];
  const counts = evalSummary.data?.counts;
  const held = rows.filter((row) => row.latestOutcomes.includes("ON_HOLD")).length;
  const pending = rows.filter((row) => row.status === "submitted" || row.status === "in_review" || row.needsReview).length;
  const name = profile.data?.name?.split(" ")[0] ?? "team";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return <AspireShell title={`${greeting}, ${name}.`} eyebrow="Admissions operations">
    <section className="welcome-panel staff-welcome"><div><span className="welcome-kicker">UMU ADMISSIONS DESK · 2026/27</span><h2>Keep every decision<br /><em>clear and reviewable.</em></h2><p>Work the application queue, check saved evidence, and record committee decisions with a reason.</p></div><div className="welcome-figure"><div className="figure-ring ring-one" /><div className="figure-ring ring-two" /><div className="figure-core"><span>AS</span><i>·</i></div><div className="figure-label"><span>decision support</span><strong>human-led</strong></div></div><div className="welcome-watermark">A</div></section>
    <section className="metric-grid">
      <Metric label="Applications" value={counts?.applications ?? "—"} note="Recorded in this intake workspace" icon={Users} tone="tone-teal" />
      <Metric label="Awaiting review" value={pending} note="Submitted or in active review" icon={Clock3} tone="tone-amber" />
      <Metric label="On hold" value={held} note="Documents or mapping need attention" icon={CircleHelp} tone="tone-blue" />
      <Metric label="Screening runs" value={counts?.screeningRuns ?? "—"} note="Each result keeps its own trace" icon={CheckCircle2} tone="tone-ink" />
    </section>
    <div className="section-heading section-heading-spaced"><div><p className="eyebrow">NEXT IN THE QUEUE</p><h2>Applications to review</h2></div><Link href="/applications"><Button variant="ghost" className="button-quiet">Open full queue<ArrowRight size={16} /></Button></Link></div>
    <div className="panel table-panel">
      <div className="table-head application-table-head"><span>APPLICANT</span><span>REFERENCE</span><span>INTAKE</span><span>STATUS</span><span>SCREENING</span><span /></div>
      {queue.isLoading ? <div className="loading-block">Loading review queue…</div> : rows.length ? rows.slice(0, 6).map((app, index) => <Link href={`/applications/${app.id}`} key={app.id} className="table-row application-table-row"><div className="applicant-cell"><span className={`mini-avatar avatar-${index % 5}`}>{app.applicantName.slice(0, 1).toUpperCase()}</span><span><strong>{app.applicantName}</strong><small>{app.level.replaceAll("_", " ")}</small></span></div><span className="mono muted">{app.reference}</span><span>{app.intake}</span><span className={`status-tag status-${app.status}`}>{app.status.replaceAll("_", " ")}</span><span className="screening-inline">{app.latestOutcomes.includes("ON_HOLD") || app.pendingDocuments > 0 ? <><i className="status-dot dot-amber" />Needs review</> : app.latestOutcomes.length ? <><i className="status-dot dot-teal" />Screened</> : <><i className="status-dot dot-muted" />Not screened</>}</span><ArrowRight size={16} className="row-arrow" /></Link>) : <div className="empty-inline"><p>No applications yet. Cases appear here as applicants submit or staff import authorized anonymized records.</p></div>}
      <div className="table-foot"><span>Showing {Math.min(rows.length, 6)} of {rows.length} cases</span><Link href="/applications">View all applications <ArrowRight size={14} /></Link></div>
    </div>
    <div className="notice-strip"><ShieldCheck size={18} /><div><strong>Support, not substitution.</strong><span>ASPIRE organises evidence and keeps an audit trail. The admissions committee records every final decision.</span></div></div>
  </AspireShell>;
}

export default function Dashboard() {
  const auth = trpc.aspire.profile.me.useQuery(undefined, { retry: false });
  const isStaff = auth.data?.role && auth.data.role !== "applicant";
  return isStaff ? <StaffOverview /> : <ApplicantOverview />;
}
