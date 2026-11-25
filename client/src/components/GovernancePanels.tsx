import { useState } from "react";
import { ShieldCheck, UserCog } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc } from "@/lib/trpc";
import type { AppRouter } from "../../../server/routers";

const roleLabels = { applicant: "Applicant", registrar: "Registrar", faculty_administrator: "Faculty administrator" } as const;
type RoleId = keyof typeof roleLabels;
const readable = (value: string) => value.replaceAll("_", " ").replaceAll("-", " ");

type Outputs = inferRouterOutputs<AppRouter>;
type UserRow = Outputs["aspire"]["staff"]["users"][number];
type RuleRow = Outputs["aspire"]["rules"]["list"][number];

/* ---------------------------------------------------------------- users */

function UserRoleRow({ user, faculties, saving, onSave, onReset, onToggleActive }: {
  user: UserRow;
  faculties: Array<{ id: string; name: string }>;
  saving: boolean;
  onSave: (input: { userId: number; role: RoleId; facultyId: string | null }) => void;
  onReset: (user: UserRow) => void;
  onToggleActive: (user: UserRow) => void;
}) {
  const owner = user.role === "admin";
  const currentRole: RoleId = owner ? "registrar" : (user.aspireRole as RoleId);
  const [role, setRole] = useState<RoleId>(currentRole);
  const [facultyId, setFacultyId] = useState(user.facultyId ?? "");
  const needsFaculty = role === "faculty_administrator";
  const dirty = role !== currentRole || (needsFaculty && facultyId !== (user.facultyId ?? ""));
  const unassigned = currentRole === "faculty_administrator" && !user.facultyId;
  const locked = user.lockedUntil !== null && new Date(user.lockedUntil) > new Date();
  return <div className={`user-row-v2${user.isActive ? "" : " user-row-inactive"}`}>
    <div className="user-role-name"><strong>{user.name || user.email || `User ${user.id}`}</strong><small>{user.email ?? "No email recorded"}</small></div>
    <div className="user-row-tags">
      {owner && <span className="role-platform">Project owner</span>}
      {!user.isActive && <span className="role-platform">Deactivated</span>}
      {locked && <span className="role-platform">Locked</span>}
      {user.mustChangePassword && <span className="role-platform">Temporary password</span>}
    </div>
    <div className="user-row-controls">
      <select aria-label="Role" value={role} disabled={owner || saving} onChange={(event) => setRole(event.target.value as RoleId)}>
        {(Object.keys(roleLabels) as RoleId[]).map((id) => <option key={id} value={id}>{roleLabels[id]}</option>)}
      </select>
      {needsFaculty && <select aria-label="Faculty" value={facultyId} disabled={saving} onChange={(event) => setFacultyId(event.target.value)}>
        <option value="">Choose a faculty…</option>
        {faculties.map((faculty) => <option key={faculty.id} value={faculty.id}>{faculty.name}</option>)}
      </select>}
      <Button className="button-primary" disabled={owner || !dirty || saving || (needsFaculty && !facultyId)} onClick={() => onSave({ userId: user.id, role, facultyId: needsFaculty ? facultyId : null })}>Save</Button>
      {!owner && <Button variant="outline" className="button-outline" disabled={saving} onClick={() => onReset(user)}>Reset password</Button>}
      {!owner && <Button variant="outline" className="button-outline" disabled={saving} onClick={() => onToggleActive(user)}>{user.isActive ? "Deactivate" : "Reactivate"}</Button>}
    </div>
    {unassigned && <p className="user-row-warning">No faculty assigned: this person cannot see any cases until you choose one.</p>}
  </div>;
}

/** The one-time password. It is never stored in readable form and cannot be shown again. */
function TemporaryPassword({ who, password, onDismiss }: { who: string; password: string; onDismiss: () => void }) {
  return <div className="temp-password" role="status">
    <strong>Temporary password for {who}</strong>
    <code>{password}</code>
    <p className="muted small-text">Shown once. Give it to the person privately. They must choose their own password when they first sign in. If it is lost, reset it.</p>
    <div className="form-actions">
      <Button variant="outline" className="button-outline" onClick={() => { void navigator.clipboard?.writeText(password); toast.success("Copied."); }}>Copy</Button>
      <Button className="button-primary" onClick={onDismiss}>I have passed it on</Button>
    </div>
  </div>;
}

