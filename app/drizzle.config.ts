import { defineConfig } from "drizzle-kit";
import { env } from "./src/env";

// Generate with `pnpm db:generate` and apply with `pnpm db:migrate`, which load .env first.
// Never `drizzle-kit push`.
export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/db/auth-schema.ts", "./src/features/*/lib/schema.ts"],
  out: "./src/db/migrations",
  dbCredentials: { url: env.DATABASE_URL },
});
