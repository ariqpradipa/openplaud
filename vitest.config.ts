import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
    resolve: {
        alias: {
            "@": resolve(__dirname, "./src"),
        },
    },
    test: {
        environment: "node",
        env: {
            NEXT_PHASE: "phase-production-build",
            DATABASE_URL: "postgres://test",
            BETTER_AUTH_SECRET: "test-secret-32-chars-long!!",
            ENCRYPTION_KEY:
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            APP_URL: "http://localhost:3000",
        },
    },
});
