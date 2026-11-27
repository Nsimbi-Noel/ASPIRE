import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useRoute, useSearch } from "wouter";
import { ArrowLeft, ArrowRight, Check, CircleAlert, Download, FileCheck2, FilePlus2, FileText, Plus, RefreshCw, Save, Send, ShieldCheck, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AspireShell } from "@/components/AspireShell";
import { ApplicationBasicsEditor } from "@/components/ApplicationBasicsEditor";
import { ApplicationDeadlineControl } from "@/components/ApplicationDeadlineControl";
import { DocumentExtractionSummary, documentMismatchCount } from "@/components/DocumentExtractionSummary";
import { QualificationsEditor } from "@/components/QualificationsEditor";
import { ResultsCsvTools } from "@/components/ResultsCsvTools";
import { trpc } from "@/lib/trpc";
import NotFound from "@/pages/NotFound";
import { EXAM_TYPES, LAUNCH_INTAKE, SUPPORTED_INTAKES, UACE_LEVELS, gradeOptionsFor, isAllowedResultGrade, isAllowedResultSubject, isSupportedIntake, normalizeResultGrade, normalizeResultSubject, subjectOptionsFor, type ExamType, type SupportedIntake, type UaceLevel } from "@shared/const";

const levels = [
  ["bachelors", "Bachelor’s degree"],
  ["diploma", "Diploma"],
  ["certificate", "Certificate"],
  ["higher_education_certificate", "Higher Education Access Certificate"],
] as const;
type ResultDraft = { exam: ExamType; subject: string; grade: string; subjectLevel?: UaceLevel; sitting: string };
type ApplicantStep = 1 | 2 | 3;
const APPLICANT_STEPS: Array<{ id: ApplicantStep; label: string; detail: string }> = [
  { id: 1, label: "Personal details", detail: "Name, contact and intake" },
  { id: 2, label: "Results & documents", detail: "UCE/UACE/certificates and uploads" },
  { id: 3, label: "Programmes & ASPIRE", detail: "Campus, mode and recommended programmes" },
];

function ResultRowsTable({ rows, onUpdate, onRemove, emptyMessage = "No results have been entered yet. Add UCE, UACE or other relevant results." }: {
  rows: ResultDraft[];
  onUpdate: (index: number, patch: Partial<ResultDraft>) => void;
  onRemove: (index: number) => void;
  emptyMessage?: string;
}) {
  return rows.length ? <div className="result-table-wrap"><table className="result-table"><thead><tr><th>Exam</th><th>Subject</th><th>Grade</th><th>Level</th><th>Sitting</th><th /></tr></thead><tbody>{rows.map((row, i) => {
    const level = row.exam === "UACE" ? row.subjectLevel ?? "PRINCIPAL" : undefined;
    const subjects = subjectOptionsFor(row.exam, level);
    const grades = gradeOptionsFor(row.exam, level);
    return <tr key={`${row.exam}-${row.subject}-${i}`}>
      <td><select value={row.exam} onChange={(e) => onUpdate(i, { exam: e.target.value as ExamType })}>{EXAM_TYPES.map((exam) => <option key={exam} value={exam}>{exam}</option>)}</select></td>
      <td><select aria-label="Subject" value={row.subject} onChange={(e) => onUpdate(i, { subject: e.target.value })}><option value="">Choose subject</option>{subjects.map((subject) => <option key={subject} value={subject}>{subject}</option>)}{row.subject && !subjects.includes(row.subject) && <option value={row.subject}>Current: {row.subject}</option>}</select></td>
      <td><select className="grade-input" aria-label="Grade" value={row.grade} onChange={(e) => onUpdate(i, { grade: e.target.value })}><option value="">Choose grade</option>{grades.map((grade) => <option key={grade} value={grade}>{grade}</option>)}{row.grade && !grades.includes(row.grade) && <option value={row.grade}>Current: {row.grade}</option>}</select></td>
      <td>{row.exam === "UACE" ? <select aria-label="UACE subject level" value={level} onChange={(e) => onUpdate(i, { subjectLevel: e.target.value as UaceLevel })}>{UACE_LEVELS.map((option) => <option key={option} value={option}>{option === "PRINCIPAL" ? "Principal" : "Subsidiary"}</option>)}</select> : "—"}</td>
      <td><input className="sitting-input" aria-label="Sitting" value={row.sitting} onChange={(e) => onUpdate(i, { sitting: e.target.value })} /></td>
      <td><button className="text-button danger-text" onClick={() => onRemove(i)}>Remove</button></td>
    </tr>;
  })}</tbody></table></div> : <div className="empty-inline">{emptyMessage}</div>;
}

function AddResultRow({ exam, subjectLevel, subject, grade, sitting, onExamChange, onLevelChange, onSubjectChange, onGradeChange, onSittingChange, onSubmit }: {
  exam: ExamType;
  subjectLevel: UaceLevel;
  subject: string;
  grade: string;
  sitting: string;
  onExamChange: (exam: ExamType) => void;
  onLevelChange: (level: UaceLevel) => void;
  onSubjectChange: (subject: string) => void;
  onGradeChange: (grade: string) => void;
  onSittingChange: (sitting: string) => void;
  onSubmit: () => void;
}) {
  const level = exam === "UACE" ? subjectLevel : undefined;
  const subjects = subjectOptionsFor(exam, level);
  const grades = gradeOptionsFor(exam, level);
  return <div className="add-result-row"><select value={exam} onChange={(e) => onExamChange(e.target.value as ExamType)}>{EXAM_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}</select><select aria-label="New subject" value={subject} onChange={(e) => onSubjectChange(e.target.value)}><option value="">Choose subject</option>{subjects.map((option) => <option key={option} value={option}>{option}</option>)}</select>{exam === "UACE" && <select aria-label="New UACE subject level" value={subjectLevel} onChange={(e) => onLevelChange(e.target.value as UaceLevel)}>{UACE_LEVELS.map((option) => <option key={option} value={option}>{option === "PRINCIPAL" ? "Principal" : "Subsidiary"}</option>)}</select>}<select className="grade-input" aria-label="New grade" value={grade} onChange={(e) => onGradeChange(e.target.value)}><option value="">Choose grade</option>{grades.map((option) => <option key={option} value={option}>{option}</option>)}</select><input className="sitting-input" value={sitting} onChange={(e) => onSittingChange(e.target.value)} placeholder="Year" /><Button variant="outline" size="sm" onClick={onSubmit}><Plus size={14} />Add</Button></div>;
}

function PageLoading({ label = "Loading case…" }: { label?: string }) { return <div className="loading-block"><span className="loader-dot" />{label}</div>; }

