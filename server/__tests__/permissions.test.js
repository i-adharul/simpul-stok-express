const { ACTIONS, ROLES, roleAllows } = require("../helpers/permissions");

const ORG_ACTIONS = [
  "warehouse.read",
  "product.read",
  "warehouse.manage",
  "product.manage",
  "member.manage",
  "subscription.manage",
  "transfer.destinations",
];
const WAREHOUSE_ACTIONS = ["stock.read", "history.read", "stock.receive", "stock.adjust", "stock.transfer"];

describe("the permission matrix", () => {
  it("has exactly the 12 actions of the spec, and no other", () => {
    expect(Object.keys(ACTIONS).sort()).toEqual([...ORG_ACTIONS, ...WAREHOUSE_ACTIONS].sort());
    expect(Object.keys(ACTIONS)).toHaveLength(12);
  });

  it("marks 7 actions as organization-level and 5 as warehouse-level", () => {
    const level = (wanted) => Object.keys(ACTIONS).filter((a) => ACTIONS[a].level === wanted).sort();

    expect(level("organization")).toEqual([...ORG_ACTIONS].sort());
    expect(level("warehouse")).toEqual([...WAREHOUSE_ACTIONS].sort());
  });

  it("knows exactly the four roles", () => {
    expect([...ROLES].sort()).toEqual(["OWNER", "PLATFORM_ADMIN", "VIEWER", "WAREHOUSE_ADMIN"]);
  });

  it("is frozen, so no code can grant itself a permission at runtime", () => {
    expect(Object.isFrozen(ACTIONS)).toBe(true);
    expect(Object.isFrozen(ACTIONS["stock.read"])).toBe(true);
    expect(Object.isFrozen(ACTIONS["stock.read"].roles)).toBe(true);
  });
});

describe("roleAllows: who may do what (role alone)", () => {
  const OWNER_ONLY = ["warehouse.manage", "product.manage", "member.manage", "subscription.manage"];
  const READ_ALL = ["warehouse.read", "product.read", "stock.read", "history.read"];
  const WRITE_STOCK = ["stock.receive", "stock.adjust", "stock.transfer", "transfer.destinations"];

  it.each([...ORG_ACTIONS, ...WAREHOUSE_ACTIONS])("Owner may %s", (action) => {
    expect(roleAllows("OWNER", action)).toBe(true);
  });

  it.each(OWNER_ONLY)("only the Owner may %s", (action) => {
    expect(roleAllows("WAREHOUSE_ADMIN", action)).toBe(false);
    expect(roleAllows("VIEWER", action)).toBe(false);
  });

  it.each(WRITE_STOCK)("Warehouse Admin may, Viewer may not: %s", (action) => {
    expect(roleAllows("WAREHOUSE_ADMIN", action)).toBe(true);
    expect(roleAllows("VIEWER", action)).toBe(false);
  });

  it.each(READ_ALL)("every tenant role may %s", (action) => {
    for (const role of ["OWNER", "WAREHOUSE_ADMIN", "VIEWER"]) expect(roleAllows(role, action)).toBe(true);
  });

  it.each([...ORG_ACTIONS, ...WAREHOUSE_ACTIONS])("a Platform admin may never %s", (action) => {
    expect(roleAllows("PLATFORM_ADMIN", action)).toBe(false);
  });

  it("denies an unknown role", () => {
    expect(roleAllows("SUPERUSER", "stock.read")).toBe(false);
    expect(roleAllows(undefined, "stock.read")).toBe(false);
  });

  it("treats an unknown action as a programming error", () => {
    expect(() => roleAllows("OWNER", "stock.delete")).toThrow(/Unknown action/);
  });
});
