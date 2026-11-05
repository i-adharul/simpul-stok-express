const { execFileSync } = require("child_process");
const path = require("path");
const env = require("../config/env");
const { getSequelize } = require("./support/db");
const { assertTestDatabase } = require("./support/testDatabase");

const SERVER_DIR = path.join(__dirname, "..");

// Runs the real CLI against the test database, as globalSetup does.
const cli = (command) =>
  execFileSync("npx", ["sequelize-cli", command], {
    cwd: SERVER_DIR,
    env: { ...process.env, NODE_ENV: "test" },
    stdio: "pipe",
  });

const listNames = async (sql) => {
  const [rows] = await getSequelize().query(sql);
  return rows.map((row) => row.name);
};

const tables = () =>
  listNames(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name <> 'SequelizeMeta' ORDER BY 1`,
  );
const enumTypes = () =>
  listNames(
    `SELECT typname AS name FROM pg_type WHERE typname LIKE 'enum\\_%' ORDER BY 1`,
  );
const functions = () =>
  listNames(
    `SELECT proname AS name FROM pg_proc
     WHERE pronamespace = 'public'::regnamespace AND proname = 'prevent_row_change'`,
  );

describe("migrations round trip", () => {
  // The suite runs one file at a time (--runInBand), so no other file reads the schema meanwhile.
  jest.setTimeout(60000);

  it("migrates, undoes everything and migrates again with nothing left behind", async () => {
    assertTestDatabase(env.TEST_DATABASE_URL);
    const before = {
      tables: await tables(),
      enums: await enumTypes(),
    };
    expect(before.tables.length).toBeGreaterThan(0);

    cli("db:migrate:undo:all");
    expect(await tables()).toEqual([]);
    expect(await enumTypes()).toEqual([]);
    expect(await functions()).toEqual([]);

    cli("db:migrate");
    expect(await tables()).toEqual(before.tables);
    expect(await enumTypes()).toEqual(before.enums);
  });
});