function ApplicantReviewPanel({ application, decisions, documents }: {
  application: { status: string; documentDeadline?: Date | string | null };
  decisions: Array<{ decision: string; decidedAt: Date | string }>;
  documents: Array<{ status: string }>;
}) {
  const decision = decisions[0];
  const needsInformation = documents.some((doc) => doc.status === "needs_review" || doc.status === "rejected");
  const state = decision
    ? { icon: Check, label: "Committee decision recorded", tone: "review-done", detail: `A decision was recorded on ${new Date(decision.decidedAt).toLocaleDateString()}. This notice is not an admission offer.` }
    : needsInformation
      ? { icon: CircleAlert, label: "Information needed", tone: "review-info", detail: "Admissions is checking your documents. Upload any outstanding evidence before the stated deadline." }
      : application.status === "draft"
        ? { icon: FileText, label: "Draft", tone: "review-draft", detail: "Complete your details, results and documents, then submit your application for review." }
        : { icon: ShieldCheck, label: "Under review", tone: "review-active", detail: "Your application is with the admissions team. We will contact you directly if anything else is needed." };
  const Icon = state.icon;
  return <section className={`panel review-status-panel ${state.tone}`}>
    <div className="review-status-icon"><Icon size={20} /></div>
    <div><p className="eyebrow">APPLICATION STATUS</p><h2>{state.label}</h2><p>{state.detail}</p></div>
    {application.documentDeadline && !decision && <span className="review-deadline">Evidence deadline · {new Date(application.documentDeadline).toLocaleDateString("en-GB", { timeZone: "UTC" })}</span>}
  </section>;
}

export function ApplicationsPage() {
  const auth = trpc.aspire.profile.me.useQuery();
  const list = trpc.aspire.applications.list.useQuery();
  const queue = trpc.aspire.staff.queue.useQuery(undefined, { enabled: Boolean(auth.data && auth.data.role !== "applicant") });
  const [filter, setFilter] = useState<"all" | "review" | "hold">("all");
  const staff = auth.data?.role !== "applicant";
  const allRows = staff ? queue.data : list.data;
  const visibleRows = (allRows ?? []).filter((app) => {
    if (filter === "hold") return "latestOutcomes" in app && Array.isArray(app.latestOutcomes) && app.latestOutcomes.includes("ON_HOLD");
    if (filter === "review") return app.status === "submitted" || app.status === "in_review" || ("needsReview" in app && typeof app.needsReview === "boolean" && app.needsReview);
    return true;
  });
  return <AspireShell title={staff ? "Application queue" : "Your applications"}>
    <div className="toolbar-row"><div className="filter-pills">{([ ["all", "All"], ["review", "Needs review"], ["hold", "On hold"] ] as const).map(([value, label]) => <button key={value} onClick={() => setFilter(value)} className={`filter-pill ${filter === value ? "filter-pill-active" : ""}`}>{label}</button>)}</div>{(!staff || auth.data?.role === "registrar") && <Link href="/applications/new"><Button className="button-primary"><Plus size={16} />New application</Button></Link>}</div>
    <div className="panel table-panel">
      <div className="table-head case-table-head"><span>APPLICANT</span><span>REFERENCE</span><span>INTAKE</span><span>LEVEL</span><span>STATUS</span><span /></div>
      {(staff ? queue.isLoading || auth.isLoading : list.isLoading) ? <PageLoading /> : (staff ? queue.error : list.error) ? <div className="empty-inline">Could not load applications. Please retry.</div> : visibleRows.length ? visibleRows.map((app, i) => <Link className="table-row case-table-row" href={`/applications/${app.id}`} key={app.id}>
        <div className="applicant-cell"><span className={`mini-avatar avatar-${i % 5}`}>{app.applicantName.slice(0, 1).toUpperCase()}</span><span><strong>{app.applicantName}</strong><small>{staff ? "Applicant record" : "Your application"}</small></span></div>
        <span className="mono muted">{app.reference}</span><span>{app.intake}{!isSupportedIntake(app.intake) && <small className="muted"> · unsupported</small>}</span><span className="capitalize">{app.level.replaceAll("_", " ")}</span><span className={`status-tag status-${app.status}`}>{app.status.replaceAll("_", " ")}</span><ArrowRight size={16} className="row-arrow" />
      </Link>) : <div className="empty-state"><div className="empty-icon"><FileText size={22} /></div><h3>No applications found</h3><p>{filter === "all" ? "Start a draft, then enter results and supporting documents." : "No cases currently match this queue filter."}</p>{filter === "all" && (!staff || auth.data?.role === "registrar") && <Link href="/applications/new"><Button className="button-primary">Create application<ArrowRight size={16} /></Button></Link>}</div>}
      <div className="table-foot"><span>{visibleRows.length} application{visibleRows.length === 1 ? "" : "s"}</span><span>Personal records are visible only to authorized users.</span></div>
    </div>
    {staff && <ResultsCsvTools canImport={auth.data?.role === "registrar"} />}
  </AspireShell>;
}

