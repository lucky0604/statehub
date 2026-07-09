import { z } from "zod";

/**
 * StateHub runtime environment schema.
 *
 * All env access goes through `parseEnv()` so missing/invalid values fail
 * loudly at startup, not in the middle of a request.
 *
 * Local dev requires NO env vars — every field has a permissive default.
 * Production deployments override via platform env (Cloudflare vars, etc.).
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // D1 binding name as configured in wrangler.toml. Local dev uses "statehub-local".
  D1_BINDING_NAME: z.string().default("statehub-local"),

  // Optional. Set when running against remote D1 in preview/staging.
  D1_REMOTE_DATABASE_ID: z.string().optional(),

  // Auth. Lands pre-P02. Modeled now so services can read the boundary.
  AUTH_MODE: z
    .enum(["disabled", "token", "oauth"])
    .default("disabled"),

  // AI provider keys. All optional at P00; consumed starting P05.
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  GLM_API_KEY: z.string().optional(),

  // App URL for canonical links, OAuth redirects. Defaults to local dev.
  APP_URL: z.string().url().default("http://localhost:3000"),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(input: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}

/**
 * Lazy env accessor. Parses once, caches. Safe to import from any module.
 */
let _env: Env | null = null;
export function env(): Env {
  if (_env === null) _env = parseEnv();
  return _env;
}
