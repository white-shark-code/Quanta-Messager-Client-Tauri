import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
    define: {
        "import.meta.env.VITE_API_URL": JSON.stringify(process.env.VITE_API_URL ?? "http://localhost:8000"),
    },
    clearScreen: false,
    server: {
        port: 1420,
        strictPort: true,
        host: "0.0.0.0",
        watch: {
            ignored: ["**/src-tauri/**"],
        },
    },
    build: {
        target: "esnext",
        outDir: "dist",
        sourcemap: true,
        chunkSizeWarningLimit: 1500,
    },
    optimizeDeps: {
        exclude: [
            "@tauri-apps/api",
            "@tauri-apps/plugin-fs",
            "@tauri-apps/plugin-dialog",
            "@tauri-apps/plugin-notification",
            "@tauri-apps/plugin-deep-link",
            "@tauri-apps/plugin-stronghold",
            "@tauri-apps/plugin-store",
            "openpgp",
        ],
    },
    envPrefix: "VITE_",
});
