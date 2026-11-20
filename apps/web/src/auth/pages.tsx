import { Eye, EyeOff, MailCheck } from "lucide-react";
import { useEffect, useId, useRef, useState, type ComponentProps, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { ApiError, auth } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { friendlyError } from "@/lib/errors";
import { safeNext, useAuth } from "./auth";

export function authMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return "Too many attempts. Wait a few minutes, then try again.";
    if (err.status >= 500) return friendlyError(err);
    return err.message;
  }
  return friendlyError(err);
}

/** Reads #token=… once, then strips it so the token is not left in history. */
function useHashToken(): string {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "");
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, []);
  return token;
}

function Heading({ kicker, title, children }: { kicker: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-9">
      <p className="font-mono text-[0.625rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">{kicker}</p>
      <h1 className="mt-3 font-serif text-[2.5rem] leading-[1.05] tracking-[-0.035em]">{title}</h1>
      {children && <p className="mt-3 text-[0.875rem] leading-relaxed text-muted-foreground">{children}</p>}
    </header>
  );
}

export function Alert({ tone = "error", children }: { tone?: "error" | "info"; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error"
          ? "rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-[0.8125rem] leading-snug text-destructive"
          : "rounded-xl border border-accent/25 bg-accent-soft px-4 py-3 text-[0.8125rem] leading-snug text-foreground"
      }
    >
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  ...props
}: { label: string; hint?: ReactNode } & ComponentProps<typeof Input>) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-[0.75rem] font-semibold">
        {label}
      </Label>
      <Input id={id} className="h-11 rounded-xl bg-card px-3.5" aria-describedby={hint ? `${id}-hint` : undefined} {...props} />
      {hint && (
        <p id={`${id}-hint`} className="text-[0.6875rem] text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  minLength,
  showCount,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
  showCount?: boolean;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const { config } = useAuth();
  const short = showCount && value.length > 0 && value.length < config.passwordMin;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label htmlFor={id} className="text-[0.75rem] font-semibold">
          {label}
        </Label>
        {showCount && (
          <span className={`font-mono text-[0.625rem] ${short ? "text-muted-foreground" : "text-success"}`} aria-hidden>
            {value.length}/{config.passwordMin}
          </span>
        )}
      </div>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          minLength={minLength}
          maxLength={config.passwordMax}
          required
          className="h-11 rounded-xl bg-card pl-3.5 pr-11"
          aria-describedby={showCount ? `${id}-hint` : undefined}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-xl text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      {showCount && (
        <p id={`${id}-hint`} className="text-[0.6875rem] text-muted-foreground">
          At least {config.passwordMin} characters. A short sentence you'll remember works well.
        </p>
      )}
    </div>
  );
}

