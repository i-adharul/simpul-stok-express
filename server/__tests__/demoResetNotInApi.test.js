const fs = require("fs");
const path = require("path");

// ADR 0017: the API server never runs the demo reset. The reset holds a privileged connection
// (TRUNCATE), so nothing the API loads may require it. Only scripts/ and the tests may.
const SERVER = path.join(__dirname, "..");
const ENTRY_FILES = ["app.js", "bin/www.js"];
const API_DIRS = ["routes", "controllers", "services", "middlewares", "schemas", "helpers", "models", "config"];
// helpers that make up the reset itself; they may require each other.
const RESET_FILES = new Set(["helpers/demoReset.js", "helpers/resetConnection.js"]);
const RESET_IMPORT = /require\(\s*["'`][^"'`]*(demoReset|resetConnection|resetDemo)[^"'`]*["'`]/;

function filesOf(dir) {
  const base = path.join(SERVER, dir);
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base).filter((name) => name.endsWith(".js")).map((name) => `${dir}/${name}`);
}

function offenders() {
  const files = [...ENTRY_FILES, ...API_DIRS.flatMap(filesOf)].filter((file) => !RESET_FILES.has(file));
  return files.filter((file) => fs.existsSync(path.join(SERVER, file)) && RESET_IMPORT.test(fs.readFileSync(path.join(SERVER, file), "utf8")));
}

describe("the API never loads the demo reset", () => {
  it("is required by no file of the API", () => {
    expect(offenders()).toEqual([]);
  });

  it("really scans the API (the reset helper exists and the scan sees the API folders)", () => {
    expect(fs.existsSync(path.join(SERVER, "helpers/demoReset.js"))).toBe(true);
    expect(API_DIRS.flatMap(filesOf).length).toBeGreaterThan(20);
  });
});
