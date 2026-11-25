import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Bell, BookOpenCheck, ChevronLeft, ChevronRight, ChevronDown, ClipboardList,
  FileCheck2, LayoutDashboard, LogOut, Menu, Settings2, ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { goToLogin } from "@/const";
import { cn } from "@/lib/utils";

type AspireRole = "applicant" | "registrar" | "faculty_administrator";
const roleNames: Record<AspireRole, string> = {
  applicant: "Applicant",
  registrar: "Registrar",
  faculty_administrator: "Faculty administrator",
};

const navigation = [
  { href: "/", label: "Overview", icon: LayoutDashboard, staffOnly: false, registrarOnly: false, group: "WORKSPACE" },
  { href: "/applications", label: "Applications", icon: ClipboardList, staffOnly: false, registrarOnly: false, group: "WORKSPACE" },
  { href: "/programmes", label: "Programme catalogue", icon: BookOpenCheck, staffOnly: true, registrarOnly: false, group: "WORKSPACE" },
  { href: "/documents", label: "Document review", icon: FileCheck2, staffOnly: true, registrarOnly: false, group: "WORKSPACE" },
  { href: "/governance", label: "Governance", icon: ShieldCheck, staffOnly: true, registrarOnly: true, group: "ADMINISTRATION" },
  { href: "/account", label: "Account", icon: Settings2, staffOnly: false, registrarOnly: false, group: "ADMINISTRATION" },
] as const;

