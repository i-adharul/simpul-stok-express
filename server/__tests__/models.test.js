const db = require("../models");

afterAll(() => db.sequelize.close());

describe("models/index.js", () => {
  it("connects the test environment to a database whose name ends in _test", () => {
    expect(db.sequelize.config.database).toMatch(/_test$/);
  });

  it("does not use the development database in tests", () => {
    expect(db.sequelize.config.database).not.toBe("simpul_dev");
  });

  it("loads the four models", () => {
    expect(
      Object.keys(db)
        .filter((key) => /^[A-Z]/.test(key) && key !== "Sequelize")
        .sort(),
    ).toEqual(["Organization", "Plan", "Subscription", "User"]);
  });

  it("links an organization to its users and to exactly one subscription", () => {
    expect(db.Organization.associations.Users.associationType).toBe("HasMany");
    expect(db.Organization.associations.Subscription.associationType).toBe(
      "HasOne",
    );
    expect(db.User.associations.Organization.associationType).toBe("BelongsTo");
  });

  it("links a subscription to its organization and plan, and a plan to its subscriptions", () => {
    expect(db.Subscription.associations.Organization.associationType).toBe(
      "BelongsTo",
    );
    expect(db.Subscription.associations.Plan.associationType).toBe("BelongsTo");
    expect(db.Plan.associations.Subscriptions.associationType).toBe("HasMany");
  });
});
