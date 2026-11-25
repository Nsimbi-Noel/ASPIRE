import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { AspireShell } from "@/components/AspireShell";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

const roleNames = { applicant: "Applicant", registrar: "Registrar", faculty_administrator: "Faculty administrator" } as const;

export default function AccountPage() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const profile = trpc.aspire.profile.me.useQuery(undefined, { enabled: Boolean(me.data) && !me.data?.mustChangePassword });
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const change = trpc.auth.changePassword.useMutation({
    onSuccess: async () => {
      toast.success("Password changed. Your other sessions were signed out.");
      setCurrent(""); setNext(""); setConfirm("");
      await utils.auth.me.invalidate();
      navigate("/");
    },
  });
  const mismatch = confirm.length > 0 && confirm !== next;
  const submit = (event: FormEvent) => { event.preventDefault(); if (!mismatch) change.mutate({ currentPassword: current, newPassword: next }); };
  const forced = me.data?.mustChangePassword === true;

  return <AspireShell title="Account" eyebrow="Your sign-in">
    {forced && <div className="locked-action"><div><strong>Choose your own password</strong><p>You are signed in with a temporary password. Set a password that only you know before you continue.</p></div></div>}
    <section className="panel case-panel">
      <div className="panel-heading"><div><p className="eyebrow">ACCOUNT</p><h2>{me.data?.name ?? "Your account"}</h2></div></div>
      <p className="muted">{me.data?.email}<br />{me.data ? roleNames[(me.data.role === "admin" ? "registrar" : me.data.aspireRole) as keyof typeof roleNames] : ""}{profile.data?.facultyName ? ` · ${profile.data.facultyName}` : ""}</p>
    </section>
    <section className="panel case-panel">
      <div className="panel-heading"><div><p className="eyebrow">SECURITY</p><h2>Change password</h2></div></div>
      <form onSubmit={submit} className="account-form">
        <label className="form-field"><span>Current password{forced ? " (the temporary password)" : ""}</span><input type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} required /></label>
        <label className="form-field"><span>New password</span><input type="password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} required minLength={10} /><small className="muted">At least 10 characters. Do not use your name or email.</small></label>
        <label className="form-field"><span>Confirm new password</span><input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required />{mismatch && <small className="form-error">The passwords do not match.</small>}</label>
        {change.error && <p className="form-error" role="alert">{change.error.message}</p>}
        <div className="form-actions"><Button type="submit" className="button-primary" disabled={change.isPending || !current || next.length < 10 || !confirm || mismatch}>{change.isPending ? "Saving…" : "Change password"}</Button></div>
      </form>
    </section>
  </AspireShell>;
}
