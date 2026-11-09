const express = require("express");
const app = require("../app");
const subscriptionGuard = require("../middlewares/subscriptionGuard");
const { listRoutes, findUnguardedWriteRoutes } = require("./support/routeInspector");

// Write routes that must NOT have subscriptionGuard, with the reason. Keep this list short.
// The label is "<METHOD> <path as declared in the router>".
// BL23: login, logout, password change and (later) the billing endpoints stay allowed in every
// subscription state, because a locked-out user must still be able to sign in, pay and sign out.
const ALLOWED_WITHOUT_GUARD = [
  "POST /auth/login",
  "POST /auth/logout",
  // BL04: a new customer has no organization yet, so there is no subscription to check.
  "POST /auth/register-organization",
  // BL06: the person has no session yet; the token in the body is the proof.
  "POST /auth/accept-invite",
  "PATCH /me/password",
];

describe("rule 17: every write route installs subscriptionGuard", () => {
  it("finds the routes of the real app (the inspector is not blind)", () => {
    const labels = listRoutes(app).map((route) => route.label);

    expect(labels).toEqual(expect.arrayContaining(["POST /auth/login", "PATCH /me/password"]));
  });

  it("no POST, PUT, PATCH or DELETE route of the real app skips it, except the written list", () => {
    expect(findUnguardedWriteRoutes(app, ALLOWED_WITHOUT_GUARD)).toEqual([]);
  });

  it("every entry of the allowed list still names a real write route", () => {
    const writes = listRoutes(app)
      .filter((route) => ["post", "put", "patch", "delete"].includes(route.method))
      .map((route) => route.label);

    for (const label of ALLOWED_WITHOUT_GUARD) expect(writes).toContain(label);
  });
});

describe("the inspector itself", () => {
  const handler = (req, res) => res.end();

  it("flags a write route without the guard, for each write method", () => {
    const fake = express();
    fake.post("/a", handler);
    fake.put("/b", handler);
    fake.patch("/c", handler);
    fake.delete("/d", handler);

    expect(findUnguardedWriteRoutes(fake)).toEqual(["POST /a", "PUT /b", "PATCH /c", "DELETE /d"]);
  });

  it("accepts a write route that has the guard before the controller", () => {
    const fake = express();
    fake.post("/a", subscriptionGuard, handler);

    expect(findUnguardedWriteRoutes(fake)).toEqual([]);
  });

  it("does not accept the guard placed after the controller", () => {
    const fake = express();
    fake.post("/a", handler, subscriptionGuard);

    expect(findUnguardedWriteRoutes(fake)).toEqual(["POST /a"]);
  });

  it("does not accept a look-alike function without the marker", () => {
    const fake = express();
    fake.post("/a", (req, res, next) => next(), handler);

    expect(findUnguardedWriteRoutes(fake)).toEqual(["POST /a"]);
  });

  it("ignores GET routes", () => {
    const fake = express();
    fake.get("/a", handler);

    expect(findUnguardedWriteRoutes(fake)).toEqual([]);
  });

  it("finds write routes inside a nested router", () => {
    const fake = express();
    const router = express.Router();
    router.post("/inner", handler);
    fake.use("/outer", router);

    expect(findUnguardedWriteRoutes(fake)).toEqual(["POST /inner"]);
  });

  it("skips only the routes on the allowed list", () => {
    const fake = express();
    fake.post("/hook", handler);
    fake.post("/other", handler);

    expect(findUnguardedWriteRoutes(fake, ["POST /hook"])).toEqual(["POST /other"]);
  });
});
