import { useEffect, useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

export default function LoginPage() {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const [mode, setMode] = useState<"signin" | "register">(new URLSearchParams(window.location.search).get("mode") === "register" ? "register" : "signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const done = (user: NonNullable<typeof me.data>) => {
    utils.auth.me.setData(undefined, user);
    navigate(user.mustChangePassword ? "/account" : "/");
  };
  const login = trpc.auth.login.useMutation({ onSuccess: done });
  const register = trpc.auth.register.useMutation({ onSuccess: done });
  useEffect(() => { if (me.data) navigate(me.data.mustChangePassword ? "/account" : "/"); }, [me.data, navigate]);

  const busy = login.isPending || register.isPending;
  const error = (mode === "signin" ? login.error : register.error)?.message;
  const mismatch = mode === "register" && confirm.length > 0 && confirm !== password;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === "signin") login.mutate({ email, password });
    else if (!mismatch) register.mutate({ name, email, password });
  };

  return <main className="auth-screen">
    <div className="auth-brand"><div className="brand-mark"><span /><span /><i /></div><span>ASPIRE</span></div>
    <form className="auth-card auth-form" onSubmit={submit}>
      <p className="eyebrow">Admissions decision support</p>
      <h1>{mode === "signin" ? "Sign in" : "Create an applicant account"}</h1>
      <p className="auth-copy">{mode === "signin" ? "Use the email and password for your ASPIRE account. Staff accounts are created by the registrar." : "For applicants. You will choose your programmes after you sign in."}</p>
      {mode === "register" && <label className="form-field"><span>Full name</span><input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} /></label>}
      <label className="form-field"><span>Email</span><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
      <label className="form-field"><span>Password</span><input type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} required />
        {mode === "register" && <small className="muted">At least 10 characters. Do not use your name or email.</small>}</label>
      {mode === "register" && <label className="form-field"><span>Confirm password</span><input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
        {mismatch && <small className="form-error">The passwords do not match.</small>}</label>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <Button type="submit" className="button-primary auth-button" disabled={busy || !email || !password || (mode === "register" && (name.trim().length < 2 || mismatch || !confirm))}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}</Button>
      <button type="button" className="link-button" onClick={() => { setMode(mode === "signin" ? "register" : "signin"); login.reset(); register.reset(); }}>
        {mode === "signin" ? "New applicant? Create an account" : "Already have an account? Sign in"}
      </button>
      <div className="auth-note"><ShieldCheck size={16} /><span>Secure sign-in · Role-controlled workspace</span></div>
    </form>
    <div className="auth-foot">Uganda Martyrs University · Admissions decision support</div>
  </main>;
}
