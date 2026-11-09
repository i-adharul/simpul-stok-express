const { ACTIONS, ROLES, can, roleAllows } = require("../helpers/permissions");

const ORG_ACTIONS = [
  "warehouse.read",
  "product.read",
  "warehouse.manage",
  "product.manage",
  "member.manage",
  "subscription.manage",
  "transfer.destinations",
  "organization.read",
  "organization.manage",
];
const WAREHOUSE_ACTIONS = ["stock.read", "history.read", "stock.receive", "stock.adjust", "stock.transfer"];

describe("the permission matrix", () => {
  it("has exactly the 14 actions of the spec, and no other", () => {
    expect(Object.keys(ACTIONS).sort()).toEqual([...ORG_ACTIONS, ...WAREHOUSE_ACTIONS].sort());
    expect(Object.keys(ACTIONS)).toHaveLength(14);
  });

  it("marks 9 actions as organization-level and 5 as warehouse-level", () => {
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
  const OWNER_ONLY = [
    "warehouse.manage",
    "product.manage",
    "member.manage",
    "subscription.manage",
    "organization.manage",
  ];
  const READ_ALL = ["warehouse.read", "product.read", "stock.read", "history.read", "organization.read"];
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

describe("can(ctx, action, { warehouseId })", () => {
  const W1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const W2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const W3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const ctx = (role, warehouseIds) => ({ userId: "u", organizationId: "o", role, warehouseIds });

  describe("warehouse-level actions", () => {
    it("lets an Owner act in every warehouse of the context (all active ones)", () => {
      const owner = ctx("OWNER", [W1, W2]);

      expect(can(owner, "stock.receive", { warehouseId: W1 })).toBe(true);
      expect(can(owner, "stock.receive", { warehouseId: W2 })).toBe(true);
    });

    it("denies an Owner a warehouse that is not active or not theirs (not in the context)", () => {
      expect(can(ctx("OWNER", [W1]), "stock.receive", { warehouseId: W3 })).toBe(false);
    });

    it("lets a Warehouse Admin act only in the assigned warehouses", () => {
      const admin = ctx("WAREHOUSE_ADMIN", [W1]);

      expect(can(admin, "stock.adjust", { warehouseId: W1 })).toBe(true);
      expect(can(admin, "stock.adjust", { warehouseId: W2 })).toBe(false);
    });

    it("lets a Viewer read, but not write, in the assigned warehouses", () => {
      const viewer = ctx("VIEWER", [W1]);

      expect(can(viewer, "stock.read", { warehouseId: W1 })).toBe(true);
      expect(can(viewer, "history.read", { warehouseId: W1 })).toBe(true);
      expect(can(viewer, "stock.receive", { warehouseId: W1 })).toBe(false);
      expect(can(viewer, "stock.read", { warehouseId: W2 })).toBe(false);
    });

    it("denies a Platform admin everywhere", () => {
      expect(can(ctx("PLATFORM_ADMIN", []), "stock.read", { warehouseId: W1 })).toBe(false);
    });

    it.each([[undefined], [null], [""], [{}]])("denies when no usable warehouseId is given: %j", (warehouseId) => {
      expect(can(ctx("OWNER", [W1]), "stock.read", { warehouseId })).toBe(false);
      expect(can(ctx("OWNER", [W1]), "stock.read")).toBe(false);
    });

    it("denies a context without a warehouse list", () => {
      expect(can({ role: "OWNER" }, "stock.read", { warehouseId: W1 })).toBe(false);
    });
  });

  describe("organization-level actions", () => {
    it("are decided by role alone and ignore the warehouse list", () => {
      expect(can(ctx("OWNER", []), "warehouse.manage")).toBe(true);
      expect(can(ctx("VIEWER", [W1]), "warehouse.manage")).toBe(false);
      expect(can(ctx("WAREHOUSE_ADMIN", []), "transfer.destinations")).toBe(true);
      expect(can(ctx("VIEWER", [W1]), "transfer.destinations")).toBe(false);
    });

    it("do not need a warehouseId", () => {
      expect(can(ctx("VIEWER", []), "warehouse.read")).toBe(true);
    });
  });

  it("treats an unknown action as a programming error", () => {
    expect(() => can(ctx("OWNER", [W1]), "stock.delete", { warehouseId: W1 })).toThrow(/Unknown action/);
  });
});
