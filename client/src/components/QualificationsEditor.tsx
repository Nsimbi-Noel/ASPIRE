import { useState } from "react";
import { Award, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

type QualificationType = "DIPLOMA" | "CERTIFICATE" | "HEAC";
type Classification = "DISTINCTION" | "CREDIT" | "PASS" | "FIRST_CLASS" | "SECOND_CLASS" | "PASS_CLASS";
type QualificationRecord = { id: number; qualificationType: QualificationType; classification: Classification; qualificationName: string; institution: string | null; relatedToProgramme: boolean | null; completedYear: string | null };

export function QualificationsEditor({ applicationId, qualifications, locked = false }: { applicationId: string; qualifications: QualificationRecord[]; locked?: boolean }) {
  const utils = trpc.useUtils();
  const [qualificationType, setQualificationType] = useState<QualificationType>("DIPLOMA");
  const [classification, setClassification] = useState<Classification>("CREDIT");
  const [qualificationName, setQualificationName] = useState("");
  const [institution, setInstitution] = useState("");
  const [completedYear, setCompletedYear] = useState("");
  const [related, setRelated] = useState("unknown");
  const save = trpc.aspire.applications.saveQualifications.useMutation({ onSuccess: () => { toast.success("Qualification added. Earlier entries remain in history."); setQualificationName(""); void utils.aspire.applications.get.invalidate({ id: applicationId }); } });
  const add = () => {
    if (qualificationName.trim().length < 2) return;
    const existing = qualifications.map((item) => ({ qualificationType: item.qualificationType, classification: item.classification, qualificationName: item.qualificationName, institution: item.institution ?? undefined, relatedToProgramme: item.relatedToProgramme, completedYear: item.completedYear ?? undefined }));
    save.mutate({ id: applicationId, qualifications: [...existing, { qualificationType, classification, qualificationName: qualificationName.trim(), institution: institution.trim() || undefined, relatedToProgramme: related === "unknown" ? null : related === "yes", completedYear: completedYear.trim() || undefined }] });
  };
  return <section className="panel case-panel"><div className="panel-heading"><div><p className="eyebrow">ALTERNATIVE ENTRY</p><h2>Diploma, certificate & HEAC</h2></div><span className="panel-meta">For relevant pathways</span></div>
    {qualifications.length ? <div className="qualification-list">{qualifications.map((item) => <div className="qualification-row" key={item.id}><span className="qualification-icon"><Award size={16} /></span><div><strong>{item.qualificationName}</strong><small>{item.qualificationType} · {item.classification}{item.relatedToProgramme === null ? " · relation unreviewed" : item.relatedToProgramme ? " · related field" : " · not related"}{item.completedYear ? ` · ${item.completedYear}` : ""}</small></div></div>)}</div> : <p className="muted small-text">No prior qualification recorded. Add one if applying through an alternative entry route.</p>}
    {locked ? <div className="read-only-notice">Qualification records are locked until an authorized staff member reopens this completed case.</div> : <div className="qualification-form"><label className="form-field"><span>Qualification</span><select value={qualificationType} onChange={(e) => setQualificationType(e.target.value as QualificationType)}><option value="DIPLOMA">Diploma</option><option value="CERTIFICATE">Certificate</option><option value="HEAC">Higher Education Access Certificate</option></select></label><label className="form-field"><span>Classification</span><select value={classification} onChange={(e) => setClassification(e.target.value as Classification)}><option value="DISTINCTION">Distinction</option><option value="CREDIT">Credit</option><option value="PASS">Pass</option><option value="FIRST_CLASS">First class</option><option value="SECOND_CLASS">Second class</option><option value="PASS_CLASS">Pass class</option></select></label><label className="form-field"><span>Qualification name</span><input value={qualificationName} onChange={(e) => setQualificationName(e.target.value)} placeholder="e.g. Diploma in Agriculture" /></label><label className="form-field"><span>Institution <small>optional</small></span><input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Awarding institution" /></label><label className="form-field"><span>Year <small>optional</small></span><input value={completedYear} onChange={(e) => setCompletedYear(e.target.value)} placeholder="2024" /></label><label className="form-field"><span>Related to programme?</span><select value={related} onChange={(e) => setRelated(e.target.value)}><option value="unknown">Not reviewed</option><option value="yes">Yes</option><option value="no">No</option></select></label><Button variant="outline" className="button-outline" disabled={qualificationName.trim().length < 2 || save.isPending} onClick={add}><Plus size={14} />Add qualification</Button></div>}
    {save.error && <p className="form-error">{save.error.message}</p>}
  </section>;
}
