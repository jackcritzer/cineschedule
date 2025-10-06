import { defineConfig } from "vitest/config";
import dotenv from "dotenv";

// Load test env vars
dotenv.config({ path: ".env.test" });

export default defineConfig({
	test: {
		environment: "node",
		globals: true,
		restoreMocks: true,
		mockReset: true,
		clearMocks: true,
        include: ["tests/**/*.test.ts"],
	},
});