export function NewApplicationPage() {
  const [, navigate] = useLocation();
  const profile = trpc.aspire.profile.me.useQuery();
  const [name, setName] = useState(profile.data?.name ?? "");
  const [intake, setIntake] = useState<SupportedIntake>(LAUNCH_INTAKE);
  const [level, setLevel] = useState<(typeof levels)[number][0]>("bachelors");
  const create = trpc.aspire.applications.create.useMutation({ onSuccess: (res) => { toast.success("Draft created. Continue with your results."); void navigate(`/applications/${res.id}?step=2`); } });
  return <AspireShell title="Start an application" eyebrow="Applicant portal">
    <div className="form-page-grid"><section className="panel form-panel"><div className="panel-heading"><div><p className="eyebrow">STEP 1 · PERSONAL DETAILS</p><h2>Your details</h2></div><span className="step-count">01 / 03</span></div>
      <div className="stepper-inline">{APPLICANT_STEPS.map((step) => <div key={step.id} className={`stepper-chip ${step.id === 1 ? "stepper-chip-active" : ""}`}><span>{step.id}</span><div><strong>{step.label}</strong><small>{step.detail}</small></div></div>)}</div>
      <label className="form-field"><span>Full name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name as shown on your examination records" /></label>
      <div className="form-row"><label className="form-field"><span>Email</span><input value={profile.data?.email ?? ""} readOnly placeholder="Signed-in email" /></label><label className="form-field"><span>Contact <small>optional</small></span><input value="" readOnly placeholder="Use your account email for now" /></label></div>
      <div className="form-row"><label className="form-field"><span>Intake</span><select value={intake} onChange={(e) => setIntake(e.target.value as SupportedIntake)}>{SUPPORTED_INTAKES.map((option) => <option key={option} value={option}>{option}</option>)}</select>
</label><label className="form-field"><span>Study level</span><select value={level} onChange={(e) => setLevel(e.target.value as typeof level)}>{levels.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
      <div className="form-actions"><Button variant="outline" onClick={() => navigate("/applications")}>Cancel</Button><Button className="button-primary" disabled={name.trim().length < 2 || create.isPending} onClick={() => create.mutate({ applicantName: name.trim(), intake, level })}>{create.isPending ? "Creating…" : "Save & continue"}<ArrowRight size={16} /></Button></div>
      {create.error && <p className="form-error">{create.error.message}</p>}
    </section><aside className="side-note"><div className="side-note-icon"><ShieldCheck size={18} /></div><h3>Step-by-step application.</h3><p>Start with your details, then enter results and upload supporting documents. In the final step, choose campus and study mode and let ASPIRE recommend programmes you fit based on your results and UMU rules.</p><div className="side-note-rule" /><span>ASPIRE RECOMMENDATIONS</span><p>Recommendations are advisory only. The admissions committee makes every final decision.</p></aside></div>
  </AspireShell>;
}

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read this file."));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

function latestScreens(screenings: Array<Record<string, any>>) {
  const byProgramme = new Map<string, Record<string, any>>();
  for (const run of screenings) if (!byProgramme.has(run.programmeId)) byProgramme.set(run.programmeId, run);
  const outcomeOrder = (outcome: unknown) => outcome === "ELIGIBLE" ? 0 : outcome === "ON_HOLD" ? 1 : outcome === "NOT_ELIGIBLE" ? 2 : 3;
  return [...byProgramme.values()].sort((a, b) => outcomeOrder(a.outcome) - outcomeOrder(b.outcome) || String(a.programmeName).localeCompare(String(b.programmeName)) || String(a.programmeId).localeCompare(String(b.programmeId)));
}

function RouteEvidence({ result }: { result: Record<string, any> }) {
  const routes = result.academic?.routes as Array<{ routeId: string; status: string; checks?: Array<{ ruleId: string; status: string; expected: string; actual: string; gap?: number }> }> | undefined;
  if (!routes?.length) return null;
  const preferred = result.academic?.nearestRoute as string | undefined;
  const route = routes.find((candidate) => candidate.routeId === preferred) ?? routes.find((candidate) => candidate.status !== "PASS") ?? routes[0];
  const failed = (route.checks ?? []).filter((check) => check.status === "FAIL").slice(0, 3);
  const review = (route.checks ?? []).filter((check) => check.status === "REVIEW").slice(0, 2);
  return <div className="trace-mini"><strong>{route.routeId.replaceAll("_", " ")}{route.status !== "PASS" ? " · closest route" : " · route passed"}</strong>{failed.map((check) => <span key={check.ruleId}>{check.ruleId}: expected {check.expected}, found {check.actual}{typeof check.gap === "number" ? ` (gap ${check.gap})` : ""}</span>)}{review.map((check) => <span key={check.ruleId}>{check.ruleId}: human review · {check.actual}</span>)}{!failed.length && !review.length && <span>No failed or review checks on this route.</span>}</div>;
}

export function ApplicationDetailPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const [, params] = useRoute<{ id: string }>("/applications/:id");
  const id = params?.id ?? "";
  const app = trpc.aspire.applications.get.useQuery({ id }, { enabled: Boolean(id) });
  const profile = trpc.aspire.profile.me.useQuery();
  const utils = trpc.useUtils();
  const requestedStep = Number(new URLSearchParams(search).get("step") || "1") as ApplicantStep;
  const [step, setStep] = useState<ApplicantStep>(requestedStep >= 1 && requestedStep <= 3 ? requestedStep : 1);
  const [resultDrafts, setResultDrafts] = useState<ResultDraft[]>([]);
  const [newExam, setNewExam] = useState<"UCE" | "UACE">("UACE");
  const [newSubjectLevel, setNewSubjectLevel] = useState<"PRINCIPAL" | "SUBSIDIARY">("PRINCIPAL");
  const [newSubject, setNewSubject] = useState("");
  const [newGrade, setNewGrade] = useState("");
  const [newSitting, setNewSitting] = useState("2025");
  const [docType, setDocType] = useState("UACE_RESULT_SLIP");
  const [appealText, setAppealText] = useState("");
  const [decision, setDecision] = useState("defer");
  const [decisionProgramme, setDecisionProgramme] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [override, setOverride] = useState(false);
  const [resultReviewNote, setResultReviewNote] = useState("Compared each active grade with the verified official UNEB result slip.");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const saveResults = trpc.aspire.applications.saveResults.useMutation({ onSuccess: () => { toast.success("Results saved. ASPIRE recommendations have been refreshed."); void utils.aspire.applications.get.invalidate({ id }); } });
  const confirmResults = trpc.aspire.applications.confirmOfficialResults.useMutation({ onSuccess: (result) => { toast.success(`${result.confirmed} result rows confirmed against the verified official slip.`); void utils.aspire.applications.get.invalidate({ id }); } });
  const runScreening = trpc.aspire.screening.run.useMutation({ onSuccess: () => { toast.success("Screening trace saved."); void utils.aspire.applications.get.invalidate({ id }); } });
  const upload = trpc.aspire.documents.upload.useMutation({ onSuccess: () => { toast.success("Document uploaded for review."); setSelectedFile(null); void utils.aspire.applications.get.invalidate({ id }); } });
  const appeal = trpc.aspire.applicant.appeal.useMutation({ onSuccess: () => { toast.success("Appeal submitted for staff review."); setAppealText(""); void utils.aspire.applications.get.invalidate({ id }); } });
  const makeRecommendation = trpc.aspire.staff.recommend.useMutation({ onSuccess: (res) => { toast.success(res.message); setDecisionReason(""); void utils.aspire.applications.get.invalidate({ id }); } });
  const makeDecision = trpc.aspire.staff.decisions.useMutation({ onSuccess: (res) => { toast.success(res.message); setDecisionReason(""); void utils.aspire.applications.get.invalidate({ id }); } });
  const reopenCase = trpc.aspire.staff.reopenApplication.useMutation({ onSuccess: () => { toast.success("Case reopened with an audit record; the applicant was notified."); setReopenReason(""); void utils.aspire.applications.get.invalidate({ id }); void utils.aspire.staff.queue.invalidate(); } });
  const isStaff = (profile.data?.role ?? "applicant") !== "applicant";

  useEffect(() => {
    if (app.data) setResultDrafts(app.data.results.map((row) => ({
      exam: row.exam,
      subject: normalizeResultSubject(row.exam, row.subjectLevel ?? undefined, row.subject),
      grade: normalizeResultGrade(row.exam, row.subjectLevel ?? undefined, row.grade),
      subjectLevel: row.subjectLevel ?? undefined,
      sitting: row.sitting,
    })));
  }, [app.data?.application.updatedAt, app.data?.results.length]);
  useEffect(() => { if (requestedStep >= 1 && requestedStep <= 3) setStep(requestedStep as ApplicantStep); }, [requestedStep]);

  const current = app.data;
  const recentScreenings = useMemo(() => latestScreens((current?.screenings ?? []) as unknown as Array<Record<string, any>>), [current?.screenings]);
  const role = profile.data?.role;
  const isFacultyAdmin = role === "faculty_administrator";
  const isRegistrar = role === "registrar";
  const canConfirmResults = isFacultyAdmin;
  if (app.isLoading || profile.isLoading) return <AspireShell title="Application case"><PageLoading /></AspireShell>;
  if (app.error?.data?.code === "NOT_FOUND") return <NotFound />;
  if (app.error || !current) return <AspireShell title="Application case"><div className="empty-state"><h3>Case unavailable</h3><p>{app.error?.message ?? "This application could not be loaded."}</p><Link href="/applications"><Button variant="outline"><ArrowLeft size={16} />Back to applications</Button></Link></div></AspireShell>;
  const application = current.application;
  const caseLocked = application.status === "completed";
  const unsupportedIntake = !isSupportedIntake(application.intake);
  const canReopenCase = role === "faculty_administrator" || role === "registrar";
  const selectedDecisionRun = recentScreenings.find((run) => run.programmeId === decisionProgramme);
  const decisionTrace = ((selectedDecisionRun as { resultTrace?: unknown } | undefined)?.resultTrace ?? {}) as { ruleApproval?: string; mappingReviewRequired?: boolean };
  const appliedIds = new Set(current.choices.filter((choice) => choice.status === "submitted").map((choice) => choice.programmeId));
  const decisionOptions = recentScreenings.filter((run) => appliedIds.has(run.programmeId));
  const facultyRecommendation = (current.facultyRecommendations ?? []).find((item) => item.programmeId === decisionProgramme);
  const finalVerdictBlocked = isRegistrar && !facultyRecommendation;
  const staleRecommendation = isRegistrar && Boolean(facultyRecommendation && selectedDecisionRun && facultyRecommendation.screeningRunId !== selectedDecisionRun.id);
  const provisionalAdmitBlocked = decision === "admit" && Boolean(selectedDecisionRun) && !(decisionTrace.ruleApproval === "approved" && !decisionTrace.mappingReviewRequired);
  const activeResultRows = resultDrafts;
  const updateResultRow = (index: number, patch: Partial<ResultDraft>) => setResultDrafts((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  const changeResultExam = (index: number, exam: ExamType) => setResultDrafts((rows) => rows.map((row, i) => {
    if (i !== index) return row;
    const subjectLevel = exam === "UACE" ? row.subjectLevel ?? "PRINCIPAL" : undefined;
    const subject = row.subject && isAllowedResultSubject(exam, subjectLevel, row.subject) ? normalizeResultSubject(exam, subjectLevel, row.subject) : "";
    return { ...row, exam, subjectLevel, subject, grade: "" };
  }));
  const changeResultLevel = (index: number, subjectLevel: UaceLevel) => setResultDrafts((rows) => rows.map((row, i) => {
    if (i !== index) return row;
    const subject = row.subject && isAllowedResultSubject("UACE", subjectLevel, row.subject) ? normalizeResultSubject("UACE", subjectLevel, row.subject) : "";
    return { ...row, subjectLevel, subject, grade: "" };
  }));
  const updateResultRowSafely = (index: number, patch: Partial<ResultDraft>) => {
    if (patch.exam) return changeResultExam(index, patch.exam);
    if (patch.subjectLevel) return changeResultLevel(index, patch.subjectLevel);
    return updateResultRow(index, patch);
  };
  const changeNewExam = (exam: ExamType) => { setNewExam(exam); setNewSubjectLevel("PRINCIPAL"); setNewSubject(""); setNewGrade(""); };
  const changeNewLevel = (level: UaceLevel) => { setNewSubjectLevel(level); setNewSubject(""); setNewGrade(""); };
  const submitResultRow = () => {
    const level = newExam === "UACE" ? newSubjectLevel : undefined;
    const subject = normalizeResultSubject(newExam, level, newSubject.trim());
    const grade = normalizeResultGrade(newExam, level, newGrade.trim());
    if (!isAllowedResultSubject(newExam, level, subject) || !isAllowedResultGrade(newExam, level, grade)) return;
    setResultDrafts((rows) => [...rows, { exam: newExam, subject, grade, ...(newExam === "UACE" ? { subjectLevel: newSubjectLevel } : {}), sitting: newSitting }]);
    setNewSubject(""); setNewGrade("");
  };

  const uploadFile = async () => {
    if (!selectedFile) return;
    if (selectedFile.size > 4_000_000) { toast.error("Choose a file no larger than 4 MB."); return; }
    const allowed = ["application/pdf", "image/png", "image/jpeg"];
    if (!allowed.includes(selectedFile.type)) { toast.error("Use a PDF, PNG or JPEG file."); return; }
    try {
      const base64 = await readFileAsBase64(selectedFile);
      upload.mutate({ applicationId: id, documentType: docType, fileName: selectedFile.name, contentType: selectedFile.type as "application/pdf" | "image/png" | "image/jpeg", base64 });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not read file."); }
  };

  const recommendations = current.recommendations ?? [];
  const applicantStep = isStaff ? null : step;

  const stepNav = !isStaff && <div className="stepper-inline">{APPLICANT_STEPS.map((item) => <button key={item.id} type="button" className={`stepper-chip ${step === item.id ? "stepper-chip-active" : ""}`} onClick={() => { setStep(item.id); void navigate(`/applications/${id}?step=${item.id}`); }}><span>{item.id}</span><div><strong>{item.label}</strong><small>{item.detail}</small></div></button>)}</div>;

  const personalStep = <section className="panel case-panel"><div className="panel-heading"><div><p className="eyebrow">STEP 1 · PERSONAL DETAILS</p><h2>Your details</h2></div><span className="step-count">01 / 03</span></div><ApplicationBasicsEditor application={current.application} role={role} choices={current.choices} mode="profile" /><div className="form-actions"><Button className="button-primary" onClick={() => { setStep(2); void navigate(`/applications/${id}?step=2`); }}>Continue to results<ArrowRight size={15} /></Button></div></section>;

  const resultsStep = <><section className="panel case-panel"><div className="panel-heading"><div><p className="eyebrow">STEP 2 · RESULTS & DOCUMENTS</p><h2>Examination results</h2></div><span className="panel-meta">{activeResultRows.length} active entries</span></div>
        <fieldset className="case-fields" disabled={caseLocked}>
        <ResultRowsTable rows={activeResultRows} onUpdate={updateResultRowSafely} onRemove={(index) => setResultDrafts((rows) => rows.filter((_, j) => j !== index))} />
        <AddResultRow exam={newExam} subjectLevel={newSubjectLevel} subject={newSubject} grade={newGrade} sitting={newSitting} onExamChange={changeNewExam} onLevelChange={changeNewLevel} onSubjectChange={setNewSubject} onGradeChange={setNewGrade} onSittingChange={setNewSitting} onSubmit={submitResultRow} />
        <div className="form-actions"><span className="muted small-text">Applicant-entered marks are unverified until checked against documents.</span><Button className="button-outline" variant="outline" disabled={unsupportedIntake || saveResults.isPending} onClick={() => saveResults.mutate({ id, results: activeResultRows })}><Save size={15} />Save results</Button></div>{saveResults.error && <p className="form-error">{saveResults.error.message}</p>}
        {activeResultRows.length > 0 && <p className="verification-state">{current.results.length > 0 && current.results.every((row) => row.confirmed) ? "Active result rows have been confirmed by staff." : "Active result rows are not yet confirmed against official UNEB evidence."}</p>}
        {canConfirmResults && <div className="confirm-results-panel"><label className="form-field"><span>Staff verification note <small>required · confirm after reviewing the verified slip</small></span><input value={resultReviewNote} onChange={(event) => setResultReviewNote(event.target.value)} /></label><Button variant="outline" className="button-outline" disabled={confirmResults.isPending || resultReviewNote.trim().length < 10 || !current.documents.some((doc) => doc.status === "verified" && ["UCE_RESULT_SLIP", "UACE_RESULT_SLIP"].includes(doc.documentType))} onClick={() => confirmResults.mutate({ id, reviewNote: resultReviewNote })}><ShieldCheck size={15} />Confirm active results against official slip</Button>{confirmResults.error && <p className="form-error">{confirmResults.error.message}</p>}</div>}
        </fieldset>
      </section>
      <QualificationsEditor applicationId={id} qualifications={current.qualifications} locked={caseLocked || unsupportedIntake} />
      <section className="panel case-panel"><div className="panel-heading"><div><p className="eyebrow">SUPPORTING DOCUMENTS</p><h2>Upload your results</h2></div><span className="panel-meta">Even if entered above, upload evidence</span></div>
        <fieldset className="case-fields" disabled={caseLocked}>
        <div className="document-upload"><label className="form-field"><span>Document type</span><select value={docType} onChange={(e) => setDocType(e.target.value)}><option value="UACE_RESULT_SLIP">UACE results slip</option><option value="UCE_RESULT_SLIP">UCE results slip</option><option value="NATIONAL_ID">National ID</option><option value="DIPLOMA_CERTIFICATE">Diploma certificate</option><option value="DIPLOMA_TRANSCRIPT">Diploma transcript</option><option value="HEAC_CERTIFICATE">HEAC certificate</option><option value="OTHER">Other supporting document</option></select></label><label className="file-picker"><UploadCloud size={18} /><span>{selectedFile?.name ?? "Choose PDF, PNG or JPEG · max 4 MB"}</span><input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)} /></label><Button className="button-outline" variant="outline" disabled={unsupportedIntake || !selectedFile || upload.isPending} onClick={uploadFile}>{upload.isPending ? "Uploading…" : "Upload securely"}<ArrowRight size={15} /></Button></div>
        </fieldset>
        {current.documents.length ? <div className="document-list">{current.documents.map((doc) => <div key={doc.id} className="document-row"><div className="document-icon"><FileCheck2 size={17} /></div><div className="document-copy"><strong>{doc.fileName || doc.documentType}</strong><small>{doc.documentType.replaceAll("_", " ")}</small>{isStaff && <DocumentExtractionSummary fields={doc.extractedFields} />}</div><span className={`status-tag status-${doc.status}`}>{doc.status.replaceAll("_", " ")}</span><DocumentDownloadButton id={doc.id} />{isStaff && !caseLocked && doc.status !== "verified" && <DocumentReviewButton id={doc.id} mismatches={documentMismatchCount(doc.extractedFields)} onDone={() => void utils.aspire.applications.get.invalidate({ id })} />}</div>)}</div> : <div className="empty-inline">No documents uploaded yet. Upload your result slips/certificates even if you entered grades above.</div>}
      </section>
      {!isStaff && <div className="form-actions"><Button variant="outline" onClick={() => { setStep(1); void navigate(`/applications/${id}?step=1`); }}><ArrowLeft size={15} />Back</Button><Button className="button-primary" onClick={() => { setStep(3); void navigate(`/applications/${id}?step=3`); }}>Continue to programmes<ArrowRight size={15} /></Button></div>}</>;

  const aspireStep = <><section className="panel case-panel"><div className="panel-heading"><div><p className="eyebrow">STEP 3 · CAMPUSES, MODE & PROGRAMMES</p><h2>Choose where and what to study</h2></div><span className="step-count">03 / 03</span></div><ApplicationBasicsEditor application={current.application} role={role} choices={current.choices} mode="choices" /><div className="form-actions"><Button variant="outline" onClick={() => { setStep(2); void navigate(`/applications/${id}?step=2`); }}><ArrowLeft size={15} />Back</Button></div></section>
      <section className="panel case-panel aspire-panel"><div className="panel-heading"><div><p className="eyebrow">ASPIRE RECOMMENDATIONS</p><h2>Programmes you can do best</h2></div><span className="panel-meta">Based on your results & UMU rules</span></div>
        <div className="disclaimer-inline"><ShieldCheck size={16} /><span>ASPIRE recommendations are advisory. They use your entered results and current UMU rules; the admissions committee makes every final decision.</span></div>
        {recommendations.length ? <div className="recommendation-list">{recommendations.map((item) => <article key={item.programmeId} className="recommendation-card"><div className="recommendation-head"><div><strong>{item.programmeName}</strong><small className="capitalize">{item.outcome.replaceAll("_", " ").toLowerCase()}</small></div><span className={`status-tag status-outcome-${item.outcome.toLowerCase()}`}>{item.outcome.replaceAll("_", " ")}</span></div><p>{item.explanation}</p></article>)}</div> : <div className="empty-inline">Save your results in Step 2 to get ASPIRE recommendations. Recommendations appear after screening against UMU programme rules.</div>}
      </section></>;

  return <AspireShell title={application.applicantName} eyebrow={`Case · ${application.reference}`}>
        <div className="case-toolbar"><Link href="/applications" className="back-link"><ArrowLeft size={15} />All applications</Link><div className="case-toolbar-right"><span className={`status-tag status-${application.status}`}>{application.status.replaceAll("_", " ")}</span><span className="case-intake">{application.intake} · {application.level.replaceAll("_", " ")}</span></div></div>
    {unsupportedIntake && <section className="completed-case-notice"><div><strong>Unsupported intake</strong><p>This case uses {application.intake}. Screening and record changes are paused. Correct the intake to {LAUNCH_INTAKE} in applicant details before continuing.</p>{!isStaff && <Button variant="outline" className="button-outline" onClick={() => { setStep(1); void navigate(`/applications/${id}?step=1`); }}>Go to personal details</Button>}</div></section>}
    {caseLocked && <section className="completed-case-notice">
<div><strong>Committee record is complete; direct edits are locked.</strong><p>Applicants may still request a review. A faculty administrator or the registrar must give a reason to reopen the case before any correction or new screening.</p></div>{canReopenCase && <div className="reopen-case-control"><label className="form-field"><span>Reason to reopen <small>required · at least 10 characters</small></span><input value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} placeholder="e.g. Appeal accepted for evidence correction" /></label><Button variant="outline" className="button-outline" disabled={reopenReason.trim().length < 10 || reopenCase.isPending} onClick={() => reopenCase.mutate({ applicationId: id, reason: reopenReason })}>Reopen for correction</Button>{reopenCase.error && <p className="form-error">{reopenCase.error.message}</p>}</div>}</section>}
    {stepNav}
    {!isStaff && applicantStep === 1 && personalStep}
    {!isStaff && applicantStep === 2 && <div className="case-layout"><div className="case-main-column">{resultsStep}</div><aside className="case-side-column"><div className="panel applicant-facts"><p className="eyebrow">CASE SNAPSHOT</p><div className="fact-row"><span>Reference</span><strong className="mono">{application.reference}</strong></div><div className="fact-row"><span>Intake</span><strong>{application.intake}</strong></div><div className="fact-row"><span>Level</span><strong className="capitalize">{application.level.replaceAll("_", " ")}</strong></div><div className="fact-row"><span>Submitted</span><strong>{application.submittedAt ? new Date(application.submittedAt).toLocaleDateString() : "Draft"}</strong></div></div><div className="panel secure-panel"><ShieldCheck size={19} /><div><strong>Private by design</strong><p>Documents are stored privately and visible only to authorized users.</p></div></div></aside></div>}
    {!isStaff && applicantStep === 3 && <div className="case-layout"><div className="case-main-column">{aspireStep}{!isStaff && <section className="panel case-panel"><div className="panel-heading"><div><p className="eyebrow">CORRECTION & REVIEW</p><h2>Ask for a review</h2></div></div><p className="muted">If you think information is missing or incorrect, explain what should be reviewed. Staff will assess your request.</p><label className="form-field"><span>Message</span><textarea value={appealText} onChange={(e) => setAppealText(e.target.value)} rows={3} placeholder="Tell us what needs correcting or reviewing…" /></label><Button variant="outline" className="button-outline" disabled={appealText.trim().length < 10 || appeal.isPending} onClick={() => appeal.mutate({ applicationId: id, message: appealText })}><Send size={15} />Submit review request</Button></section>}{current.appeals.length > 0 && <section className="panel case-panel"><div className="panel-heading"><div><p className="eyebrow">REQUEST HISTORY</p><h2>Corrections & appeals</h2></div></div>{current.appeals.map((item) => <div className="appeal-row" key={item.id}><span className={`status-tag status-${item.status}`}>{item.status}</span><p>{item.message}</p>{"resolution" in item && typeof item.resolution === "string" && item.resolution.length > 0 ? <small>{item.resolution}</small> : null}</div>)}</section>}</div><aside className="case-side-column"><div className="panel applicant-facts"><p className="eyebrow">CASE SNAPSHOT</p><div className="fact-row"><span>Reference</span><strong className="mono">{application.reference}</strong></div><div className="fact-row"><span>Intake</span><strong>{application.intake}</strong></div><div className="fact-row"><span>Submitted</span><strong>{application.submittedAt ? new Date(application.submittedAt).toLocaleDateString() : "Draft"}</strong></div></div><ApplicationDeadlineControl applicationId={id} deadline={application.documentDeadline} role={role ?? "applicant"} locked={caseLocked} /><div className="panel secure-panel"><ShieldCheck size={19} /><div><strong>Advisory only</strong><p>ASPIRE does not issue admission offers. Final decisions are made by the admissions committee.</p></div></div></aside></div>}
    {isStaff && <div className="case-layout"><div className="case-main-column">
      <ApplicationBasicsEditor application={current.application} role={role} choices={current.choices} />
      <section className="panel case-panel"><div className="panel-heading"><div><p className="eyebrow">ACADEMIC RECORD</p><h2>Examination results</h2></div><span className="panel-meta">{activeResultRows.length} active entries</span></div>
        <fieldset className="case-fields" disabled={caseLocked}>
        <ResultRowsTable rows={activeResultRows} onUpdate={updateResultRowSafely} onRemove={(index) => setResultDrafts((rows) => rows.filter((_, j) => j !== index))} emptyMessage="No results have been entered yet." />
        <AddResultRow exam={newExam} subjectLevel={newSubjectLevel} subject={newSubject} grade={newGrade} sitting={newSitting} onExamChange={changeNewExam} onLevelChange={changeNewLevel} onSubjectChange={setNewSubject} onGradeChange={setNewGrade} onSittingChange={setNewSitting} onSubmit={submitResultRow} />
        <div className="form-actions"><span className="muted small-text">Applicant-entered marks are unverified until checked against documents.</span><Button className="button-outline" variant="outline" disabled={unsupportedIntake || saveResults.isPending} onClick={() => saveResults.mutate({ id, results: activeResultRows })}><Save size={15} />Save results</Button></div>{saveResults.error && <p className="form-error">{saveResults.error.message}</p>}
        {activeResultRows.length > 0 && <p className="verification-state">{current.results.length > 0 && current.results.every((row) => row.confirmed) ? "Active result rows have been confirmed by staff." : "Active result rows are not yet confirmed against official UNEB evidence."}</p>}
        {canConfirmResults && <div className="confirm-results-panel"><label className="form-field"><span>Staff verification note <small>required · confirm after reviewing the verified slip</small></span><input value={resultReviewNote} onChange={(event) => setResultReviewNote(event.target.value)} /></label><Button variant="outline" className="button-outline" disabled={confirmResults.isPending || resultReviewNote.trim().length < 10 || !current.documents.some((doc) => doc.status === "verified" && ["UCE_RESULT_SLIP", "UACE_RESULT_SLIP"].includes(doc.documentType))} onClick={() => confirmResults.mutate({ id, reviewNote: resultReviewNote })}><ShieldCheck size={15} />Confirm active results against official slip</Button>{confirmResults.error && <p className="form-error">{confirmResults.error.message}</p>}</div>}
        </fieldset>
      </section>
      <QualificationsEditor applicationId={id} qualifications={current.qualifications} locked={caseLocked || unsupportedIntake} />
      <section className="panel case-panel"><div className="panel-heading"><div><p className="eyebrow">SUPPORTING RECORD</p><h2>Documents</h2></div><span className="panel-meta">Human verification required</span></div>
        <fieldset className="case-fields" disabled={caseLocked}>
        {isRegistrar && <div className="document-upload"><label className="form-field"><span>Document type</span><select value={docType} onChange={(e) => setDocType(e.target.value)}><option value="UACE_RESULT_SLIP">UACE results slip</option><option value="UCE_RESULT_SLIP">UCE results slip</option><option value="NATIONAL_ID">National ID</option><option value="DIPLOMA_CERTIFICATE">Diploma certificate</option><option value="DIPLOMA_TRANSCRIPT">Diploma transcript</option><option value="HEAC_CERTIFICATE">HEAC certificate</option><option value="OTHER">Other supporting document</option></select></label><label className="file-picker"><UploadCloud size={18} /><span>{selectedFile?.name ?? "Choose PDF, PNG or JPEG · max 4 MB"}</span><input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)} /></label><Button className="button-outline" variant="outline" disabled={unsupportedIntake || !selectedFile || upload.isPending} onClick={uploadFile}>{upload.isPending ? "Uploading…" : "Upload securely"}<ArrowRight size={15} /></Button></div>}
        </fieldset>
        {current.documents.length ? <div className="document-list">{current.documents.map((doc) => <div key={doc.id} className="document-row"><div className="document-icon"><FileCheck2 size={17} /></div><div className="document-copy"><strong>{doc.fileName || doc.documentType}</strong><small>{doc.documentType.replaceAll("_", " ")}</small><DocumentExtractionSummary fields={doc.extractedFields} /></div><span className={`status-tag status-${doc.status}`}>{doc.status.replaceAll("_", " ")}</span><DocumentDownloadButton id={doc.id} />{isFacultyAdmin && !caseLocked && doc.status !== "verified" && <DocumentReviewButton id={doc.id} mismatches={documentMismatchCount(doc.extractedFields)} onDone={() => void utils.aspire.applications.get.invalidate({ id })} />}</div>)}</div> : <div className="empty-inline">No documents uploaded yet. They remain private to authorized users.</div>}
      </section>
      <section className="panel case-panel"><div className="panel-heading"><div><p className="eyebrow">STAFF CHECKS</p><h2>Screening evidence</h2></div><Button className="button-outline" variant="outline" disabled={caseLocked || unsupportedIntake || runScreening.isPending} onClick={() => runScreening.mutate({ applicationId: id })}><RefreshCw size={15} className={runScreening.isPending ? "spin" : ""} />{runScreening.isPending ? "Checking…" : "Re-run checks"}</Button></div>
        <div className="disclaimer-inline"><ShieldCheck size={16} /><span>For staff use only. Advisory evidence does not make an admission offer; the faculty records its recommendation and the registrar gives the final verdict.</span></div>
        {recentScreenings.length ? <div className="screening-list">{recentScreenings.map((run) => {
          const trace = run.resultTrace as Record<string, any>;
          const mapping = trace.mapping as { mappingStatus?: string; match?: string; issues?: string[] } | undefined;
          const engineResult = trace.result ?? trace;
          const missing = (engineResult.documents?.missing ?? []) as string[];
          const flags = (trace.anomalyFlags ?? []) as Array<{ code: string; message: string }>;
          return <article className="screening-card" key={run.id}><div className="screening-card-head"><div><h3>{run.programmeName}</h3><span className="mapping-meta">Rule set {run.ruleSetVersion} · {run.ruleStatus}</span></div><span className={`status-tag status-outcome-${run.outcome.toLowerCase()}`}>{run.outcome.replaceAll("_", " ")}</span></div><p>{trace.explanation ?? engineResult.notes?.join(" ") ?? "See the stored check trace."}</p>{missing.length > 0 && <div className="missing-docs"><strong>Required documents not yet verified</strong><span>{missing.map((item) => item.replaceAll("_", " ")).join(" · ")}</span></div>}{flags.length > 0 && <div className="anomaly-flags">{flags.map((flag) => <div key={flag.code}><CircleAlert size={13} /><span>{flag.message}</span></div>)}</div>}{mapping?.issues?.length ? <ul className="issue-list">{mapping.issues.slice(0, 2).map((issue: string) => <li key={issue}>{issue}</li>)}</ul> : null}<RouteEvidence result={engineResult} /></article>;
        })}</div> : <div className="empty-inline">No checks have been recorded yet. Saving results refreshes them automatically.</div>}
      </section>
      {(isFacultyAdmin || isRegistrar) && <section className="panel case-panel"><div className="panel-heading"><div><p className="eyebrow">{isFacultyAdmin ? "FACULTY RECOMMENDATION" : "REGISTRAR FINAL VERDICT"}</p><h2>{isFacultyAdmin ? "The faculty's say" : "Final decision"}</h2></div><span className="pending-pill">No automatic offers</span></div>{caseLocked && <p className="read-only-notice">This case already has a final verdict. An authorized staff member must reopen it before recording another.</p>}{isRegistrar && !facultyRecommendation && <p className="read-only-notice">The registrar can only record the final verdict after the faculty has recorded its recommendation.</p>}{isRegistrar && facultyRecommendation && <div className="decision-list"><div className="decision-row"><strong>Faculty said: {facultyRecommendation.recommendation.replaceAll("_", " ")}</strong><span>{facultyRecommendation.reason}</span><small>{new Date(facultyRecommendation.recommendedAt).toLocaleString()}</small></div></div>}{staleRecommendation && <p className="read-only-notice">Screening changed after this recommendation. Ask the faculty to record a fresh recommendation before the final verdict.</p>}<div className="form-row"><label className="form-field"><span>Programme</span><select disabled={caseLocked} value={decisionProgramme} onChange={(e) => setDecisionProgramme(e.target.value)}><option value="">Choose a screened programme</option>{decisionOptions.map((run) => <option key={run.programmeId} value={run.programmeId}>{run.programmeName} · {run.outcome}</option>)}</select></label><label className="form-field"><span>{isFacultyAdmin ? "Faculty recommendation" : "Final verdict"}</span><select disabled={caseLocked} value={decision} onChange={(e) => setDecision(e.target.value)}><option value="defer">Defer</option><option value="request_information">Request information</option><option value="admit">{isFacultyAdmin ? "Recommend admission" : "Admit"}</option><option value="decline">{isFacultyAdmin ? "Recommend decline" : "Decline"}</option></select></label></div>{isRegistrar && provisionalAdmitBlocked && <p className="read-only-notice">An admit verdict needs rules that UMU has approved, and a settled programme mapping. Ask the registrar to record UMU’s approval for this programme’s rules, then screen the case again so this screening uses the approved version.</p>}<label className="form-field"><span>Reason <small>required · at least 10 characters</small></span><textarea disabled={caseLocked} value={decisionReason} onChange={(e) => setDecisionReason(e.target.value)} rows={3} placeholder={isFacultyAdmin ? "Record the faculty's rationale and any conditions." : "Record the registrar's final rationale."} /></label>{isRegistrar && <label className="check-field"><input type="checkbox" disabled={caseLocked || decision !== "admit"} checked={override} onChange={(e) => setOverride(e.target.checked)} /><span>Override an ineligible or on-hold screening outcome for an admit verdict. A reason is required and the override will be audited.</span></label>}<Button className="button-primary" disabled={caseLocked || !decisionProgramme || decisionReason.trim().length < 10 || (isFacultyAdmin ? makeRecommendation.isPending : makeDecision.isPending || finalVerdictBlocked || staleRecommendation) || (isRegistrar && provisionalAdmitBlocked)} onClick={() => isFacultyAdmin ? makeRecommendation.mutate({ applicationId: id, programmeId: decisionProgramme, recommendation: decision as "admit" | "decline" | "defer" | "request_information", reason: decisionReason }) : makeDecision.mutate({ applicationId: id, programmeId: decisionProgramme, decision: decision as "admit" | "decline" | "defer" | "request_information", reason: decisionReason, overrideSystemResult: decision === "admit" && override })}>{isFacultyAdmin ? "Record faculty recommendation" : "Record final verdict"}<ArrowRight size={15} /></Button>{(isFacultyAdmin ? makeRecommendation.error : makeDecision.error) && <p className="form-error">{(isFacultyAdmin ? makeRecommendation.error : makeDecision.error)!.message}</p>}{current.decisions.length > 0 && <div className="decision-list">{current.decisions.map((item) => <div className="decision-row" key={item.id}><strong>{item.decision.replaceAll("_", " ")}</strong><span>{(item as { reason?: string }).reason ?? ""}</span><small>{new Date(item.decidedAt).toLocaleString()}</small></div>)}</div>}</section>}
      {current.appeals.length > 0 && <section className="panel case-panel"><div className="panel-heading"><div><p className="eyebrow">REQUEST HISTORY</p><h2>Corrections & appeals</h2></div></div>{current.appeals.map((item) => <div className="appeal-row" key={item.id}><span className={`status-tag status-${item.status}`}>{item.status}</span><p>{item.message}</p>{"resolution" in item && typeof item.resolution === "string" && item.resolution.length > 0 ? <small>{item.resolution}</small> : null}</div>)}</section>}
    </div><aside className="case-side-column"><div className="panel applicant-facts"><p className="eyebrow">CASE SNAPSHOT</p><div className="fact-row"><span>Reference</span><strong className="mono">{application.reference}</strong></div><div className="fact-row"><span>Intake</span><strong>{application.intake}</strong></div><div className="fact-row"><span>Level</span><strong className="capitalize">{application.level.replaceAll("_", " ")}</strong></div><div className="fact-row"><span>Submitted</span><strong>{application.submittedAt ? new Date(application.submittedAt).toLocaleDateString() : "Draft"}</strong></div><div className="side-divider" /><div className="fact-note"><CircleAlert size={15} /><span>Marks entered by applicants remain unverified until checked against official records.</span></div></div><ApplicationDeadlineControl applicationId={id} deadline={application.documentDeadline} role={role ?? "applicant"} locked={caseLocked} /><div className="panel secure-panel"><ShieldCheck size={19} /><div><strong>Private by design</strong><p>Uploaded documents are stored separately and returned to authorized users using short-lived access.</p></div></div><div className="audit-mini"><span className="eyebrow">RECENT ACTIVITY</span>{current.history.slice(0, 6).map((item) => <div className="activity-row" key={item.id}><i /><span><strong>{item.action.replaceAll("_", " ")}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></span></div>)}</div></aside></div>}
  </AspireShell>;
}

