const { can } = require("../helpers/permissions");

// The expected table is written out by hand from the spec (docs/02 roles, docs/04 endpoint list),
// NOT derived from helpers/permissions.js, so a wrong edit of the matrix makes this test fail.
// "Y" = allowed, "-" = denied. Columns: PLATFORM_ADMIN, OWNER, WAREHOUSE_ADMIN, VIEWER.
const ROLES = ["PLATFORM_ADMIN", "OWNER", "WAREHOUSE_ADMIN", "VIEWER"];
const EXPECTED = {
  // organization level
  "warehouse.read": ["-", "Y", "Y", "Y"],
  "product.read": ["-", "Y", "Y", "Y"],
  "warehouse.manage": ["-", "Y", "-", "-"],
  "product.manage": ["-", "Y", "-", "-"],
  "member.manage": ["-", "Y", "-", "-"],
  "subscription.manage": ["-", "Y", "-", "-"],
  "transfer.destinations": ["-", "Y", "Y", "-"],
  // warehouse level (the "Y" holds only for a warehouse that is in the caller's list)
  "stock.read": ["-", "Y", "Y", "Y"],
  "history.read": ["-", "Y", "Y", "Y"],
  "stock.receive": ["-", "Y", "Y", "-"],
  "stock.adjust": ["-", "Y", "Y", "-"],
  "stock.transfer": ["-", "Y", "Y", "-"],
};
const WAREHOUSE_LEVEL = ["stock.read", "history.read", "stock.receive", "stock.adjust", "stock.transfer"];

const MINE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ctxOf = (role) => ({
  userId: "u",
  organizationId: role === "PLATFORM_ADMIN" ? null : "o",
  role,
  warehouseIds: role === "PLATFORM_ADMIN" ? [] : [MINE],
});

const cases = [];
for (const [action, allowed] of Object.entries(EXPECTED)) {
  ROLES.forEach((role, i) => {
    const byRole = allowed[i] === "Y";
    const isWarehouse = WAREHOUSE_LEVEL.includes(action);
    // [role, action, warehouse, expected]
    cases.push([role, action, "an assigned warehouse", MINE, byRole]);
    cases.push([role, action, "a warehouse that is not assigned", OTHER, isWarehouse ? false : byRole]);
    cases.push([role, action, "no warehouse", undefined, isWarehouse ? false : byRole]);
  });
}

describe("role x action x warehouse", () => {
  it("covers 12 actions x 4 roles x 3 warehouse situations", () => {
    expect(Object.keys(EXPECTED)).toHaveLength(12);
    expect(cases).toHaveLength(12 * 4 * 3);
  });

  it.each(cases)("%s may/may not %s with %s", (role, action, _label, warehouseId, expected) => {
    expect(can(ctxOf(role), action, { warehouseId })).toBe(expected);
  });
});
