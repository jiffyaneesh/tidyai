import { ArrowLeft, KeyRound, Monitor, Moon, Sun } from "lucide-react";
import { startTransition, useCallback, useEffect, useState, ViewTransition, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import { account, ApiError, auth, type SessionInfo } from "@/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/sonner";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useAuth } from "../auth/auth";
import { Alert, authMessage, Field, PasswordField } from "../auth/pages";

function initial(name: string, email: string) {
  return (name || email || "?").trim().slice(0, 1).toUpperCase();
}

export function AccountLayout({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { theme } = useTheme();
  const location = useLocation();
  if (!user) return null;
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn(
      "relative pb-3 text-[0.8125rem] font-semibold transition-colors",
      isActive
        ? "text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-accent"
        : "text-muted-foreground hover:text-foreground",
    );
  return (
    <div className="h-full overflow-y-auto bg-background">
      <Toaster theme={theme} />
      <div className="mx-auto w-full max-w-[880px] px-5 pb-24 pt-5 sm:px-8">
        <div className="mb-5 flex items-center justify-between">
          <Link
            to="/app"
            className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-[0.75rem] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Back to study
          </Link>
          <span className="flex items-center gap-2 text-[0.875rem] font-bold tracking-[-0.03em]">
            <span className="wordmark-dot" />
            tidyai
          </span>
        </div>

        <section className="relative h-44 overflow-hidden rounded-[28px] sm:h-52" aria-hidden>
          <img src="/art/haze.webp" alt="" className="auth-art-img absolute inset-0 size-full object-cover" />
        </section>
        <div className="relative z-10 -mt-12 flex flex-col items-start gap-3 px-4 sm:-mt-10 sm:flex-row sm:items-end sm:gap-5 sm:px-8">
          <span className="grid size-24 shrink-0 place-items-center rounded-full border-[5px] border-background bg-accent font-serif text-[2.5rem] text-accent-foreground shadow-soft sm:size-28">
            {initial(user.displayName, user.email)}
          </span>
          <div className="min-w-0 max-w-full sm:pb-1">
            <h1 className="truncate font-serif text-[2rem] leading-none tracking-[-0.035em]">
              {user.displayName || "Your account"}
            </h1>
            <p className="mt-2 truncate font-mono text-[0.6875rem] text-muted-foreground">{user.email}</p>
          </div>
        </div>

        <nav className="mt-9 flex gap-7 border-b border-border px-1" aria-label="Account">
          <NavLink to="/profile" className={tab}>
            Profile
          </NavLink>
          <NavLink to="/settings" className={tab}>
            Settings
          </NavLink>
        </nav>

        <ViewTransition key={location.pathname} enter="form-in" exit="form-out" default="none">
          <main className="divide-y divide-border">{children}</main>
        </ViewTransition>
      </div>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-5 py-10 md:grid-cols-[220px_minmax(0,1fr)] md:gap-12">
      <div>
        <h2 className="text-[0.875rem] font-semibold tracking-[-0.01em]">{title}</h2>
        {description && <p className="mt-1.5 text-[0.75rem] leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 text-[0.8125rem]">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium">{children}</span>
    </div>
  );
}

function Pill({ tone, children }: { tone: "ok" | "off"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-full px-2.5 py-0.5 text-[0.6875rem] font-semibold",
        tone === "ok" ? "bg-accent-soft text-accent" : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

export function ProfilePage() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.displayName ?? "");
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const changed = name.trim() !== user.displayName;

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      setUser(await account.update(name.trim()));
      toast.success("Name saved.");
    } catch (err) {
      toast.error(authMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const since = new Date(user.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  return (
    <>
      <Section title="Name" description="Shown on your profile and in the workspace menu.">
        <form onSubmit={save} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field label="Display name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </div>
          <Button type="submit" size="lg" className="h-11 rounded-xl" disabled={!changed || busy}>
            {busy ? "Saving…" : "Save name"}
          </Button>
        </form>
      </Section>
      <Section title="Email" description="Used to sign in and to recover your account. Changing it isn't supported yet.">
        <div className="divide-y divide-border rounded-2xl border border-border px-4">
          <Row label="Address">{user.email}</Row>
          <Row label="Status">
            <Pill tone={user.emailVerified ? "ok" : "off"}>{user.emailVerified ? "Verified" : "Not verified"}</Pill>
          </Row>
        </div>
      </Section>
      <Section title="Sign-in methods" description="Ways you can get into this account.">
        <div className="divide-y divide-border rounded-2xl border border-border px-4">
          <Row label="Password">
            {user.hasPassword ? (
              <Pill tone="ok">Set</Pill>
            ) : (
              <Link to="/settings" className="text-accent underline-offset-4 hover:underline">
                Set a password
              </Link>
            )}
          </Row>
          <Row label="Google">
            <Pill tone={user.providers.includes("google") ? "ok" : "off"}>
              {user.providers.includes("google") ? "Linked" : "Not linked"}
            </Pill>
          </Row>
        </div>
      </Section>
      <Section title="Member since">
        <p className="text-[0.8125rem] font-medium">{since}</p>
      </Section>
    </>
  );
}

function describeAgent(ua = ""): { label: string; mobile: boolean } {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /iPhone|iPad/.test(ua)
      ? "iOS"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Android/.test(ua)
          ? "Android"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return { label: os ? `${browser} on ${os}` : browser, mobile: /Mobile|Android|iPhone/.test(ua) };
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
function ago(iso: string): string {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (Math.abs(minutes) < 60) return RELATIVE.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return RELATIVE.format(hours, "hour");
  return RELATIVE.format(Math.round(hours / 24), "day");
}

function PasswordSection() {
  const { user, refresh, config } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [formKey, setFormKey] = useState(0);
  if (!user) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (next.length < config.passwordMin) return setError(`Use at least ${config.passwordMin} characters.`);
    if (next !== confirm) return setError("The two new passwords don't match.");
    setBusy(true);
    setError("");
    try {
      await account.changePassword(current, next);
      toast.success(user?.hasPassword ? "Password changed." : "Password set.", {
        description: "Every other device was signed out.",
      });
      setCurrent("");
      setNext("");
      setConfirm("");
      setFormKey((k) => k + 1);
      await refresh();
    } catch (err) {
      setError(authMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title={user.hasPassword ? "Password" : "Set a password"}
      description={
        user.hasPassword
          ? "Changing it signs out every other device."
          : "You sign in with Google today. A password adds a second way in."
      }
    >
      <form key={formKey} onSubmit={submit} className="space-y-5">
        {error && <Alert>{error}</Alert>}
        {user.hasPassword && (
          <PasswordField label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
        )}
        <PasswordField label="New password" value={next} onChange={setNext} autoComplete="new-password" showCount />
        <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <Button type="submit" size="lg" className="h-11 rounded-xl" disabled={busy || !next}>
          {busy ? "Saving…" : user.hasPassword ? "Change password" : "Set password"}
        </Button>
      </form>
    </Section>
  );
}

function SessionsSection() {
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    account.sessions().then(
      (rows) => {
        setSessions(rows);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, []);
  useEffect(load, [load]);
  const others = sessions?.filter((s) => !s.current).length ?? 0;

  return (
    <Section title="Where you're signed in" description="Sessions end after 7 days without use, or 30 days at most.">
      {failed && <Alert>Couldn't load your sessions. Reload the page to try again.</Alert>}
      {!sessions && !failed && <p className="text-[0.8125rem] text-muted-foreground">Loading sessions…</p>}
      {sessions && (
        <>
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {sessions.map((session) => {
              const agent = describeAgent(session.userAgent);
              return (
                <li key={session.id} className="flex items-center gap-4 px-4 py-3.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
                    <Monitor className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-[0.8125rem] font-semibold">
                      {agent.label}
                      {session.current && <Pill tone="ok">This device</Pill>}
                    </p>
                    <p className="truncate font-mono text-[0.6875rem] text-muted-foreground">
                      {session.ip || "unknown IP"} · active {ago(session.lastSeenAt)}
                    </p>
                  </div>
                  {!session.current && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="rounded-lg"
                      aria-label={`Sign out ${agent.label}, last active ${ago(session.lastSeenAt)}`}
                      onClick={() =>
                        void account.revokeSession(session.id).then(
                          () => {
                            toast.success("Signed out that device.");
                            load();
                          },
                          (err) => toast.error(authMessage(err)),
                        )
                      }
                    >
                      Sign out
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-lg"
              disabled={others === 0}
              aria-describedby="others-reason"
              onClick={() =>
                void account.revokeOthers().then(
                  ({ revoked }) => {
                    toast.success(revoked === 1 ? "Signed out 1 other device." : `Signed out ${revoked} other devices.`);
                    load();
                  },
                  (err) => toast.error(authMessage(err)),
                )
              }
            >
              Sign out all other devices
            </Button>
            {others === 0 && (
              <span id="others-reason" className="text-[0.6875rem] text-muted-foreground">
                No other devices are signed in.
              </span>
            )}
          </div>
        </>
      )}
    </Section>
  );
}

function AppearanceSection() {
  const { theme, toggle } = useTheme();
  const options = [
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
  ] as const;
  return (
    <Section title="Appearance" description="Saved on this device.">
      <div className="inline-flex rounded-xl border border-border p-1" role="radiogroup" aria-label="Theme">
        {options.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={theme === id}
            onClick={() => theme !== id && toggle()}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[0.8125rem] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              theme === id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>
    </Section>
  );
}

function DeleteAccount() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; reauth?: boolean } | null>(null);
  if (!user) return null;
  const matches = confirmEmail.trim().toLowerCase() === user.email;

  async function remove(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await account.remove(confirmEmail.trim(), password);
      // One transition, so the auth guard sees the new route and the signed-out state together.
      startTransition(() => {
        setUser(null);
        navigate("/login", { replace: true, state: { notice: "Your account and its notes were deleted." } });
      });
    } catch (err) {
      setError({ message: authMessage(err), reauth: err instanceof ApiError && err.code === "reauth_required" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Delete account"
      description="Removes your account, every subject, chat, and note. This can't be undone."
    >
      <div className="rounded-2xl border border-destructive/25 bg-destructive/5 p-5">
        <p className="text-[0.8125rem] leading-relaxed">
          Provider keys saved in this browser stay here until you remove them from Provider keys.
        </p>
        <Button type="button" variant="destructive" size="sm" className="mt-4 rounded-lg" onClick={() => setOpen(true)}>
          Delete account…
        </Button>
      </div>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-[1.5rem] font-normal tracking-[-0.03em]">Delete your account?</DialogTitle>
            <DialogDescription>
              Every subject, chat, and note in this account is deleted for good. Type your email to confirm.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={remove} className="space-y-4">
            {error && (
              <Alert>
                <p>{error.message}</p>
                {error.reauth && (
                  <a href={auth.googleStart("/settings")} className="mt-1.5 inline-block font-semibold underline underline-offset-4">
                    Sign in with Google again
                  </a>
                )}
              </Alert>
            )}
            <Field label={`Type ${user.email}`} autoComplete="off" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} />
            {user.hasPassword && (
              <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                Keep account
              </Button>
              <Button type="submit" variant="destructive" disabled={!matches || busy || (user.hasPassword && !password)}>
                {busy ? "Deleting…" : "Delete account"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

export function SettingsPage() {
  const navigate = useNavigate();
  return (
    <>
      <PasswordSection />
      <SessionsSection />
      <Section title="Provider keys" description="Your model keys are encrypted in this browser and sent only with each request.">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-11 rounded-xl"
          onClick={() => navigate("/app", { state: { openProviders: true } })}
        >
          <KeyRound />
          Manage provider keys
        </Button>
      </Section>
      <AppearanceSection />
      <DeleteAccount />
    </>
  );
}