export function AspireShell({ children, title, eyebrow }: { children: React.ReactNode; title: string; eyebrow?: string }) {
  const [location, navigate] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const me = trpc.auth.me.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const logout = trpc.auth.logout.useMutation({ onSuccess: () => { void utils.auth.me.invalidate(); } });
  const user = me.data;
  const role: AspireRole = user?.role === "admin" ? "registrar" : user?.aspireRole === "registrar" || user?.aspireRole === "faculty_administrator" ? user.aspireRole : "applicant";
  const profile = trpc.aspire.profile.me.useQuery(undefined, { enabled: Boolean(user) && !user?.mustChangePassword });
  const staffQueue = trpc.aspire.staff.queue.useQuery(undefined, { enabled: Boolean(user && role !== "applicant"), refetchInterval: 60_000 });
  const alerts = trpc.aspire.applicant.notifications.useQuery(undefined, { enabled: Boolean(user), refetchInterval: 60_000 });
  const markRead = trpc.aspire.applicant.markNotificationRead.useMutation({ onSuccess: () => { void utils.aspire.applicant.notifications.invalidate(); } });
  const unread = alerts.data?.filter((item) => !item.readAt).length ?? 0;
  const pendingDocuments = staffQueue.data?.reduce((sum, row) => sum + row.pendingDocuments, 0) ?? 0;
  const isStaff = role !== "applicant";
  useEffect(() => {
    if (user?.mustChangePassword && location !== "/account") navigate("/account");
  }, [user?.mustChangePassword, location, navigate]);

  const items = navigation.filter((item) => (!item.staffOnly || isStaff) && (!item.registrarOnly || role === "registrar"));
  const groups = [...new Set(items.map((item) => item.group))];

  if (me.isLoading) {
    return <div className="session-state"><span className="loader-dot" />Checking your secure session</div>;
  }
  if (me.error || !user) {
    return (
      <main className="auth-screen">
        <div className="auth-brand"><div className="brand-mark"><span /><span /><i /></div><span>ASPIRE</span></div>
        <div className="auth-card">
          <p className="eyebrow">Uganda Martyrs University · Admissions</p>
          <h1>Clarity for applicants.<br /><em>Evidence for every decision.</em></h1>
          <p className="auth-copy">Sign in to continue. ASPIRE supports the admissions process; the admissions committee makes every final decision.</p>
          <Button className="button-primary auth-button" onClick={() => goToLogin()}>Sign in</Button>
          <a className="link-button" href="/login?mode=register">New applicant? Create an account</a>
          <div className="auth-note"><ShieldCheck size={16} /><span>Secure sign-in · Role-controlled workspace</span></div>
        </div>
        <div className="auth-foot">Uganda Martyrs University · Applicant Screening and Program Intelligence Recommendation Engine</div>
      </main>
    );
  }

  return (
    <div className="app-frame">
      <aside className={cn("side-rail", mobileOpen && "side-rail-open", railCollapsed && "side-rail-collapsed")}>
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /><span /><i /></div>
          <div className="brand-copy"><strong>ASPIRE</strong><small>Uganda Martyrs University</small></div>
          <button className="rail-collapse" aria-label={railCollapsed ? "Expand navigation" : "Collapse navigation"} onClick={() => setRailCollapsed((value) => !value)}>
            {railCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>
        {groups.map((group) => <div className="nav-group" key={group}>
          <div className="nav-section-label">{group}</div>
          <nav className="primary-nav" aria-label={`${group} navigation`}>
            {items.filter((item) => item.group === group).map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? location === "/" : location === href || location.startsWith(`${href}/`);
              return <Link key={href} href={href} title={label} className={cn("nav-link", active && "nav-link-active")} onClick={() => setMobileOpen(false)}>
                <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
                {href === "/documents" && pendingDocuments > 0 && <span className="nav-count">{pendingDocuments}</span>}
              </Link>;
            })}
          </nav>
        </div>)}
        <div className="rail-spacer" />
        <div className="rail-message"><div className="rail-message-icon"><ShieldCheck size={17} /></div><strong>Human decision, always</strong><p>The admissions committee makes every final decision.</p></div>
        <div className="rail-user">
          <div className="avatar-initials">{(user.name || user.email || "A").slice(0, 1).toUpperCase()}</div>
          <div className="rail-user-copy"><strong>{user.name || user.email || "Signed in"}</strong><small>{roleNames[role]}{profile.data?.facultyName ? ` · ${profile.data.facultyName}` : ""}</small></div>
          <button className="icon-button" aria-label="Sign out" onClick={() => logout.mutate()}><LogOut size={16} /></button>
        </div>
      </aside>
      {mobileOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <main className={cn("main-canvas", railCollapsed && "main-canvas-collapsed")}>
        <header className="topbar">
          <button className="mobile-menu icon-button" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={19} /></button>
          <div className="breadcrumb"><span>UMU ADMISSIONS</span><span className="breadcrumb-sep">/</span><strong>{eyebrow || title}</strong></div>
          <div className="topbar-right">
            <span className="intake-chip"><span className="status-pulse" />2026/27 intake</span>
            <div className="notification-anchor"><button className="icon-button notification-button" aria-label={`Notifications, ${unread} unread`} onClick={() => setNotificationsOpen((open) => !open)}><Bell size={17} />{unread > 0 && <i />}{unread > 0 && <span className="notification-count">{unread}</span>}</button>{notificationsOpen && <div className="notification-popover"><div className="notification-popover-heading"><strong>Notifications</strong><span>{unread} unread</span></div>{alerts.isLoading ? <p className="notification-empty">Loading…</p> : alerts.data?.length ? alerts.data.slice(0, 8).map((item) => <Link key={item.id} href={item.applicationId ? `/applications/${item.applicationId}` : location} className={`notification-item ${item.readAt ? "" : "notification-unread"}`} onClick={() => { markRead.mutate({ id: item.id }); setNotificationsOpen(false); }}><strong>{item.title}</strong><span>{item.message}</span><small>{new Date(item.createdAt).toLocaleString()}</small></Link>) : <p className="notification-empty">No notifications yet.</p>}</div>}</div>
            <div className="user-chip"><span className="avatar-initials avatar-small">{(user.name || user.email || "A").slice(0, 1).toUpperCase()}</span><span>{roleNames[role]}</span><ChevronDown size={14} /></div>
          </div>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div><p className="eyebrow">{eyebrow || (isStaff ? "Admissions operations" : "Applicant portal")}</p><h1>{title}</h1></div>
          </div>
          {children}
          <footer className="page-footer"><span>ASPIRE · Applicant Screening and Program Intelligence Recommendation Engine</span><span>Decision support only · Admissions committee decides</span></footer>
        </div>
      </main>
    </div>
  );
}

export function roleLabel(role: string) {
  return roleNames[role as AspireRole] ?? role;
}
