const db = require("../models");

afterAll(() => db.sequelize.close());

describe("models/index.js", () => {
  it("connects the test environment to a database whose name ends in _test", () => {
    expect(db.sequelize.config.database).toMatch(/_test$/);
  });

  it("does not use the development database in tests", () => {
    expect(db.sequelize.config.database).not.toBe("simpul_dev");
  });

  it("loads every model", () => {
    expect(
      Object.keys(db)
        .filter((key) => /^[A-Z]/.test(key) && key !== "Sequelize")
        .sort(),
    ).toEqual([
      "AuditLog",
      "IdempotencyKey",
      "ImportJob",
      "Invitation",
      "Invoice",
      "Notification",
      "Organization",
      "Plan",
      "Product",
      "StockLevel",
      "StockMovement",
      "StockTransfer",
      "Subscription",
      "User",
      "UserWarehouse",
      "Warehouse",
      "WebhookEvent",
    ]);
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

  it("links a warehouse to its organization and its user assignments", () => {
    expect(db.Organization.associations.Warehouses.associationType).toBe(
      "HasMany",
    );
    expect(db.Warehouse.associations.Organization.associationType).toBe(
      "BelongsTo",
    );
    expect(db.Warehouse.associations.UserWarehouses.associationType).toBe(
      "HasMany",
    );
    expect(db.UserWarehouse.associations.User.associationType).toBe(
      "BelongsTo",
    );
    expect(db.UserWarehouse.associations.Warehouse.associationType).toBe(
      "BelongsTo",
    );
  });

  it("links a product to its organization", () => {
    expect(db.Product.associations.Organization.associationType).toBe(
      "BelongsTo",
    );
    expect(db.Organization.associations.Products.associationType).toBe(
      "HasMany",
    );
  });

  it("links a stock level to its warehouse and product", () => {
    expect(db.StockLevel.associations.Warehouse.associationType).toBe(
      "BelongsTo",
    );
    expect(db.StockLevel.associations.Product.associationType).toBe(
      "BelongsTo",
    );
  });

  it("links a transfer to its two warehouses and its movements", () => {
    expect(db.StockTransfer.associations.fromWarehouse.associationType).toBe(
      "BelongsTo",
    );
    expect(db.StockTransfer.associations.toWarehouse.associationType).toBe(
      "BelongsTo",
    );
    expect(db.StockTransfer.associations.StockMovements.associationType).toBe(
      "HasMany",
    );
    expect(db.StockMovement.associations.StockTransfer.associationType).toBe(
      "BelongsTo",
    );
  });

  it("links an idempotency key to its organization", () => {
    expect(db.IdempotencyKey.associations.Organization.associationType).toBe(
      "BelongsTo",
    );
  });

  it("links an invitation and an import job to their organization and creator", () => {
    expect(db.Invitation.associations.Organization.associationType).toBe(
      "BelongsTo",
    );
    expect(db.Invitation.associations.createdBy.associationType).toBe(
      "BelongsTo",
    );
    expect(db.ImportJob.associations.createdBy.associationType).toBe(
      "BelongsTo",
    );
    expect(db.ImportJob.associations.StockMovements.associationType).toBe(
      "HasMany",
    );
    expect(db.StockMovement.associations.ImportJob.associationType).toBe(
      "BelongsTo",
    );
  });

  it("links an invoice to its organization, subscription and plan; a webhook event stands alone", () => {
    expect(db.Invoice.associations.Organization.associationType).toBe(
      "BelongsTo",
    );
    expect(db.Invoice.associations.Subscription.associationType).toBe(
      "BelongsTo",
    );
    expect(db.Invoice.associations.Plan.associationType).toBe("BelongsTo");
    expect(Object.keys(db.WebhookEvent.associations)).toEqual([]);
  });

  it("links an audit log to its organization and actor, and a notification to its recipient", () => {
    expect(db.AuditLog.associations.Organization.associationType).toBe(
      "BelongsTo",
    );
    expect(db.AuditLog.associations.actor.associationType).toBe("BelongsTo");
    expect(db.Notification.associations.User.associationType).toBe("BelongsTo");
  });
});
