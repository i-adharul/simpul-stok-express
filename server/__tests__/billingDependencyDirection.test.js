const fs = require("fs");
const os = require("os");
const path = require("path");

// Dependency direction (CLAUDE.md): stock services may call billing services, never the reverse. The
// billing files must not import a stock service or touch a stock mutation, so a change in how stock is
// written can never be caused by (or wait for) billing code. This static check reads the files; it
// does not run them. Files that do not exist yet (billingService and xenditClient arrive with the
// billing stories) are skipped, and the test below proves it still scans the ones that exist.
const SERVER = path.join(__dirname, "..");
const BILLING_FILES = ["services/planLimitService.js", "services/billingService.js", "services/xenditClient.js"];

// Services that read or write stock, and the lock that serializes stock writes.
const STOCK_SERVICES = [
  "stockService",
  "transferService",
  "transferCode",
  "stockHistoryService",
  "stockSummaryService",
  "dashboardService",
  "warehouseLock",
  "idempotencyService",
];
// The tables of stock: touching one of them from billing is a stock mutation (or read) by another name.
const STOCK_MODELS = ["StockLevel", "StockMovement", "StockTransfer", "IdempotencyKey"];

const SERVICE_IMPORT = new RegExp(String.raw`require\(\s*["'\`](?:\.\.?\/)+(?:services\/)?(${STOCK_SERVICES.join("|")})(?:\.js)?["'\`]\s*\)`);
const MODEL_IMPORT = /require\(\s*["'`](?:\.\.?\/)+models(?:\/[^"'`]*)?["'`]\s*\)/;
const MODEL_USE = new RegExp(String.raw`\b(${STOCK_MODELS.join("|")})\b`);

function findViolations(dir, files = BILLING_FILES) {
  const found = [];
  for (const label of files) {
    const file = path.join(dir, label);
    if (!fs.existsSync(file)) continue;
    fs.readFileSync(file, "utf8")
      .split("\n")
      .forEach((text, index) => {
        if (text.trim().startsWith("//")) return;
        const where = `${label}:${index + 1}  ${text.trim()}`;
        if (SERVICE_IMPORT.test(text)) found.push(`${where}  <- imports a stock service`);
        if (MODEL_IMPORT.test(text)) found.push(`${where}  <- imports a model directly`);
        if (MODEL_USE.test(text)) found.push(`${where}  <- touches a stock table`);
      });
  }
  return found;
}

describe("billing code does not depend on stock code", () => {
  it("the real billing files import no stock service and touch no stock table", () => {
    expect(findViolations(SERVER)).toEqual([]);
  });

  it("scans real files (the check is not blind): planLimitService exists and is read", () => {
    const present = BILLING_FILES.filter((label) => fs.existsSync(path.join(SERVER, label)));

    expect(present).toContain("services/planLimitService.js");
    expect(fs.readFileSync(path.join(SERVER, "services/planLimitService.js"), "utf8")).toMatch(/assertWithinLimit/);
  });

  it("the stock services it guards against exist (the names are not stale)", () => {
    for (const name of STOCK_SERVICES) expect(fs.existsSync(path.join(SERVER, "services", `${name}.js`))).toBe(true);
  });

  it("the other direction is allowed: a stock service may import the plan limit service", () => {
    const text = 'const { assertWithinLimit } = require("./planLimitService");';

    expect(SERVICE_IMPORT.test(text)).toBe(false);
  });
});

describe("the scan itself", () => {
  let dir;
  const write = (label, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, label)), { recursive: true });
    fs.writeFileSync(path.join(dir, label), content);
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "billing-direction-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it.each([
    'const stock = require("./stockService");',
    "const stock = require('./stockService.js');",
    'const { transfer } = require("../services/transferService");',
    'const { lockWarehouse } = require("./warehouseLock");',
    'const idem = require("./idempotencyService");',
    'const summary = require("./stockSummaryService");',
  ])("flags a stock service import: %s", (line) => {
    write("services/billingService.js", `${line}\n`);

    expect(findViolations(dir)).toHaveLength(1);
  });

  it.each([
    'const { tenant } = require("../helpers/tenantScope");',
    'const planLimit = require("./planLimitService");',
    'const { planLimitReached } = require("../helpers/errors");',
    '// const stock = require("./stockService");',
  ])("allows: %s", (line) => {
    write("services/billingService.js", `${line}\n`);

    expect(findViolations(dir)).toEqual([]);
  });

  it("flags a direct model import and a stock table, with file and line", () => {
    write("services/xenditClient.js", 'const a = 1;\nconst db = require("../models");\nconst x = tenant(ctx).StockMovement.create({});\n');

    expect(findViolations(dir).map((text) => text.split("  ")[0])).toEqual(["services/xenditClient.js:2", "services/xenditClient.js:3"]);
  });

  it("skips files that do not exist yet and reads only the listed ones", () => {
    write("services/stockService.js", 'const x = require("./transferService");\n');

    expect(findViolations(dir)).toEqual([]);
  });
});