function CreateUserForm({ faculties, onCreated }: { faculties: Array<{ id: string; name: string }>; onCreated: (issued: { who: string; password: string }) => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<RoleId>("faculty_administrator");
  const [facultyId, setFacultyId] = useState("");
  const create = trpc.aspire.staff.createUser.useMutation({
    onSuccess: (result) => {
      onCreated({ who: result.email, password: result.temporaryPassword });
      setName(""); setEmail(""); setFacultyId("");
      void utils.aspire.staff.users.invalidate();
    },
  });
  const needsFaculty = role === "faculty_administrator";
  return <div className="rv-form create-user-form">
    <strong>Create an account</strong>
    <div className="form-row">
      <label className="form-field"><span>Full name</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label className="form-field"><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    </div>
    <div className="form-row">
      <label className="form-field"><span>Role</span><select value={role} onChange={(event) => setRole(event.target.value as RoleId)}>{(Object.keys(roleLabels) as RoleId[]).map((id) => <option key={id} value={id}>{roleLabels[id]}</option>)}</select></label>
      {needsFaculty && <label className="form-field"><span>Faculty</span><select value={facultyId} onChange={(event) => setFacultyId(event.target.value)}><option value="">Choose a faculty…</option>{faculties.map((faculty) => <option key={faculty.id} value={faculty.id}>{faculty.name}</option>)}</select></label>}
    </div>
    {create.error && <p className="form-error" role="alert">{create.error.message}</p>}
    <div className="form-actions"><Button className="button-primary" disabled={create.isPending || name.trim().length < 2 || !email.includes("@") || (needsFaculty && !facultyId)} onClick={() => create.mutate({ name: name.trim(), email: email.trim(), role, facultyId: needsFaculty ? facultyId : null })}>{create.isPending ? "Creating…" : "Create account"}</Button></div>
  </div>;
}

export function UsersPanel() {
  const users = trpc.aspire.staff.users.useQuery();
  const faculties = trpc.aspire.catalog.faculties.useQuery();
  const utils = trpc.useUtils();
  const [issued, setIssued] = useState<{ who: string; password: string } | null>(null);
  const refresh = () => { void utils.aspire.staff.users.invalidate(); };
  const failed = (error: { message: string }) => toast.error(error.message);
  const setRole = trpc.aspire.profile.setRole.useMutation({ onSuccess: () => { toast.success("Role updated."); refresh(); }, onError: failed });
  const reset = trpc.aspire.staff.resetPassword.useMutation({ onError: failed });
  const toggle = trpc.aspire.staff.setUserActive.useMutation({ onSuccess: refresh, onError: failed });
  const busy = setRole.isPending || reset.isPending || toggle.isPending;
  return <section className="panel case-panel users-panel">
    <div className="panel-heading"><div><p className="eyebrow">ACCESS CONTROL</p><h2>Workspace users</h2></div><UserCog size={19} /></div>
    <p className="muted">Three roles: applicant, faculty administrator and registrar. A faculty administrator sees only the applicants who applied to a programme in their own faculty, so every faculty administrator must be assigned a faculty. Applicants sign themselves up; you create staff accounts here. Accounts are deactivated, never deleted.</p>
    {issued && <TemporaryPassword who={issued.who} password={issued.password} onDismiss={() => setIssued(null)} />}
    <CreateUserForm faculties={faculties.data ?? []} onCreated={setIssued} />
    {users.data?.length ? <div className="user-role-list">
      {users.data.map((user) => <UserRoleRow key={`${user.id}-${user.aspireRole}-${user.facultyId ?? ""}-${user.isActive}`} user={user} faculties={faculties.data ?? []} saving={busy}
        onSave={(input) => setRole.mutate(input)}
        onReset={(target) => { if (window.confirm(`Reset the password for ${target.email ?? target.name}? Their current sessions will end.`)) reset.mutate({ userId: target.id }, { onSuccess: (result) => { setIssued({ who: target.email ?? target.name ?? `user ${target.id}`, password: result.temporaryPassword }); refresh(); } }); }}
        onToggleActive={(target) => { if (window.confirm(target.isActive ? `Deactivate ${target.email ?? target.name}? They will be signed out and cannot sign in.` : `Reactivate ${target.email ?? target.name}?`)) toggle.mutate({ userId: target.id, active: !target.isActive }); }} />)}
    </div> : <div className="empty-inline">No users yet.</div>}
  </section>;
}

/* ------------------------------------------------------------ rule sets */

type Action = "approve" | "reject" | "activate" | "retire" | null;

function RuleVersionRow({ row, programmeName, onChanged }: { row: RuleRow; programmeName: string; onChanged: () => void }) {
  const [action, setAction] = useState<Action>(null);
  const [approvedBy, setApprovedBy] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [endDate, setEndDate] = useState("");
  const done = () => { setAction(null); setApprovedBy(""); setReference(""); setNote(""); setReason(""); setEndDate(""); onChanged(); };
  const failed = (error: { message: string }) => toast.error(error.message);
  const approval = trpc.aspire.rules.recordApproval.useMutation({ onSuccess: () => { toast.success("Approval decision recorded."); done(); }, onError: failed });
  const activate = trpc.aspire.rules.activate.useMutation({ onSuccess: () => { toast.success("Version activated: new screenings will use it."); done(); }, onError: failed });
  const retire = trpc.aspire.rules.retire.useMutation({ onSuccess: () => { toast.success("Version retired from the end date."); done(); }, onError: failed });
  const busy = approval.isPending || activate.isPending || retire.isPending;
  const activated = row.activatedAt !== null;
  return <div className="rule-version-row">
    <div className="rv-main">
      <strong>{programmeName}</strong>
      <span className="mono muted">{row.id}</span>
      <small>{row.effectiveFrom}{row.effectiveTo ? ` to ${row.effectiveTo}` : ""} · edition {row.edition} · {readable(row.status)}</small>
      <small>{row.approval}</small>
    </div>
    <div className="rv-tags">
      <span className={`approval-tag rv-${row.approvalStatus}`}>{row.approvalStatus.toUpperCase()}</span>
      <span className={`approval-tag ${row.inUse ? "rv-inuse" : "rv-idle"}`}>{row.inUse ? "IN USE" : activated ? "NOT CURRENT" : "NOT ACTIVATED"}</span>
    </div>
    <div className="rv-actions">
      {row.approvalStatus !== "approved" && <Button variant="outline" className="button-outline" onClick={() => setAction("approve")}>Record UMU approval</Button>}
      {row.approvalStatus !== "rejected" && <Button variant="outline" className="button-outline" onClick={() => setAction("reject")}>Record rejection</Button>}
      {!activated && row.approvalStatus !== "rejected" && row.status !== "needs-review" && <Button variant="outline" className="button-outline" onClick={() => setAction("activate")}>Activate</Button>}
      {row.inUse && <Button variant="outline" className="button-outline" onClick={() => setAction("retire")}>Retire</Button>}
    </div>
    {action && <div className="rv-form">
      {(action === "approve" || action === "reject") && <>
        <label className="form-field"><span>{action === "approve" ? "Approved by (person or body at UMU)" : "Rejected by (person or body at UMU)"}</span><input value={approvedBy} onChange={(event) => setApprovedBy(event.target.value)} /></label>
        {action === "approve" && <label className="form-field"><span>UMU reference (letter, minute or email)</span><input value={reference} onChange={(event) => setReference(event.target.value)} /></label>}
        <label className="form-field"><span>{action === "approve" ? "Note (optional)" : "Why was it rejected?"}</span><input value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <div className="form-actions"><Button variant="outline" className="button-outline" onClick={() => setAction(null)}>Cancel</Button>
          <Button className="button-primary" disabled={busy || approvedBy.trim().length < 3 || (action === "approve" ? reference.trim().length < 3 : note.trim().length < 5)} onClick={() => approval.mutate({ ruleSetId: row.id, decision: action === "approve" ? "approved" : "rejected", approvedBy: approvedBy.trim(), reference: reference.trim() || undefined, note: note.trim() || undefined })}>{action === "approve" ? "Record approval" : "Record rejection"}</Button></div>
        {action === "approve" && <p className="muted small-text">Record an approval only when UMU has confirmed these rules in writing. It allows admit decisions that rely on this version.</p>}
      </>}
      {action === "activate" && <>
        <label className="form-field"><span>Why is this version being put into use? (at least 10 characters)</span><input value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <div className="form-actions"><Button variant="outline" className="button-outline" onClick={() => setAction(null)}>Cancel</Button>
          <Button className="button-primary" disabled={busy || reason.trim().length < 10} onClick={() => activate.mutate({ ruleSetId: row.id, reason: reason.trim() })}>Activate version</Button></div>
        <p className="muted small-text">Activating does not mean UMU has approved it. New screenings use it from its start date.</p>
      </>}
      {action === "retire" && <>
        <label className="form-field"><span>Last day of use (it stops applying on this date)</span><input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
        <label className="form-field"><span>Reason (at least 10 characters)</span><input value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        <div className="form-actions"><Button variant="outline" className="button-outline" onClick={() => setAction(null)}>Cancel</Button>
          <Button className="button-primary" disabled={busy || !endDate || reason.trim().length < 10} onClick={() => retire.mutate({ ruleSetId: row.id, effectiveTo: endDate, reason: reason.trim() })}>Retire version</Button></div>
      </>}
    </div>}
  </div>;
}

export function RuleSetsPanel({ programmes }: { programmes: Array<{ id: string; name: string; screenable: boolean }> }) {
  const utils = trpc.useUtils();
  const rows = trpc.aspire.rules.list.useQuery();
  const refresh = () => { void utils.aspire.rules.list.invalidate(); };
  const seed = trpc.aspire.rules.seedFromFiles.useMutation({
    onSuccess: (result) => { toast.success(`Created ${result.created} version(s); ${result.skipped} already existed.`); refresh(); },
    onError: (error) => toast.error(error.message),
  });
  const propose = trpc.aspire.rules.propose.useMutation({ onSuccess: () => { toast.success("New version saved. It is not in use until you activate it."); refresh(); }, onError: (error) => toast.error(error.message) });
  const [programmeId, setProgrammeId] = useState("");
  const [version, setVersion] = useState("v2");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [edition, setEdition] = useState("2026/2027");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState<"assumed" | "adopted-proxy">("assumed");
  const [rulesJson, setRulesJson] = useState("");
  const names = new Map(programmes.map((programme) => [programme.id, programme.name]));
  const list = rows.data ?? [];
  const counts = { inUse: list.filter((row) => row.inUse).length, approved: list.filter((row) => row.approvalStatus === "approved").length, pending: list.filter((row) => row.approvalStatus === "pending").length };

  const loadCurrent = async () => {
    if (!programmeId) return;
    try {
      const current = await utils.aspire.rules.current.fetch({ programmeId });
      setRulesJson(JSON.stringify(current.content, null, 2));
      toast.success(current.recordId ? `Loaded ${current.recordId}. Edit it and save as a new version.` : "Loaded the rules from the data files. Edit and save as a new version.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not load the current rules."); }
  };
  const save = () => {
    try { propose.mutate({ programmeId, version: version.trim(), effectiveFrom, source: source.trim(), edition: edition.trim(), status, rules: JSON.parse(rulesJson) as Record<string, unknown> }); }
    catch { toast.error("The rules must be valid JSON."); }
  };

  return <section className="panel case-panel">
    <div className="panel-heading"><div><p className="eyebrow">RULE VERSIONS</p><h2>Versions in use and UMU approval</h2></div><ShieldCheck size={19} /></div>
    <p className="muted">Each programme's rules are versioned and never edited: to change them, save a new version. A version is used for screening once activated. An admit decision can only be recorded when UMU has approved the version the screening used. Record that approval here, with who approved it and the reference.</p>
    <div className="rv-summary"><span><b>{counts.inUse}</b> in use</span><span><b>{counts.approved}</b> approved by UMU</span><span><b>{counts.pending}</b> awaiting approval</span></div>
    {rows.isLoading ? <div className="loading-block">Loading rule versions…</div> : list.length === 0 ? <div className="locked-action"><ShieldCheck size={17} /><div><strong>No rule versions stored yet</strong><p>Screening currently uses the rules in the data files, which cannot record an approval. Create the first versions from those files to start tracking approval.</p><Button className="button-primary" disabled={seed.isPending} onClick={() => seed.mutate()}>{seed.isPending ? "Creating…" : "Create the first versions from the data files"}</Button></div></div> :
      <div className="rule-version-list">{list.map((row) => <RuleVersionRow key={`${row.id}-${row.approvalStatus}-${row.activatedAt ? "a" : "i"}-${row.effectiveTo ?? ""}`} row={row} programmeName={names.get(row.programmeId) ?? row.programmeId} onChanged={refresh} />)}</div>}

    <div className="governance-history"><h3>Save a new version</h3>
      <div className="form-row">
        <label className="form-field"><span>Programme</span><select value={programmeId} onChange={(event) => setProgrammeId(event.target.value)}><option value="">Choose a programme</option>{programmes.filter((item) => item.screenable).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="form-field"><span>Version label</span><input value={version} onChange={(event) => setVersion(event.target.value)} /></label>
      </div>
      <div className="form-row">
        <label className="form-field"><span>Effective from</span><input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></label>
        <label className="form-field"><span>Source edition</span><input value={edition} onChange={(event) => setEdition(event.target.value)} /></label>
      </div>
      <div className="form-row">
        <label className="form-field"><span>Where the rules come from</span><input value={source} onChange={(event) => setSource(event.target.value)} placeholder="Document or decision the rules come from" /></label>
        <label className="form-field"><span>Provenance</span><select value={status} onChange={(event) => setStatus(event.target.value as "assumed" | "adopted-proxy")}><option value="assumed">Assumed</option><option value="adopted-proxy">Adopted from another institution</option></select></label>
      </div>
      <label className="form-field"><span>Rules (JSON)</span><textarea rows={9} value={rulesJson} onChange={(event) => setRulesJson(event.target.value)} placeholder="Use “Load the rules currently in use” to start from the current version." /></label>
      <div className="form-actions">
        <Button variant="outline" className="button-outline" disabled={!programmeId} onClick={() => void loadCurrent()}>Load the rules currently in use</Button>
        <Button className="button-primary" disabled={!programmeId || !rulesJson.trim() || source.trim().length < 5 || propose.isPending} onClick={save}>Save new version</Button>
      </div>
      {propose.error && <p className="form-error">{propose.error.message}</p>}
      <p className="muted small-text">Only UMU can publish official rules, so a new version is recorded as assumed or adopted. Content is checked before it is saved.</p>
    </div>
  </section>;
}
