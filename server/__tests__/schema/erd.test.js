const fs = require("fs");
const path = require("path");
const { getSequelize } = require("../support/db");

const DOCS = path.join(__dirname, "..", "..", "..", "docs");
const read = (file) => fs.readFileSync(path.join(DOCS, file), "utf8");

// Rows of the table "Data model (17 entities)": `| E01 | Organization | ...`.
const entitiesInDocs = () =>
  [...read("03_Data_Model.md").matchAll(/^\| E\d{2} \| (\w+)\s+\|/gm)].map(
    (match) => match[1],
  );

// Rows of sections 1 to 5 of ERD_Relations.md: `| 8 | Organization 1—N StockMovement | StockMovement.organizationId |`.
// Section 6 lists logical relations that have no foreign key on purpose.
const relationsInDocs = () => {
  const text = read("ERD_Relations.md");
  const start = text.indexOf("## 1.");
  const end = text.indexOf("## 6.");
  return [
    ...text.slice(start, end).matchAll(/^\| (\d+)\s+\| [^|]+\| (\w+)\.(\w+)/gm),
  ].map(([, no, entity, column]) => ({
    no: Number(no),
    table: `${entity}s`,
    column,
  }));
};

const foreignKeyColumns = async () => {
  const [rows] = await getSequelize().query(
    `SELECT kcu.table_name AS "table", kcu.column_name AS "column"
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`,
  );
  return new Set(rows.map((row) => `${row.table}.${row.column}`));
};

describe("schema matches the data model and the ERD", () => {
  it("has exactly the 17 entities of docs/03_Data_Model.md, one table each", async () => {
    const expected = entitiesInDocs().map((name) => `${name}s`);
    const [rows] = await getSequelize().query(
      `SELECT table_name AS name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name <> 'SequelizeMeta'`,
    );

    expect(expected).toHaveLength(17);
    expect(rows.map((row) => row.name).sort()).toEqual(expected.sort());
  });

  it("reads all 33 relations of sections 1 to 5 of ERD_Relations.md", () => {
    const numbers = relationsInDocs().map((relation) => relation.no);

    expect(numbers).toEqual(Array.from({ length: 33 }, (_, i) => i + 1));
  });

  it("has a foreign key for every one of those relations", async () => {
    const foreignKeys = await foreignKeyColumns();
    const missing = relationsInDocs()
      .filter(({ table, column }) => !foreignKeys.has(`${table}.${column}`))
      .map(({ no, table, column }) => `#${no} ${table}.${column}`);

    expect(missing).toEqual([]);
  });

  it("has no foreign key on the loose references (ERD section 6)", async () => {
    const foreignKeys = await foreignKeyColumns();

    expect(foreignKeys.has("IdempotencyKeys.resourceId")).toBe(false);
    expect(foreignKeys.has("AuditLogs.entityId")).toBe(false);
    expect(foreignKeys.has("Invitations.warehouseIds")).toBe(false);
  });

  it("gives every table except Plans and WebhookEvents an organizationId", async () => {
    const [rows] = await getSequelize().query(
      `SELECT table_name AS name FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'organizationId'`,
    );
    const withOrganization = rows.map((row) => row.name);
    const without = entitiesInDocs()
      .map((name) => `${name}s`)
      .filter((table) => !withOrganization.includes(table))
      .sort();

    // Organizations is the tenant itself; a platform admin is a User without one (nullable column).
    expect(without).toEqual(["Organizations", "Plans", "WebhookEvents"]);
  });
});
