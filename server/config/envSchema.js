const { z } = require("zod");

const postgresUrl = z
  .string()
  .regex(/^postgres(ql)?:\/\//, "must start with postgres:// or postgresql://");

// Comma separated list of exact origins. A wildcard is refused on purpose
// (docs/05_Technical_Design.md: CORS with a list, no wildcard).
const origins = z
  .string()
  .transform((value) => value.split(",").map((item) => item.trim()))
  .pipe(z.array(z.url()).min(1));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  PORT: z.coerce.number().int().min(1).max(65535),
  DATABASE_URL: postgresUrl,
  TEST_DATABASE_URL: postgresUrl,
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().min(1),
  CORS_ORIGIN: origins,
  // Lets the seed run against a non-local database (helpers/seedGuard.js). Off unless set.
  SEED_ALLOW_REMOTE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

// Pure on purpose: takes any object, so tests do not touch process.env.
// The message names the variables and the rule, never the values, because
// values include secrets.
function parseEnv(source) {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;

  const lines = result.error.issues.map(
    (issue) => `- ${issue.path.join(".")}: ${issue.message}`,
  );
  throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
}

module.exports = { parseEnv };
