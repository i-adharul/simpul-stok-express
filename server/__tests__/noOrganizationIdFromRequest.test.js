const fs = require("fs");
const path = require("path");

// Rule 1: organizationId comes only from req.ctx. This static check fails when server code reads it
// from the body, the query or the URL params (also through req.valid, which holds the same data).
const SERVER = path.join(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", "__tests__", "migrations", "seeders"]);

const SOURCES = "(?:req\\.(?:body|query|params)|req\\.valid\\.(?:body|query|params))";
const PATTERNS = [
  // req.body.organizationId, req.query?.organizationId, req.params["organizationId"]
  new RegExp(`${SOURCES}\\s*\\??\\.\\s*organizationId\\b`),
  new RegExp(`${SOURCES}\\s*\\??\\.?\\s*\\[\\s*["'\`]organizationId["'\`]\\s*\\]`),
  // const { organizationId } = req.body;  const { a, organizationId: org } = req.params;
  new RegExp(`\\{[^}]*\\borganizationId\\b[^}]*\\}\\s*=\\s*${SOURCES}`),
];

function findOffences(source) {
  return source
    .split("\n")
    .map((text, index) => ({ line: index + 1, text: text.trim() }))
    .filter(({ text }) => !text.startsWith("//") && PATTERNS.some((re) => re.test(text)));
}

function listSourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return SKIP_DIRS.has(entry.name) ? [] : listSourceFiles(path.join(dir, entry.name));
    }
    return entry.name.endsWith(".js") ? [path.join(dir, entry.name)] : [];
  });
}

describe("rule 1: no code reads organizationId from the request input", () => {
  it("scans the real server code (the scan is not blind)", () => {
    const files = listSourceFiles(SERVER).map((file) => path.relative(SERVER, file));

    expect(files).toContain(path.join("middlewares", "authentication.js"));
    expect(files).toContain(path.join("helpers", "requestContext.js"));
    expect(files).not.toContain(path.join("__tests__", "app.test.js"));
  });

  it("finds no read of organizationId from req.body, req.query or req.params", () => {
    const offences = listSourceFiles(SERVER).flatMap((file) =>
      findOffences(fs.readFileSync(file, "utf8")).map(
        ({ line, text }) => `${path.relative(SERVER, file)}:${line}  ${text}`,
      ),
    );

    expect(offences).toEqual([]);
  });
});

describe("the scan itself", () => {
  it.each([
    "const id = req.body.organizationId;",
    "const id = req.query.organizationId;",
    "const id = req.params.organizationId;",
    "const id = req.body?.organizationId;",
    'const id = req.body["organizationId"];',
    "const id = req.query['organizationId'];",
    "const { organizationId } = req.body;",
    "const { name, organizationId: org } = req.params;",
    "const { organizationId } = req.valid.query;",
    "where.organizationId = req.valid.body.organizationId;",
  ])("flags: %s", (line) => {
    expect(findOffences(line)).toHaveLength(1);
  });

  it.each([
    "const { organizationId } = req.ctx;",
    "const id = req.ctx.organizationId;",
    "const { name, sku } = req.body;",
    "const id = req.params.id;",
    "// never read req.body.organizationId",
    "where: { organizationId: ctx.organizationId },",
  ])("allows: %s", (line) => {
    expect(findOffences(line)).toEqual([]);
  });
});
