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
