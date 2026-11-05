const fs = require("fs");
const os = require("os");
const path = require("path");

// ADR 0013: every service that writes stock takes the warehouse lock first, so stock writers of
// one warehouse queue and the archive of a warehouse cannot slip between a check and a write.
// A file "writes stock" when it reaches StockLevel or StockMovement through the tenant data access
// and calls create, update, destroy, upsert or bulkCreate somewhere. The check is deliberately
// coarse: a file that qualifies must call lockWarehouse( at least once.
const SERVER = path.join(__dirname, "..");

// Files allowed to write stock without the lock, as "services/file.js": "reason". Keep it empty
// unless a file really cannot lock (it must say why).
const EXCEPTIONS = {};

const TOUCHES_STOCK = /\b(?:StockLevel|StockMovement)\b/;
const WRITES = /\.(?:create|update|destroy|upsert|bulkCreate|increment|decrement)\s*\(/;
const LOCKS = /\blockWarehouse\s*\(/;

const codeOf = (text) =>
  text
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

function filesThatWriteStockWithoutLock(dir, exceptions = EXCEPTIONS) {
  const base = path.join(dir, "services");
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base)
    .filter((name) => name.endsWith(".js"))
    .filter((name) => !(`services/${name}` in exceptions))
    .filter((name) => {
      const code = codeOf(fs.readFileSync(path.join(base, name), "utf8"));
      return TOUCHES_STOCK.test(code) && WRITES.test(code) && !LOCKS.test(code);
    })
    .map((name) => `services/${name}`);
}

const writesStock = (dir, name) => {
  const code = codeOf(fs.readFileSync(path.join(dir, "services", name), "utf8"));
  return TOUCHES_STOCK.test(code) && WRITES.test(code);
};

describe("every service that writes stock calls lockWarehouse(", () => {
  it("holds for the real services/", () => {
    expect(filesThatWriteStockWithoutLock(SERVER)).toEqual([]);
  });

  it("is not blind: the real stock service is recognised as a stock writer and does lock", () => {
    expect(writesStock(SERVER, "stockService.js")).toBe(true);
    expect(codeOf(fs.readFileSync(path.join(SERVER, "services", "stockService.js"), "utf8"))).toMatch(LOCKS);
  });

  it("every exception names a file that still exists and has a reason", () => {
    for (const [label, reason] of Object.entries(EXCEPTIONS)) {
      expect(fs.existsSync(path.join(SERVER, label))).toBe(true);
      expect(reason.trim().length).toBeGreaterThan(10);
    }
  });
});

describe("the scan itself", () => {
  let dir;
  const write = (name, content) => {
    fs.mkdirSync(path.join(dir, "services"), { recursive: true });
    fs.writeFileSync(path.join(dir, "services", name), content);
  };
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "stock-lock-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("flags a service that creates a stock row without the lock", () => {
    write("a.js", "async function f(ctx) { await tenant(ctx).StockLevel.create({}); }\n");
    expect(filesThatWriteStockWithoutLock(dir, {})).toEqual(["services/a.js"]);
  });

  it("flags a movement write through a variable", () => {
    write("a.js", "const m = tenant(ctx).StockMovement;\nawait m.create({});\n");
    expect(filesThatWriteStockWithoutLock(dir, {})).toEqual(["services/a.js"]);
  });

  it("passes a stock writer that calls lockWarehouse(", () => {
    write("a.js", "await lockWarehouse(ctx, id, t);\nawait tenant(ctx).StockLevel.update({}, {});\n");
    expect(filesThatWriteStockWithoutLock(dir, {})).toEqual([]);
  });

  it("does not count a lock that is only in a comment", () => {
    write("a.js", "// lockWarehouse(ctx, id, t)\nawait tenant(ctx).StockLevel.create({});\n");
    expect(filesThatWriteStockWithoutLock(dir, {})).toEqual(["services/a.js"]);
  });

  it("ignores a service that only reads stock, and one that does not touch it", () => {
    write("a.js", "const rows = await tenant(ctx).StockLevel.findAll({});\n");
    write("b.js", "await tenant(ctx).Warehouse.create({});\n");
    expect(filesThatWriteStockWithoutLock(dir, {})).toEqual([]);
  });

  it("skips a file on the exception list", () => {
    write("a.js", "await tenant(ctx).StockLevel.create({});\n");
    expect(filesThatWriteStockWithoutLock(dir, { "services/a.js": "needs no lock for a reason" })).toEqual([]);
  });
});
