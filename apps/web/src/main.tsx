import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { App } from "./App";
import { AuthProvider, PublicOnly, RequireAuth, useAuth } from "./auth/auth";
import { AuthLayout, PageTransition } from "./auth/AuthLayout";
import { ForgotPage, LoginPage, ResetPage, SignupPage, VerifyPage } from "./auth/pages";
import "./globals.css";

function Home() {
  const { status } = useAuth();
  if (status === "loading") return null;
  return <Navigate to={status === "signed-in" ? "/app" : "/login"} replace />;
}

function Auth({ children, publicOnly = true }: { children: ReactNode; publicOnly?: boolean }) {
  const page = (
    <PageTransition>
      <AuthLayout>{children}</AuthLayout>
    </PageTransition>
  );
  return publicOnly ? <PublicOnly>{page}</PublicOnly> : page;
}

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Auth><LoginPage /></Auth>} />
          <Route path="/signup" element={<Auth><SignupPage /></Auth>} />
          <Route path="/forgot" element={<Auth><ForgotPage /></Auth>} />
          <Route path="/reset" element={<Auth publicOnly={false}><ResetPage /></Auth>} />
          <Route path="/verify" element={<Auth publicOnly={false}><VerifyPage /></Auth>} />
          <Route
            path="/app"
            element={
              <RequireAuth>
                <PageTransition>
                  <App />
                </PageTransition>
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