function DocumentReviewButton({ id, mismatches, onDone }: { id: number; mismatches: number; onDone: () => void }) {
  const [resolved, setResolved] = useState(false);
  const [note, setNote] = useState("Manually compared with the source document; do not treat extraction as confirmation of official UNEB results.");
  const review = trpc.aspire.documents.review.useMutation({ onSuccess: () => { toast.success("Document review recorded."); onDone(); } });
  return <div className="document-review-control">{mismatches > 0 && <label className="check-field extraction-ack"><input type="checkbox" checked={resolved} onChange={(event) => setResolved(event.target.checked)} /><span>Reviewed and resolved {mismatches} extracted grade discrepancy{mismatches === 1 ? "" : "ies"} against the original source</span></label>}<input aria-label="Document review note" value={note} onChange={(event) => setNote(event.target.value)} /><Button size="sm" variant="outline" disabled={review.isPending || note.trim().length < 10 || (mismatches > 0 && !resolved)} onClick={() => review.mutate({ documentId: id, status: "verified", reviewNote: note, mismatchesResolved: resolved })}><Check size={14} />Verify</Button>{review.error && <span className="form-error">{review.error.message}</span>}</div>;
}

function DocumentDownloadButton({ id }: { id: number }) {
  const download = trpc.aspire.documents.download.useMutation({ onSuccess: ({ url }) => window.open(url, "_blank", "noopener,noreferrer") });
  return <button className="icon-button" title="Download securely" aria-label="Download document" disabled={download.isPending} onClick={() => download.mutate({ documentId: id })}><Download size={14} /></button>;
}
