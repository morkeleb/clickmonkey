import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@schema": fileURLToPath(new URL("../src/schema", import.meta.url)),
      "@ui": fileURLToPath(new URL("../src/ui", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:4174",
      "/files": "http://127.0.0.1:4174",
    },
  },
});
