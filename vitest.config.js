import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
        },
    },
    test: {
        globals: true,
        environment: "node",
        setupFiles: ["./tests/setup.ts"],
        include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
        env: {
            VITE_API_URL: "http://localhost:8000",
        },
    },
});
