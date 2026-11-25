import { useEffect, useState } from "react";
import { Bell, CalendarDays, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

type Role = "applicant" | "registrar" | "faculty_administrator";

export function ApplicationDeadlineControl({ applicationId, deadline, role, locked = false }: { applicationId: string; deadline: Date | string | null; role: Role; locked?: boolean }) {
  const utils = trpc.useUtils();
  const canSet = !locked && (role === "faculty_administrator" || role === "registrar");
  const initial = deadline ? new Date(deadline).toISOString().slice(0, 10) : "";
  const [date, setDate] = useState(initial);
  const [reason, setReason] = useState("Outstanding documents are required for continued admissions review.");
  useEffect(() => setDate(initial), [initial]);
  const mutation = trpc.aspire.staff.setDocumentDeadline.useMutation({
    onSuccess: () => {
      toast.success("Document deadline updated; the applicant was notified.");
      void utils.aspire.applications.get.invalidate({ id: applicationId });
      void utils.aspire.staff.queue.invalidate();
    },
  });
  return <div className="deadline-control">
    <div className="deadline-heading"><CalendarDays size={15} /><strong>Document deadline</strong></div>
    <p>{deadline ? `Submit outstanding evidence by ${new Date(deadline).toLocaleDateString("en-GB", { timeZone: "UTC" })}.` : "No document deadline has been set yet."}</p>
    {canSet && <div className="deadline-editor"><label className="form-field"><span>Deadline date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="form-field"><span>Reason <small>required</small></span><input value={reason} onChange={(event) => setReason(event.target.value)} /></label><div className="deadline-actions"><Button className="button-outline" variant="outline" disabled={mutation.isPending || !date || reason.trim().length < 10} onClick={() => mutation.mutate({ applicationId, deadline: date || null, reason })}><Save size={14} />Set deadline</Button>{deadline && <Button className="button-outline" variant="outline" disabled={mutation.isPending || reason.trim().length < 10} onClick={() => mutation.mutate({ applicationId, deadline: null, reason })}>Clear</Button>}</div>{mutation.error && <span className="form-error">{mutation.error.message}</span>}</div>}
    {!canSet && deadline && <small className="deadline-notice"><Bell size={12} /> Admissions sets or changes this date; updated dates are sent as a notification.</small>}
  </div>;
}
