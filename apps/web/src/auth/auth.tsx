import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { ApiError, auth, UNAUTHORIZED_EVENT, type AuthConfig, type User } from "@/api";

type Status = "loading" | "signed-out" | "signed-in" | "offline";

type AuthState = {
  status: Status;
  user: User | null;
  config: AuthConfig;
  setUser: (user: User | null) => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const DEFAULT_CONFIG: AuthConfig = { googleEnabled: false, passwordMin: 15, passwordMax: 128 };
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUserState] = useState<User | null>(null);
  const [config, setConfig] = useState<AuthConfig>(DEFAULT_CONFIG);

  const setUser = useCallback((next: User | null) => {
    setUserState(next);
    setStatus(next ? "signed-in" : "signed-out");
  }, []);

  const refresh = useCallback(async () => {
    try {
      setUser(await auth.me());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setUser(null);
      else setStatus("offline");
    }
  }, [setUser]);

  useEffect(() => {
    void refresh();
    auth.config().then(setConfig, () => undefined);
    const onUnauthorized = () => setUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [refresh, setUser]);

  const signOut = useCallback(async () => {
    try {
      await auth.logout();
    } finally {
      setUser(null);
    }
  }, [setUser]);

  const value = useMemo(
    () => ({ status, user, config, setUser, refresh, signOut }),
    [status, user, config, setUser, refresh, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth outside AuthProvider");
  return value;
}

/** Same-origin path only. Anything else falls back to /app. Mirrors safe_next on the API. */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/app";
  if (/[\u0000-\u001f]/.test(raw)) return "/app";
  return raw;
}

function Splash({ offline, onRetry }: { offline?: boolean; onRetry?: () => void }) {
  return (
    <div className="grid h-full place-items-center bg-background px-6 text-center" aria-busy={!offline}>
      {offline ? (
        <div className="max-w-sm space-y-3">
          <p className="font-serif text-2xl tracking-tight">Can't reach tidyai</p>
          <p className="text-sm text-muted-foreground">
            The API isn't answering. Start it on port 8000, then retry.
          </p>
          <button type="button" className="text-sm font-semibold text-accent underline-offset-4 hover:underline" onClick={onRetry}>
            Retry
          </button>
        </div>
      ) : (
        <span className="wordmark-dot animate-pulse" aria-label="Loading" />
      )}
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, refresh } = useAuth();
  const location = useLocation();
  if (status === "loading") return <Splash />;
  if (status === "offline") return <Splash offline onRetry={() => void refresh()} />;
  if (status === "signed-out") {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}

export function PublicOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <Splash />;
  if (status === "signed-in") {
    const next = new URLSearchParams(location.search).get("next");
    return <Navigate to={safeNext(next)} replace />;
  }
  return <>{children}</>;
}
