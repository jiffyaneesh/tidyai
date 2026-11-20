import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

const API_TARGET = process.env.TIDYAI_API_TARGET ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
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
