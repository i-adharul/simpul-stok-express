const { requireRole } = require("../middlewares/authorization");

const run = (action, ctx) => {
  const next = jest.fn();
  requireRole(action)({ ctx }, {}, next);
  return next;
};

describe("requireRole (the role half of a warehouse-level action)", () => {
  it("lets a role that the matrix allows through, without looking at any warehouse", () => {
    for (const role of ["OWNER", "WAREHOUSE_ADMIN"]) {
      const next = run("stock.receive", { role, warehouseIds: [] });
      expect(next).toHaveBeenCalledWith();
    }
  });

  it("answers 403 FORBIDDEN to a Viewer and to a Platform admin", () => {
    for (const role of ["VIEWER", "PLATFORM_ADMIN", "UNKNOWN"]) {
      const next = run("stock.receive", { role, warehouseIds: [] });
      expect(next.mock.calls[0][0]).toMatchObject({ code: "FORBIDDEN", status: 403 });
    }
  });

  it("refuses an organization-level action when the route is defined", () => {
    expect(() => requireRole("warehouse.manage")).toThrow(/warehouse-level actions only/);
  });

  it("refuses an unknown action when the route is defined", () => {
    expect(() => requireRole("stock.fly")).toThrow(/Unknown action/);
  });

  it("is a bug, not a 403, to run before authentication", () => {
    expect(() => requireRole("stock.receive")({}, {}, jest.fn())).toThrow(/needs req.ctx/);
  });

  it("carries the action for the 'every action is used' test", () => {
    expect(requireRole("stock.receive").action).toBe("stock.receive");
  });
});
