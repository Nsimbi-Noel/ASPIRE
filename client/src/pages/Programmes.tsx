import { useMemo, useState } from "react";
import { ArrowRight, Search, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { AspireShell } from "@/components/AspireShell";
import { trpc } from "@/lib/trpc";

export default function ProgrammesPage() {
  const profile = trpc.aspire.profile.me.useQuery();
  const staffOnly = Boolean(profile.data && profile.data.role !== "applicant");
  const catalog = trpc.aspire.catalog.list.useQuery(undefined, { enabled: staffOnly });
  const faculties = trpc.aspire.catalog.faculties.useQuery(undefined, { enabled: staffOnly });
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const [availableOnly, setAvailableOnly] = useState(false);
  const facultyName = (id?: string | null) => faculties.data?.find((faculty) => faculty.id === id)?.name ?? "—";
  const programmes = useMemo(() => (catalog.data ?? []).filter((item) => {
    const matchesSearch = `${item.name} ${item.id} ${facultyName(item.facultyId)}`.toLowerCase().includes(query.toLowerCase());
    return matchesSearch && (level === "all" || item.level === level) && (!availableOnly || item.screenable);
  }), [catalog.data, faculties.data, query, level, availableOnly]);
  const available = catalog.data?.filter((item) => item.screenable).length ?? 0;
  if (profile.isLoading) return <AspireShell title="Programme catalogue"><div className="loading-block">Loading your role…</div></AspireShell>;
  if (profile.data?.role === "applicant") return <AspireShell title="Programme catalogue"><div className="empty-state"><div className="empty-icon"><ShieldCheck size={22} /></div><h3>Admissions staff area</h3><p>The programme catalogue is maintained by admissions staff. Applicants choose programmes inside their application.</p></div></AspireShell>;
  return <AspireShell title="Programme catalogue" eyebrow="UMU · 2026/27 intake">
    <section className="catalog-intro">
      <div><span className="catalog-kicker">PROGRAMME DIRECTORY</span><h2>Find the right programme.<br /><em>Keep the process simple.</em></h2><p>Browse UMU programmes by faculty and study level. Applicants choose their programmes inside their application; detailed rule records remain in governance.</p></div>
      <div className="catalog-stat-block"><div><strong>{available}</strong><span>open to applications</span></div><div><strong>{catalog.data?.length ?? 0}</strong><span>listed programmes</span></div></div>
    </section>
    <div className="mapping-callout"><ShieldCheck size={18} /><div><strong>Admission is decided by the committee.</strong><span>This catalogue supports programme selection only. It is not an offer or a guarantee of a place.</span></div></div>
    <div className="toolbar-row catalogue-toolbar">
      <div className="search-box"><Search size={17} /><input aria-label="Search programmes" placeholder="Search programme or faculty…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      <select value={level} onChange={(e) => setLevel(e.target.value)}><option value="all">All levels</option><option value="bachelors">Bachelor’s</option><option value="diploma">Diploma</option><option value="certificate">Certificate</option><option value="higher_education_certificate">Higher education certificate</option></select>
      <button className={`filter-pill ${availableOnly ? "filter-pill-active" : ""}`} onClick={() => setAvailableOnly(!availableOnly)}>Open to applications</button>
    </div>
    <div className="panel table-panel programme-panel">
      <div className="table-head programme-table-head"><span>UMU PROGRAMME</span><span>FACULTY</span><span>LEVEL</span><span>AVAILABILITY</span><span /></div>
      {catalog.isLoading ? <div className="loading-block">Loading programme catalogue…</div> : programmes.length ? programmes.map((item) => <article key={item.id} className="programme-row">
        <div className="programme-name"><strong>{item.name}</strong><small className="mono">{item.id}</small></div>
        <span>{facultyName(item.facultyId)}</span>
        <span className="capitalize">{item.level.replaceAll("_", " ")}</span>
        <span className={`approval-state ${item.screenable ? "approval-approved" : "approval-review"}`}><i />{item.screenable ? "Open to applications" : "Not in this intake"}</span>
        <Link href="/governance" aria-label={`Inspect rules for ${item.name}`}><ArrowRight size={16} className="row-arrow" /></Link>
      </article>) : <div className="empty-inline">No programmes match this filter.</div>}
      <div className="table-foot"><span>{programmes.length} displayed</span><span>Rule versions and approvals are recorded under Governance.</span></div>
    </div>
  </AspireShell>;
}
