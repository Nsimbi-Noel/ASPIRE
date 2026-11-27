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
  const campuses = trpc.aspire.catalog.campuses.useQuery(undefined, { enabled: staffOnly });
  const studyModes = trpc.aspire.catalog.studyModes.useQuery(undefined, { enabled: staffOnly });
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const [faculty, setFaculty] = useState("all");
  const [campus, setCampus] = useState("all");
  const [mode, setMode] = useState("all");
  const [availableOnly, setAvailableOnly] = useState(false);
  const facultyName = (id?: string | null) => faculties.data?.find((item) => item.id === id)?.name ?? "—";
  const campusName = (id: string) => campuses.data?.find((item) => item.id === id)?.name ?? id;
  const modeLabel = (id: string) => studyModes.data?.find((item) => item.id === id)?.label ?? id;
  const programmes = useMemo(() => (catalog.data ?? []).filter((item) => {
    const searchable = [item.name, item.id, facultyName(item.facultyId), ...item.campusIds.map(campusName), ...item.studyModes.map(modeLabel)].join(" ").toLowerCase();
    return searchable.includes(query.toLowerCase())
      && (level === "all" || item.level === level)
      && (faculty === "all" || item.facultyId === faculty)
      && (campus === "all" || item.campusIds.includes(campus))
      && (mode === "all" || item.studyModes.includes(mode))
      && (!availableOnly || item.screenable);
  }), [catalog.data, faculties.data, campuses.data, studyModes.data, query, level, faculty, campus, mode, availableOnly]);
  const available = catalog.data?.filter((item) => item.screenable).length ?? 0;
  if (profile.isLoading) return <AspireShell title="Programme catalogue"><div className="loading-block">Loading your role…</div></AspireShell>;
  if (profile.data?.role === "applicant") return <AspireShell title="Programme catalogue"><div className="empty-state"><div className="empty-icon"><ShieldCheck size={22} /></div><h3>Admissions staff area</h3><p>The programme catalogue is maintained by admissions staff. Applicants choose programmes inside their application.</p></div></AspireShell>;
  return <AspireShell title="Programme catalogue" eyebrow="UMU · 2026/27 intake">
    <section className="catalog-intro">
      <div><span className="catalog-kicker">PROGRAMME DIRECTORY</span><h2>Find the right programme.<br /><em>Know where and how it runs.</em></h2><p>Browse UMU programmes by faculty, campus, study level and study mode. Applicants choose their programmes inside their application; detailed rule records remain in governance.</p></div>
      <div className="catalog-stat-block"><div><strong>{available}</strong><span>open to applications</span></div><div><strong>{catalog.data?.length ?? 0}</strong><span>listed programmes</span></div></div>
    </section>
    <div className="mapping-callout"><ShieldCheck size={18} /><div><strong>Admission is decided by the committee.</strong><span>This catalogue supports programme selection only. It is not an offer or a guarantee of a place.</span></div></div>
    <div className="toolbar-row catalogue-toolbar">
      <div className="search-box"><Search size={17} /><input aria-label="Search programmes" placeholder="Search programme, faculty, campus or mode…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Filter by level"><option value="all">All levels</option><option value="bachelors">Bachelor’s</option><option value="diploma">Diploma</option><option value="certificate">Certificate</option><option value="higher_education_certificate">Higher education certificate</option></select>
      <select value={faculty} onChange={(e) => setFaculty(e.target.value)} aria-label="Filter by faculty"><option value="all">All faculties</option>{(faculties.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <select value={campus} onChange={(e) => setCampus(e.target.value)} aria-label="Filter by campus"><option value="all">All campuses</option>{(campuses.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Filter by study mode"><option value="all">All study modes</option>{(studyModes.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      <button className={`filter-pill ${availableOnly ? "filter-pill-active" : ""}`} onClick={() => setAvailableOnly(!availableOnly)}>Open to applications</button>
    </div>
    <div className="panel table-panel programme-panel">
      <div className="table-head programme-table-head"><span>UMU PROGRAMME</span><span>FACULTY</span><span>CAMPUS</span><span>STUDY MODE</span><span>LEVEL</span><span>AVAILABILITY</span><span /></div>
      {catalog.isLoading ? <div className="loading-block">Loading programme catalogue…</div> : programmes.length ? programmes.map((item) => <article key={item.id} className="programme-row">
        <div className="programme-name"><strong>{item.name}</strong><small className="mono">{item.id}</small></div>
        <span>{facultyName(item.facultyId)}</span>
        <span>{item.campusIds.length ? item.campusIds.map(campusName).join(", ") : "Varies by campus"}</span>
        <span>{item.studyModes.length ? item.studyModes.map(modeLabel).join(", ") : "Varies"}</span>
        <span className="capitalize">{item.level.replaceAll("_", " ")}</span>
        <span className={`approval-state ${item.screenable ? "approval-approved" : "approval-review"}`}><i />{item.screenable ? "Open to applications" : "Not in this intake"}</span>
        <Link href="/governance" aria-label={`Inspect rules for ${item.name}`}><ArrowRight size={16} className="row-arrow" /></Link>
      </article>) : <div className="empty-inline">No programmes match this filter.</div>}
      <div className="table-foot"><span>{programmes.length} displayed</span><span>Campus, mode and faculty details come from the 2026/27 UMU brochure.</span></div>
    </div>
  </AspireShell>;
}
