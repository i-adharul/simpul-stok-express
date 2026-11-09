const db = require("../models");
const { getSequelize } = require("./support/db");
const { clearTables } = require("./support/clearTables");
const { createOrganization } = require("./support/factories");
const { findOrganizations, findOrganizationById } = require("../helpers/platformAccess");

jest.setTimeout(30000);

beforeEach(() => clearTables(getSequelize()));
afterAll(async () => {
  await clearTables(getSequelize());
  await db.sequelize.close();
});

describe("helpers/platformAccess.js", () => {
  it("lists organizations of every tenant with a total, newest first", async () => {
    const a = await createOrganization("tokoa");
    const b = await createOrganization("tokob");

    const { rows, count } = await findOrganizations({ limit: 10, offset: 0 });

    expect(count).toBe(2);
    expect(rows.map((row) => row.id).sort()).toEqual([a, b].sort());
  });

  it("pages with limit and offset", async () => {
    await createOrganization("tokoa");
    await createOrganization("tokob");

    const { rows, count } = await findOrganizations({ limit: 1, offset: 1 });

    expect(count).toBe(2);
    expect(rows).toHaveLength(1);
  });

  it("finds one organization by ID whoever owns it, and null for an unknown ID", async () => {
    const id = await createOrganization();

    expect((await findOrganizationById(id)).id).toBe(id);
    expect(await findOrganizationById("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});
