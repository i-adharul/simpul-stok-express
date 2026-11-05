const express = require("express");
const request = require("supertest");
const authorization = require("../middlewares/authorization");
const { errorHandler } = require("../middlewares/errorHandler");

const { requireCan } = authorization;

// A tiny app: the fake "authentication" puts the context on the request, then requireCan runs.
// The body parser is placed AFTER requireCan on purpose in one app, to prove the decision is made
// before the input is read.
function appFor(role, action, { handlerSpy } = {}) {
  const app = express();
  app.use((req, res, next) => {
    req.ctx = { userId: "u", organizationId: "o", role, warehouseIds: [] };
    next();
  });
  app.post("/x", requireCan(action), express.json(), (req, res) => {
    if (handlerSpy) handlerSpy();
    res.json({ ok: true });
  });
  app.use(errorHandler);
  return app;
}

const FORBIDDEN = {
  code: "FORBIDDEN",
  message: "Anda tidak memiliki akses untuk tindakan ini.",
  details: null,
};

describe("requireCan", () => {
  it("lets a role through when the matrix allows it", async () => {
    const res = await request(appFor("OWNER", "warehouse.manage")).post("/x").send({});

    expect(res.status).toBe(200);
  });

  it.each([["WAREHOUSE_ADMIN"], ["VIEWER"], ["PLATFORM_ADMIN"]])("answers 403 FORBIDDEN to %s on an Owner-only action", async (role) => {
    const handlerSpy = jest.fn();

    const res = await request(appFor(role, "warehouse.manage", { handlerSpy })).post("/x").send({});

    expect(res.status).toBe(403);
    expect(res.body).toEqual(FORBIDDEN);
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("decides before the input is read: a forbidden role with a broken JSON body still gets 403, not 400", async () => {
    const res = await request(appFor("VIEWER", "product.manage"))
      .post("/x")
      .set("Content-Type", "application/json")
      .send("{broken");

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });

  it("lets a Warehouse Admin reach the transfer destinations but not a Viewer", async () => {
    expect((await request(appFor("WAREHOUSE_ADMIN", "transfer.destinations")).post("/x").send({})).status).toBe(200);
    expect((await request(appFor("VIEWER", "transfer.destinations")).post("/x").send({})).status).toBe(403);
  });

  it("refuses a warehouse-level action when the route is defined (it needs the warehouseId, so the handler checks it)", () => {
    expect(() => requireCan("stock.receive")).toThrow(/organization-level/);
  });

  it("refuses an unknown action when the route is defined", () => {
    expect(() => requireCan("stock.delete")).toThrow(/Unknown action/);
  });

  it("is a programming error, not a 403, when there is no req.ctx (authentication was forgotten)", async () => {
    const app = express();
    app.get("/x", requireCan("warehouse.read"), (req, res) => res.json({ ok: true }));
    app.use(errorHandler);

    const res = await request(app).get("/x");

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("INTERNAL_ERROR");
  });
});