function GoogleButton({ next }: { next: string }) {
  const { config } = useAuth();
  const reasonId = useId();
  const mark = (
    <svg viewBox="0 0 18 18" aria-hidden className="size-4">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.33-1.58-5.04-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.96 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.28-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.95l3 2.33C4.67 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
  if (!config.googleEnabled) {
    return (
      <div className="space-y-2">
        <Button type="button" variant="outline" size="lg" className="h-11 w-full rounded-xl" disabled aria-describedby={reasonId}>
          {mark}
          Continue with Google
        </Button>
        <p id={reasonId} className="text-center text-[0.6875rem] text-muted-foreground">
          Google sign-in isn't set up on this server yet.
        </p>
      </div>
    );
  }
  return (
    <Button asChild variant="outline" size="lg" className="h-11 w-full rounded-xl">
      <a href={auth.googleStart(next)}>
        {mark}
        Continue with Google
      </a>
    </Button>
  );
}

function Divider() {
  return (
    <div className="my-7 flex items-center gap-3 text-[0.6875rem] text-muted-foreground" aria-hidden>
      <span className="h-px flex-1 bg-border" />
      or with email
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function Submit({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <Button type="submit" size="lg" className="h-11 w-full rounded-xl" disabled={busy} aria-busy={busy}>
      {children}
    </Button>
  );
}

function ResendLink({ email }: { email: string }) {
  const [wait, setWait] = useState(0);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);
  return (
    <Button
      type="button"
      variant="link"
      className="h-auto p-0 text-[0.8125rem]"
      disabled={wait > 0 || !email}
      onClick={() => {
        void auth.resend(email).finally(() => {
          setSent(true);
          setWait(30);
        });
      }}
    >
      {wait > 0 ? `Sent. Send again in ${wait}s` : sent ? "Send another link" : "Send a new link"}
    </Button>
  );
}

const GOOGLE_ERRORS: Record<string, string> = {
  google: "Google sign-in didn't finish. Try again.",
  google_unverified: "Google hasn't verified that email address, so it can't be used to sign in.",
  google_disabled: "Google sign-in isn't set up on this server yet.",
};

export function LoginPage() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const notice = (location.state as { notice?: string } | null)?.notice;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; unverified?: boolean } | null>(() => {
    const code = params.get("error");
    return code && GOOGLE_ERRORS[code] ? { message: GOOGLE_ERRORS[code] } : null;
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setUser(await auth.login(email, password));
      navigate(next, { replace: true });
    } catch (err) {
      setError({ message: authMessage(err), unverified: err instanceof ApiError && err.code === "email_unverified" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Heading kicker="Sign in" title="Welcome back.">
        Pick up the session where you left it.
      </Heading>
      <GoogleButton next={next} />
      <Divider />
      <form onSubmit={submit} className="space-y-5">
        {notice && <Alert tone="info">{notice}</Alert>}
        {error && (
          <Alert>
            <p>{error.message}</p>
            {error.unverified && (
              <div className="mt-1.5">
                <ResendLink email={email} />
              </div>
            )}
          </Alert>
        )}
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <div className="space-y-2">
          <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
          <div className="text-right">
            <Link to="/forgot" className="text-[0.75rem] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
              Forgot password?
            </Link>
          </div>
        </div>
        <Submit busy={busy}>{busy ? "Signing in…" : "Sign in"}</Submit>
      </form>
      <p className="mt-8 text-[0.8125rem] text-muted-foreground">
        New to tidyai?{" "}
        <Link to={`/signup${params.get("next") ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-foreground underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}

function CheckInbox({ email, purpose }: { email: string; purpose: "verify" | "reset" }) {
  return (
    <>
      <div className="mb-6 grid size-11 place-items-center rounded-2xl bg-accent-soft text-accent">
        <MailCheck className="size-5" />
      </div>
      <Heading kicker={purpose === "verify" ? "Confirm your email" : "Reset link sent"} title="Check your inbox.">
        {purpose === "verify" ? (
          <>
            We sent a link to <strong className="font-semibold text-foreground">{email}</strong>. Open it to finish
            creating your account. It works for 24 hours.
          </>
        ) : (
          <>
            If <strong className="font-semibold text-foreground">{email}</strong> has an account, a reset link is on its
            way. It works for 30 minutes.
          </>
        )}
      </Heading>
      {import.meta.env.DEV && (
        <Alert tone="info">No mail server configured? The link is printed in the API log.</Alert>
      )}
      <div className="mt-6 flex items-center justify-between text-[0.8125rem]">
        {purpose === "verify" ? <ResendLink email={email} /> : <span />}
        <Link to="/login" className="font-semibold text-foreground underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </div>
    </>
  );
}

export function SignupPage() {
  const { config } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < config.passwordMin) {
      setError(`Use at least ${config.passwordMin} characters.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await auth.signup(email, password, name.trim());
      setSentTo(email.trim());
    } catch (err) {
      setError(authMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) return <CheckInbox email={sentTo} purpose="verify" />;
  return (
    <>
      <Heading kicker="Create account" title="Start a subject.">
        Chat through a topic and tidyai keeps the notes as you go.
      </Heading>
      <GoogleButton next={next} />
      <Divider />
      <form onSubmit={submit} className="space-y-5">
        {error && <Alert>{error}</Alert>}
        <Field label="Name" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} hint="Optional. Shown on your profile." />
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="new-password" minLength={config.passwordMin} showCount />
        <Submit busy={busy}>{busy ? "Creating account…" : "Create account"}</Submit>
      </form>
      <p className="mt-8 text-[0.8125rem] text-muted-foreground">
        Already have an account?{" "}
        <Link to="/login" className="font-semibold text-foreground underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await auth.forgot(email);
      setSentTo(email.trim());
    } catch (err) {
      setError(authMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) return <CheckInbox email={sentTo} purpose="reset" />;
  return (
    <>
      <Heading kicker="Forgot password" title="Reset your password.">
        Enter your email and we'll send a link to choose a new one.
      </Heading>
      <form onSubmit={submit} className="space-y-5">
        {error && <Alert>{error}</Alert>}
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Submit busy={busy}>{busy ? "Sending…" : "Send reset link"}</Submit>
      </form>
      <p className="mt-8 text-[0.8125rem] text-muted-foreground">
        Remembered it?{" "}
        <Link to="/login" className="font-semibold text-foreground underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}

function BadLink({ what }: { what: string }) {
  return (
    <>
      <Heading kicker={what} title="This link has expired.">
        Links work once and only for a short time. Request a new one and use the latest email.
      </Heading>
      <div className="flex gap-5 text-[0.8125rem]">
        <Link to="/forgot" className="font-semibold text-foreground underline-offset-4 hover:underline">
          Reset password
        </Link>
        <Link to="/login" className="font-semibold text-foreground underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </div>
    </>
  );
}

export function ResetPage() {
  const token = useHashToken();
  const navigate = useNavigate();
  const { config } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(!token);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < config.passwordMin) return setError(`Use at least ${config.passwordMin} characters.`);
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    setError("");
    try {
      await auth.reset(token, password);
      navigate("/login", {
        replace: true,
        state: { notice: "Password changed. Sign in with the new one. Every other device was signed out." },
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === "bad_token") setExpired(true);
      else setError(authMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (expired) return <BadLink what="Reset password" />;
  return (
    <>
      <Heading kicker="Reset password" title="Choose a new password.">
        You'll sign in again afterwards. Any other device signed in to this account will be signed out.
      </Heading>
      <form onSubmit={submit} className="space-y-5">
        {error && <Alert>{error}</Alert>}
        <PasswordField label="New password" value={password} onChange={setPassword} autoComplete="new-password" minLength={config.passwordMin} showCount />
        <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <Submit busy={busy}>{busy ? "Saving…" : "Save new password"}</Submit>
      </form>
    </>
  );
}

export function VerifyPage() {
  const token = useHashToken();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const started = useRef(false);
  const [failed, setFailed] = useState(!token);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    auth.verify(token).then(
      (user) => {
        setUser(user);
        navigate("/app", { replace: true });
      },
      () => setFailed(true),
    );
  }, [token, setUser, navigate]);

  if (failed) {
    return (
      <>
        <Heading kicker="Confirm email" title="This link has expired.">
          Sign in with your email and password and we'll offer to send a fresh link.
        </Heading>
        <Link to="/login" className="text-[0.8125rem] font-semibold text-foreground underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </>
    );
  }
  return (
    <Heading kicker="Confirm email" title="Confirming…">
      One moment while we check your link.
    </Heading>
  );
}
