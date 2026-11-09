const fs = require("fs");
const os = require("os");
const path = require("path");

// Rule 3: controllers/ and services/ reach tenant data only through helpers/tenantScope.js and
// helpers/ownership.js, never through a model. This static check replaces a lint rule (docs/05).
const SERVER = path.join(__dirname, "..");
const CHECKED_DIRS = ["controllers", "services"];

// Files allowed to import a model, as "folder/file.js": "reason". Keep this list short and give
// every entry a reason. Example of a valid future entry:
//   "services/warehouseLock.js": "needs sequelize.transaction and the SELECT ... FOR UPDATE lock"
const EXCEPTIONS = {};

// helpers/platformAccess.js is the only cross-tenant read gate (no organizationId filter). It lives
// in helpers/, which this scan does not cover, so it is listed here with its reason and checked
// by its own tests below: it may be required only by the Platform admin code.
const PLATFORM_GATE = {
  file: "helpers/platformAccess.js",
  reason: "reads organizations across tenants for the Platform admin routes; it is the only such gate",
  allowedCallers: ["routes/platform.js", "controllers/platformController.js", "services/platformService.js"],
};

// require("../models"), require("../models/user"), require("../models/index.js") and the import form.
const MODEL_IMPORT = /(?:require\(\s*|from\s+|import\s+)["'`](?:\.\.?\/)+models(?:\/[^"'`]*)?["'`]/;

function findModelImports(dir, exceptions = EXCEPTIONS) {
  const found = [];
  for (const folder of CHECKED_DIRS) {
    const base = path.join(dir, folder);
    if (!fs.existsSync(base)) continue;
    for (const file of fs.readdirSync(base).filter((name) => name.endsWith(".js"))) {
      const label = `${folder}/${file}`;
      if (label in exceptions) continue;
      const lines = fs.readFileSync(path.join(base, file), "utf8").split("\n");
      lines.forEach((text, index) => {
        if (!text.trim().startsWith("//") && MODEL_IMPORT.test(text)) {
          found.push(`${label}:${index + 1}  ${text.trim()}`);
        }
      });
    }
  }
  return found;
}

describe("rule 3: controllers and services do not import models directly", () => {
  it("finds no model import in the real controllers/ and services/", () => {
    expect(findModelImports(SERVER)).toEqual([]);
  });

  it("scans real files (the check is not blind)", () => {
    for (const folder of CHECKED_DIRS) {
      expect(fs.readdirSync(path.join(SERVER, folder)).filter((name) => name.endsWith(".js")).length).toBeGreaterThan(0);
    }
  });

  it("every exception names a file that still exists and has a reason", () => {
    for (const [label, reason] of Object.entries(EXCEPTIONS)) {
      expect(fs.existsSync(path.join(SERVER, label))).toBe(true);
      expect(reason.trim().length).toBeGreaterThan(10);
    }
  });
});

describe("helpers/platformAccess.js is the only cross-tenant read gate", () => {
  const callers = () =>
    ["controllers", "services", "routes", "middlewares", "helpers"].flatMap((folder) =>
      fs
        .readdirSync(path.join(SERVER, folder))
        .filter((name) => name.endsWith(".js"))
        .map((name) => `${folder}/${name}`)
        .filter((label) => label !== PLATFORM_GATE.file)
        .filter((label) => /platformAccess/.test(fs.readFileSync(path.join(SERVER, label), "utf8"))),
    );

  it("exists and has a written reason", () => {
    expect(fs.existsSync(path.join(SERVER, PLATFORM_GATE.file))).toBe(true);
    expect(PLATFORM_GATE.reason.trim().length).toBeGreaterThan(10);
  });

  it("is required only by the Platform admin code", () => {
    const outside = callers().filter((label) => !PLATFORM_GATE.allowedCallers.includes(label));

    expect(outside).toEqual([]);
  });

  it("has no organizationId filter on the tenant tables it does not need (only Organization is imported)", () => {
    const source = fs.readFileSync(path.join(SERVER, PLATFORM_GATE.file), "utf8");

    expect(source).toMatch(/require\("\.\.\/models"\)/);
    expect(source).toMatch(/const \{ Organization \} = /);
  });
});

describe("the scan itself", () => {
  let dir;
  const write = (label, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, label)), { recursive: true });
    fs.writeFileSync(path.join(dir, label), content);
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "model-import-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it.each([
    'const { User } = require("../models");',
    'const User = require("../models/user");',
    "const db = require('../models/index.js');",
    'import { User } from "../models";',
  ])("flags: %s", (line) => {
    write("controllers/a.js", `${line}\n`);

    expect(findModelImports(dir, {})).toHaveLength(1);
  });

  it.each([
    'const { tenant } = require("../helpers/tenantScope");',
    'const { findOwned } = require("../helpers/ownership");',
    'const service = require("../services/authService");',
    '// const { User } = require("../models");',
  ])("allows: %s", (line) => {
    write("services/a.js", `${line}\n`);

    expect(findModelImports(dir, {})).toEqual([]);
  });

  it("flags a service as well as a controller, with file and line", () => {
    write("controllers/a.js", "const x = 1;\nconst m = require('../models');\n");
    write("services/b.js", 'const m = require("../models/stockLevel");\n');

    expect(findModelImports(dir, {}).map((text) => text.split("  ")[0])).toEqual([
      "controllers/a.js:2",
      "services/b.js:1",
    ]);
  });

  it("skips a file on the exception list", () => {
    write("services/b.js", 'const m = require("../models");\n');

    expect(findModelImports(dir, { "services/b.js": "needs sequelize.transaction" })).toEqual([]);
  });

  it("does not look at other folders (helpers may import models)", () => {
    write("helpers/a.js", 'const m = require("../models");\n');

    expect(findModelImports(dir, {})).toEqual([]);
  });
});
