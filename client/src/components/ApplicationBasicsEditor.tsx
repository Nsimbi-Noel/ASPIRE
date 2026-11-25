import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ArrowUp, Plus, Save, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

type Level = "bachelors" | "diploma" | "certificate" | "higher_education_certificate";
type Choice = { programmeId: string; status: string; choiceRank: number };
type ApplicationBasics = { id: string; applicantName: string; intake: string; level: Level; requestedProgrammeId: string | null; status: string; updatedAt: Date | string };
const levels: Array<[Level, string]> = [["bachelors", "Bachelor’s degree"], ["diploma", "Diploma"], ["certificate", "Certificate"], ["higher_education_certificate", "Higher Education Access Certificate"]];
const MAX_CHOICES = 5;

export function ApplicationBasicsEditor({ application, role, choices = [] }: { application: ApplicationBasics; role?: string; choices?: Choice[] }) {
  const utils = trpc.useUtils();
  const catalog = trpc.aspire.catalog.choices.useQuery();
  const faculties = trpc.aspire.catalog.faculties.useQuery();
  const canEdit = ["applicant", "registrar"].includes(role ?? "");
  const locked = application.status === "completed" || !canEdit;
  const submittedIds = useMemo(
    () => choices.filter((choice) => choice.status === "submitted").sort((a, b) => a.choiceRank - b.choiceRank).map((choice) => choice.programmeId),
    [choices],
  );
  const [name, setName] = useState(application.applicantName);
  const [intake, setIntake] = useState(application.intake);
  const [level, setLevel] = useState<Level>(application.level);
  const [selected, setSelected] = useState<string[]>(submittedIds);
  const [adding, setAdding] = useState("");
  const refresh = () => { void utils.aspire.applications.get.invalidate({ id: application.id }); void utils.aspire.applications.list.invalidate(); };
  const update = trpc.aspire.applications.updateProfile.useMutation({ onSuccess: (result) => { toast.success(result.status === "submitted" ? "Application submitted for review." : "Application details saved."); refresh(); } });
  const setChoices = trpc.aspire.applications.setProgrammeChoices.useMutation();

  useEffect(() => {
    setName(application.applicantName);
    setIntake(application.intake);
    setLevel(application.level);
    setSelected(submittedIds);
  }, [application.id, application.updatedAt, submittedIds.join("|")]);

  const byId = new Map((catalog.data ?? []).map((item) => [item.id, item]));
  const facultyName = (facultyId?: string | null) => faculties.data?.find((faculty) => faculty.id === facultyId)?.name ?? "";
  const available = (catalog.data ?? []).filter((item) => item.level === level && !selected.includes(item.id));
  const changed = selected.join("|") !== submittedIds.join("|");
  const busy = update.isPending || setChoices.isPending;
  const move = (index: number) => setSelected((list) => { const next = [...list]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; return next; });

  const save = async (submit: boolean) => {
    try {
      if (changed) await setChoices.mutateAsync({ id: application.id, programmeIds: selected });
      update.mutate({ id: application.id, applicantName: name.trim(), intake, level, submit });
    } catch { /* the error is shown below */ }
  };
  const error = setChoices.error ?? update.error;

  return <section className="panel case-panel"><div className="panel-heading"><div><p className="eyebrow">APPLICATION DETAILS</p><h2>Applicant & intake</h2></div><span className={`status-tag status-${application.status}`}>{application.status.replaceAll("_", " ")}</span></div>
    {locked ? <>
      <div className="read-only-notice">{application.status === "completed" ? "This case is closed for direct changes. Ask admissions staff about a correction." : "Your role can review this case but cannot edit applicant details."}</div>
      {submittedIds.length > 0 && <div className="choice-list readonly"><strong>Programmes applied for</strong>{submittedIds.map((id, index) => <div className="choice-row" key={id}><span className="choice-rank">{index + 1}</span><span><b>{byId.get(id)?.name ?? id}</b><small>{facultyName(byId.get(id)?.facultyId)}</small></span></div>)}</div>}
    </> : <>
      <div className="form-row"><label className="form-field"><span>Full name</span><input value={name} onChange={(event) => setName(event.target.value)} /></label><label className="form-field"><span>Intake</span><select value={intake} onChange={(event) => setIntake(event.target.value)}><option>2026/27</option><option>2027/28</option></select></label></div>
      <div className="form-row"><label className="form-field"><span>Study level</span><select value={level} onChange={(event) => { const next = event.target.value as Level; setLevel(next); setSelected((list) => list.filter((id) => byId.get(id)?.level === next)); }}>{levels.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
      <div className="choice-list">
        <strong>Programmes you are applying for <small>choose at least one, up to {MAX_CHOICES}, in order of preference</small></strong>
        {selected.length === 0 ? <p className="muted small-text">No programme chosen yet. Your application reaches a faculty only through the programmes you choose here.</p> : selected.map((id, index) => <div className="choice-row" key={id}>
          <span className="choice-rank">{index + 1}</span>
          <span><b>{byId.get(id)?.name ?? id}</b><small>{facultyName(byId.get(id)?.facultyId)}</small></span>
          <span className="choice-actions">
            {index > 0 && <button type="button" className="icon-button" aria-label={`Move ${byId.get(id)?.name ?? id} up`} onClick={() => move(index)}><ArrowUp size={14} /></button>}
            <button type="button" className="icon-button" aria-label={`Remove ${byId.get(id)?.name ?? id}`} onClick={() => setSelected((list) => list.filter((item) => item !== id))}><X size={14} /></button>
          </span>
        </div>)}
        {selected.length < MAX_CHOICES && <div className="choice-add"><select value={adding} onChange={(event) => setAdding(event.target.value)} aria-label="Add a programme"><option value="">Add a programme…</option>{available.map((item) => <option key={item.id} value={item.id}>{item.name} — {facultyName(item.facultyId)}</option>)}</select><Button variant="outline" className="button-outline" disabled={!adding} onClick={() => { setSelected((list) => [...list, adding]); setAdding(""); }}><Plus size={14} />Add</Button></div>}
      </div>
      <div className="form-actions"><span className="muted small-text">All edits are preserved in the case audit trail.</span><Button variant="outline" className="button-outline" disabled={busy || name.trim().length < 2} onClick={() => void save(false)}><Save size={14} />Save changes</Button><Button className="button-primary" disabled={busy || name.trim().length < 2 || selected.length === 0} onClick={() => void save(true)}><Send size={14} />{application.status === "draft" ? "Submit for review" : "Save & submit updates"}<ArrowRight size={14} /></Button></div>
      {selected.length === 0 && <p className="muted small-text">Choose at least one programme to submit, so the application reaches the right faculty.</p>}
      {error && <p className="form-error">{error.message}</p>}
    </>}
  </section>;
}
