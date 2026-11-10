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

// An optional email of a demo account: trimmed and lowercase (the login matches lowercase), null when
// unset or empty. Whether it is required and valid is judged below, together with DEMO_MODE.
const optionalEmail = z
  .string()
  .optional()
  .transform((value) => value?.trim().toLowerCase() || null);

const DEMO_EMAIL_KEYS = ["DEMO_OWNER_EMAIL", "DEMO_ADMIN_EMAIL", "DEMO_VIEWER_EMAIL"];

// Demo mode (BL31): one-click access to three shared accounts. The list of accounts lives here, not in
// the database, and has no platform admin. Only when DEMO_MODE is on must the three be set, valid and
// different from each other (two roles on one account would make the role buttons lie).
function checkDemoAccounts(value, ctx) {
  if (!value.DEMO_MODE) return;
  const emails = DEMO_EMAIL_KEYS.map((key) => value[key]);
  DEMO_EMAIL_KEYS.forEach((key) => {
    if (!value[key]) ctx.addIssue({ code: "custom", path: [key], message: "is required when DEMO_MODE is true" });
    else if (!z.email().safeParse(value[key]).success) ctx.addIssue({ code: "custom", path: [key], message: "must be an email address" });
  });
  if (emails.every(Boolean) && new Set(emails).size !== emails.length) {
    ctx.addIssue({ code: "custom", path: ["DEMO_OWNER_EMAIL"], message: "the three demo emails must be different" });
  }
}

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
  // Off unless "true" (BL31): then POST /api/auth/demo-login signs visitors in as one of the three
  // demo accounts below, without a password. Off, that endpoint answers 404.
  DEMO_MODE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  DEMO_OWNER_EMAIL: optionalEmail,
  DEMO_ADMIN_EMAIL: optionalEmail,
  DEMO_VIEWER_EMAIL: optionalEmail,
  // Only for the demo reset script (ADR 0017), never for the API. Its own database role, which may
  // TRUNCATE; kept in a file outside server/.env so the API process never holds it. Null when unset.
  DEMO_RESET_DATABASE_URL: z
    .preprocess((value) => (value === "" ? undefined : value), postgresUrl.optional())
    .transform((value) => value ?? null),
  // The second switch of the reset: lets it delete organizations created through sign-up. Off unless
  // "true"; set it only on a server whose database serves the demo and nothing else.
  DEMO_RESET_WIPE_OTHERS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
}).superRefine((value, ctx) => {
  checkDemoAccounts(value, ctx);
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
