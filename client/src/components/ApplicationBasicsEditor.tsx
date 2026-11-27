import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ArrowUp, Plus, Save, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { LAUNCH_INTAKE, SUPPORTED_INTAKES, isSupportedIntake } from "@shared/const";

type Level = "bachelors" | "diploma" | "certificate" | "higher_education_certificate";
type Selection = { campusId: string; modeId: string };
type Choice = { programmeId: string; status: string; choiceRank: number; campusId?: string | null; studyModeId?: string | null };
type ApplicationBasics = { id: string; applicantName: string; intake: string; level: Level; requestedProgrammeId: string | null; status: string; updatedAt: Date | string };
const levels: Array<[Level, string]> = [["bachelors", "Bachelor’s degree"], ["diploma", "Diploma"], ["certificate", "Certificate"], ["higher_education_certificate", "Higher Education Access Certificate"]];
const MAX_CHOICES = 5;

export function ApplicationBasicsEditor({ application, role, choices = [], mode = "full" }: { application: ApplicationBasics; role?: string; choices?: Choice[]; mode?: "full" | "profile" | "choices" }) {
  const utils = trpc.useUtils();
  const catalog = trpc.aspire.catalog.choices.useQuery();
  const faculties = trpc.aspire.catalog.faculties.useQuery();
  const campuses = trpc.aspire.catalog.campuses.useQuery();
  const studyModes = trpc.aspire.catalog.studyModes.useQuery();
  const canEdit = ["applicant", "registrar"].includes(role ?? "");
  const locked = application.status === "completed" || !canEdit;
  const savedIntakeUnsupported = !isSupportedIntake(application.intake);
  const submittedIds = useMemo(
    () => choices.filter((choice) => choice.status === "submitted").sort((a, b) => a.choiceRank - b.choiceRank).map((choice) => choice.programmeId),
    [choices],
  );
  const submittedSelections = useMemo(() => {
    const result: Record<string, Selection> = {};
    for (const choice of choices) {
      if (choice.status === "submitted" && choice.campusId && choice.studyModeId) result[choice.programmeId] = { campusId: choice.campusId, modeId: choice.studyModeId };
    }
    return result;
  }, [choices]);
  const [name, setName] = useState(application.applicantName);
  const [intake, setIntake] = useState(application.intake);
  const intakeNeedsCorrection = !isSupportedIntake(intake);
  const [level, setLevel] = useState<Level>(application.level);
  const [selected, setSelected] = useState<string[]>(submittedIds);
  const [selections, setSelections] = useState<Record<string, Selection>>(submittedSelections);
  const [campusId, setCampusId] = useState("");
  const [adding, setAdding] = useState("");
  const [modeId, setModeId] = useState("");
  const refresh = () => { void utils.aspire.applications.get.invalidate({ id: application.id }); void utils.aspire.applications.list.invalidate(); };
  const update = trpc.aspire.applications.updateProfile.useMutation({ onSuccess: (result) => { toast.success(result.status === "submitted" ? "Application submitted for review." : "Application details saved."); refresh(); } });
  const setChoices = trpc.aspire.applications.setProgrammeChoices.useMutation();

  useEffect(() => {
    setName(application.applicantName);
    setIntake(application.intake);
    setLevel(application.level);
    setSelected(submittedIds);
    setSelections(submittedSelections);
  }, [application.id, application.updatedAt, submittedIds.join("|"), JSON.stringify(submittedSelections)]);

  const byId = new Map((catalog.data ?? []).map((item) => [item.id, item]));
  const facultyName = (facultyId?: string | null) => faculties.data?.find((faculty) => faculty.id === facultyId)?.name ?? "";
  const campusName = (id?: string | null) => id ? campuses.data?.find((campus) => campus.id === id)?.name ?? id : "";
  const modeLabel = (id?: string | null) => id ? studyModes.data?.find((mode) => mode.id === id)?.label ?? id : "";
  const campusNames = (ids: string[]) => ids.map(campusName).join(", ");
  const modeLabels = (ids: string[]) => ids.map(modeLabel).join(", ");
  const programmeDetail = (item: { facultyId: string | null; campusIds: string[]; studyModes: string[] }) => [facultyName(item.facultyId), campusNames(item.campusIds), modeLabels(item.studyModes)].filter(Boolean).join(" · ");
  const chosenDetail = (id: string) => {
    const item = byId.get(id);
    if (!item) return "";
    const selection = selections[id];
    if (selection?.campusId && selection.modeId) return [facultyName(item.facultyId), campusName(selection.campusId), modeLabel(selection.modeId)].filter(Boolean).join(" · ");
    return programmeDetail(item);
  };
  const available = campusId ? (catalog.data ?? []).filter((item) => item.level === level && !selected.includes(item.id) && item.campusIds.includes(campusId) && item.offerings.some((offering) => offering.campusId === campusId && offering.modes.length > 0)) : [];
  const modeOptions = campusId && adding ? byId.get(adding)?.offerings.find((offering) => offering.campusId === campusId)?.modes ?? [] : [];
  const choiceSignature = (ids: string[], map: Record<string, Selection>) => JSON.stringify(ids.map((id) => [id, map[id]?.campusId ?? null, map[id]?.modeId ?? null]));
  const changed = choiceSignature(selected, selections) !== choiceSignature(submittedIds, submittedSelections);
  const busy = update.isPending || setChoices.isPending;
  const move = (index: number) => setSelected((list) => { const next = [...list]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; return next; });

  const save = async (submit: boolean) => {
    if (intakeNeedsCorrection) {
      toast.error(`Select ${LAUNCH_INTAKE} as the intake before saving this case.`);
      return;
    }
    try {
      if (changed) {
        const selectionInput = selected.flatMap((programmeId) => {
          const selection = selections[programmeId];
          return selection ? [{ programmeId, campusId: selection.campusId, modeId: selection.modeId }] : [];
        });
        await setChoices.mutateAsync({ id: application.id, programmeIds: selected, selections: selectionInput });
      }
      update.mutate({ id: application.id, applicantName: name.trim(), intake, level, submit });
    } catch { /* the error is shown below */ }
  };
  const error = setChoices.error ?? update.error;

  const showProfile = mode !== "choices";
  const showChoices = mode !== "profile";

  return <section className={mode === "full" ? "panel case-panel" : "basics-editor-block"}><div className="panel-heading"><div><p className="eyebrow">{mode === "choices" ? "PROGRAMME CHOICES" : "APPLICATION DETAILS"}</p><h2>{mode === "choices" ? "Campus, mode & programmes" : "Applicant & intake"}</h2></div><span className={`status-tag status-${application.status}`}>{application.status.replaceAll("_", " ")}</span></div>
    {savedIntakeUnsupported && <div className="read-only-notice">This case uses the unsupported intake {application.intake}. Screening is paused until the intake is corrected to {LAUNCH_INTAKE}.</div>}
    {locked ? <>
      <div className="read-only-notice">{application.status === "completed" ? "This case is closed for direct changes. Ask admissions staff about a correction." : "Your role can review this case but cannot edit applicant details."}</div>
      {submittedIds.length > 0 && <div className="choice-list readonly"><strong>Programmes applied for</strong>{submittedIds.map((id, index) => <div className="choice-row" key={id}><span className="choice-rank">{index + 1}</span><span><b>{byId.get(id)?.name ?? id}</b><small>{chosenDetail(id)}</small></span></div>)}</div>}
    </> : <>
      {showProfile && <><div className="form-row"><label className="form-field"><span>Full name</span><input value={name} onChange={(event) => setName(event.target.value)} /></label><label className="form-field"><span>Intake</span><select value={intake} onChange={(event) => setIntake(event.target.value)}>{savedIntakeUnsupported && <option value={application.intake}>{application.intake} · unsupported</option>}{SUPPORTED_INTAKES.map((option) => <option key={option} value={option}>{option}</option>)}</select></label></div>
      <div className="form-row"><label className="form-field"><span>Study level</span><select value={level} onChange={(event) => { if (!catalog.data) return; const next = event.target.value as Level; setLevel(next); setSelected((list) => list.filter((id) => byId.get(id)?.level === next)); setSelections((list) => Object.fromEntries(Object.entries(list).filter(([id]) => byId.get(id)?.level === next))); setCampusId(""); setAdding(""); setModeId(""); }}>{levels.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div></>}
      {showChoices && <div className="choice-list">
        <strong>Programmes you are applying for <small>choose campus, mode, then programme — up to {MAX_CHOICES}, in order of preference</small></strong>
        {selected.length === 0 ? <p className="muted small-text">No programme chosen yet. ASPIRE will recommend programmes after you save results, but your application reaches a faculty only through programmes chosen here.</p> : selected.map((id, index) => <div className="choice-row" key={id}>
          <span className="choice-rank">{index + 1}</span>
          <span><b>{byId.get(id)?.name ?? id}</b><small>{chosenDetail(id)}</small></span>
          <span className="choice-actions">
            {index > 0 && <button type="button" className="icon-button" aria-label={`Move ${byId.get(id)?.name ?? id} up`} onClick={() => move(index)}><ArrowUp size={14} /></button>}
            <button type="button" className="icon-button" aria-label={`Remove ${byId.get(id)?.name ?? id}`} onClick={() => { setSelected((list) => list.filter((item) => item !== id)); setSelections((list) => { const next = { ...list }; delete next[id]; return next; }); }}><X size={14} /></button>
          </span>
        </div>)}
        {selected.length < MAX_CHOICES && <div className="choice-add">
          <select value={campusId} onChange={(event) => { setCampusId(event.target.value); setAdding(""); setModeId(""); }} aria-label="Choose campus"><option value="">Choose campus…</option>{campuses.data?.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}</select>
          <select value={adding} onChange={(event) => { setAdding(event.target.value); setModeId(""); }} aria-label="Choose programme" disabled={!campusId}><option value="">{campusId ? "Choose programme…" : "Choose a campus first"}</option>{available.map((item) => <option key={item.id} value={item.id}>{item.name} — {facultyName(item.facultyId)}</option>)}</select>
          <select value={modeId} onChange={(event) => setModeId(event.target.value)} aria-label="Choose mode of study" disabled={!adding}><option value="">{adding ? "Choose mode…" : "Choose a programme first"}</option>{modeOptions.map((id) => <option key={id} value={id}>{modeLabel(id)}</option>)}</select>
          <Button variant="outline" className="button-outline" disabled={!campusId || !adding || !modeId} onClick={() => {
            setSelections((list) => ({ ...list, [adding]: { campusId, modeId } }));
            setSelected((list) => [...list, adding]);
            setAdding(""); setModeId("");
          }}><Plus size={14} />Add</Button>
        </div>}
      </div>}
      <div className="form-actions"><span className="muted small-text">All edits are preserved in the case audit trail.</span><Button variant="outline" className="button-outline" disabled={busy || intakeNeedsCorrection || (showProfile && name.trim().length < 2)} onClick={() => void save(false)}><Save size={14} />Save changes</Button>{mode !== "profile" && <Button className="button-primary" disabled={busy || intakeNeedsCorrection || name.trim().length < 2 || selected.length === 0} onClick={() => void save(true)}><Send size={14} />{application.status === "draft" ? "Submit for review" : "Save & submit updates"}<ArrowRight size={14} /></Button>}</div>
      {showChoices && selected.length === 0 && <p className="muted small-text">Choose at least one programme to submit, so the application reaches the right faculty.</p>}
      {error && <p className="form-error">{error.message}</p>}
    </>}
  </section>;
}
