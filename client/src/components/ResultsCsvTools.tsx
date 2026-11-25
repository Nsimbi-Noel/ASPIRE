import { useRef, useState } from "react";
import { Download, FileUp, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

export function ResultsCsvTools({ canImport = true }: { canImport?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const utils = trpc.useUtils();
  const exportData = trpc.aspire.staff.exportCsv.useQuery(undefined, { enabled: false });
  const importData = trpc.aspire.staff.importResultsCsv.useMutation({ onSuccess: (result) => {
    toast.success(`Imported ${result.resultsImported} result rows across ${result.applicationsUpdated} cases.`);
    setCsvText(""); setFileName("");
    void utils.aspire.staff.queue.invalidate(); void utils.aspire.applications.list.invalidate(); void utils.aspire.evaluation.invalidate();
  } });
  const chooseFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 1_048_576) { toast.error("CSV files must be 1 MiB or smaller."); return; }
    const text = await file.text();
    setCsvText(text); setFileName(file.name);
  };
  const download = async () => {
    const result = await exportData.refetch();
    if (!result.data) { toast.error("Could not prepare the export."); return; }
    const url = URL.createObjectURL(new Blob([result.data.csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = result.data.filename; anchor.click(); URL.revokeObjectURL(url);
  };
  if (!canImport) return <section className="panel case-panel"><div className="panel-heading"><div><p className="eyebrow">CONTROLLED DATA EXCHANGE</p><h2>CSV export</h2></div><Download size={19} /></div>
    <p className="muted">Exports the applications and results you are allowed to see. Importing results is limited to the registrar.</p>
    <div className="csv-actions"><Button variant="outline" className="button-outline" onClick={() => void download()} disabled={exportData.isFetching}><Download size={15} />{exportData.isFetching ? "Preparing…" : "Export application & results CSV"}</Button></div>
  </section>;
  return <section className="panel case-panel"><div className="panel-heading"><div><p className="eyebrow">CONTROLLED DATA EXCHANGE</p><h2>CSV import & export</h2></div><FileUp size={19} /></div>
    <div className="disclaimer-inline"><ShieldAlert size={16} /><span>Imports replace active result rows for every referenced case; prior rows stay in the audit history. Validate the file and confirm references before import. Completed cases are rejected.</span></div>
    <div className="csv-actions"><Button variant="outline" className="button-outline" onClick={() => void download()} disabled={exportData.isFetching}><Download size={15} />{exportData.isFetching ? "Preparing…" : "Export application & results CSV"}</Button><Button variant="outline" className="button-outline" onClick={() => inputRef.current?.click()}><FileUp size={15} />Choose result CSV</Button><input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={(event) => void chooseFile(event.target.files?.[0])} /></div>
    {fileName && <div className="csv-selected"><strong>{fileName}</strong><span>{csvText.length.toLocaleString()} characters</span></div>}
    <details className="csv-format"><summary>Required format and validation rules</summary><p>Exact headers (any order): <code>reference,exam,subject,grade,sitting,subjectLevel</code>. UCE rows need a blank subjectLevel; UACE rows need PRINCIPAL or SUBSIDIARY. Exam years must be four digits. One file may contain up to 2,000 rows and 1 MiB. A reference’s rows replace its active result set.</p><a href="data:text/csv;charset=utf-8,reference%2Cexam%2Csubject%2Cgrade%2Csitting%2CsubjectLevel%0AAS-2026-ABC1234%2CUACE%2CMathematics%2CA%2C2025%2CPRINCIPAL%0AAS-2026-ABC1234%2CUCE%2CEnglish%2CC4%2C2023%2C" download="aspire-results-template.csv">Download a sample template</a></details>
    {csvText && <div className="csv-preview"><div><strong>Ready to validate & import</strong><span>References and grades will be checked before any cases are changed.</span></div><Button className="button-primary" disabled={importData.isPending} onClick={() => importData.mutate({ csvText })}>{importData.isPending ? "Validating & importing…" : "Validate and import"}</Button></div>}
    {importData.error && <p className="form-error">Import failed: {importData.error.message}</p>}
  </section>;
}
