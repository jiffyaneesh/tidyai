import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const API_TARGET = process.env.TIDYAI_API_TARGET ?? "http://127.0.0.1:8000";

const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
};

// Production page policy. Whatever serves dist/ in hosted mode must send the same
// header (docs/research/15-security-pass.md). Dev drops script-src for HMR's inline code.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const DEV_CSP = "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  preview: {
    port: 4173,
    headers: { ...BASE_HEADERS, "Content-Security-Policy": CSP },
  },
  server: {
    port: 5173,
    headers: { ...BASE_HEADERS, "Content-Security-Policy": DEV_CSP },
    // Same origin as the page, so the session cookie is first-party and there is no CORS.
    proxy: {
      "/api": {
        target: API_TARGET,
        rewrite: (path) => path.replace(/^\/api/, ""),
        xfwd: true,
      },
    },
  },
});
