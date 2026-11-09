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
  // Only tests need it (they empty their tables); a production host has no test database.
  TEST_DATABASE_URL: postgresUrl.optional(),
  // Path to the CA certificate that signs the production database's TLS certificate. Required in
  // production so the connection always verifies the server (ADR 0007). Null when unset.
  DATABASE_CA_PATH: z
    .string()
    .optional()
    .transform((value) => value || null),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().min(1),
  CORS_ORIGIN: origins,
  // Set by the deploy to the git commit being served; shown by GET /api/health. Null when unset.
  COMMIT_SHA: z
    .string()
    .optional()
    .transform((value) => value || null),
  // Lets the seed run against a non-local database (helpers/seedGuard.js). Off unless set.
  SEED_ALLOW_REMOTE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  // Password for the seeded demo accounts. Null means the public local demo password is used,
  // which the seeders refuse on a remote database (helpers/seedGuard.js).
  SEED_PASSWORD: z
    .string()
    .optional()
    .transform((value) => value || null),
}).superRefine((value, ctx) => {
  if (value.NODE_ENV === "test" && !value.TEST_DATABASE_URL) {
    ctx.addIssue({
      code: "custom",
      path: ["TEST_DATABASE_URL"],
      message: "is required when NODE_ENV is test",
    });
  }
  if (value.NODE_ENV === "production" && !value.DATABASE_CA_PATH) {
    ctx.addIssue({
      code: "custom",
      path: ["DATABASE_CA_PATH"],
      message: "is required when NODE_ENV is production",
    });
  }
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
