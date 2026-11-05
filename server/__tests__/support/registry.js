// The cross-tenant registry: one entry per HTTP method of every tenant endpoint
// (docs/06_Test_Plan.md, "Registering a new endpoint"). The harness (support/harness.js) reads it and
// attacks each entry from organization A's session with organization B's data. A story that adds a
// tenant route adds its entry in the same pull request; a test fails when a route is missing.
//
// An entry:
//   method        "get" | "post" | "put" | "patch" | "delete"
//   path          the URL as called, with ":id" for the row, e.g. "/api/warehouses/:id"
//                 (the part after "/api" must equal the path declared in the router)
//   kind          "item" (addressed by one row's ID) | "list" | "create"
//   action        an action of helpers/permissions.js; the roles that may call it come from there
//   createRow     async (world, "A" | "B") => { id, ... }: makes a row in that organization
//   readRow       async (id) => the row as it is in the database, or null (raw SQL)
//   body          optional async (world) => a valid body for a write (also the base of foreignBodies);
//                 it may create the rows the body points at (a stock write needs a warehouse and a product)
//   countRows     async (organizationId) => how many rows the endpoint's table holds for it
//                 (needed for "create" entries and for idempotent ones)
//   listQuery     optional query for the list check, e.g. { pageSize: 100 }: the world is shared by all
//                 entries, and stock bodies add many rows, so A's own row must still fit on the page
//   supportsCursor  optional true: a list that takes a cursor; `cursorParam` names it (default "cursor")
//   idempotent    optional true: the endpoint needs an Idempotency-Key
//   foreignBodies optional [{ key, body: async (world, id) => a body whose `key` holds `id`,
//                 createForeign?: async (world) => { id } a row of B when `key` is not an ID of
//                 the entry's own table (default: entry.createRow(world, "B")) }]
//   warehouseScoped optional { request: async (world, warehouseId) => { id?, body?, query? } }
//                 for an endpoint whose answer depends on the caller's warehouse assignment (a
//                 warehouse-level action, or the warehouse detail): builds the request for that
//                 warehouse, so the role tests can try an assigned and an unassigned one
//
const { ACTIONS } = require("../../helpers/permissions");
const { getSequelize } = require("./db");
const { createStockLevel } = require("./factories");

// The row as it is in the database (raw SQL, so the check does not depend on the code it checks).
const rawRow = (table) => async (id) =>
  (await getSequelize().query(`SELECT * FROM "${table}" WHERE "id" = :id`, { replacements: { id } }))[0][0] ?? null;
const rawCount = (table) => async (organizationId) =>
  Number(
    (await getSequelize().query(`SELECT count(*) AS n FROM "${table}" WHERE "organizationId" = :organizationId`, {
      replacements: { organizationId },
    }))[0][0].n,
  );

const warehouse = {
  createRow: async (world, organization) => ({ id: await world.createWarehouse(organization) }),
  readRow: rawRow("Warehouses"),
  countRows: rawCount("Warehouses"),
};

const product = {
  createRow: async (world, organization) => ({ id: await world.createProduct(organization) }),
  readRow: rawRow("Products"),
  countRows: rawCount("Products"),
};

// A movement written by raw SQL (a RECEIVE in a new warehouse of the organization).
const movement = {
  createRow: async (world, organization) => {
    const warehouseId = await world.createWarehouse(organization);
    const productId = await world.createProduct(organization);
    const [rows] = await getSequelize().query(
      `INSERT INTO "StockMovements" ("organizationId", "warehouseId", "productId", "quantityDelta", "type")
       VALUES (:organizationId, :warehouseId, :productId, 5, 'RECEIVE') RETURNING "id"`,
      { replacements: { organizationId: world.organizations[organization], warehouseId, productId } },
    );
    return { id: rows[0].id };
  },
  readRow: rawRow("StockMovements"),
};

// A stock write needs a warehouse and a product of the caller's organization that exist first.
const stockBody = async (world, patch = {}) => ({
  warehouseId: await world.createWarehouse("A"),
  productId: await world.createProduct("A"),
  quantity: 5,
  ...patch,
});

// A valid transfer body: a source holding 5 units of a product, and an empty destination. A patch
// replaces the source, the destination or the product (the foreign-key variants, and a Warehouse
// Admin's assigned source). Stock is put in the source that is used; for a random or foreign
// source the insert may fail or be pointless, and the request is refused anyway, so it is ignored.
async function transferBody(world, { fromWarehouseId, toWarehouseId, productId } = {}) {
  const from = fromWarehouseId ?? (await world.createWarehouse("A"));
  const product = await world.createProduct("A");
  await createStockLevel(world.organizations.A, from, product, 5).catch(() => {});
  return {
    fromWarehouseId: from,
    toWarehouseId: toWarehouseId ?? (await world.createWarehouse("A")),
    items: [{ productId: productId ?? product, quantity: 1 }],
  };
}

// Added by the story that adds the route (rule 16): warehouses in E3-01, products in E3-04.
const TENANT_ENDPOINTS = [
  { method: "get", path: "/api/warehouses", kind: "list", action: "warehouse.read", listQuery: { pageSize: 100 }, ...warehouse },
  {
    method: "get",
    path: "/api/warehouses/:id",
    kind: "item",
    action: "warehouse.read",
    // The detail of a warehouse is open to a Warehouse Admin or Viewer only when it is assigned.
    warehouseScoped: { request: async (world, warehouseId) => ({ id: warehouseId }) },
    ...warehouse,
  },
  {
    method: "post",
    path: "/api/warehouses",
    kind: "create",
    action: "warehouse.manage",
    // A new code every time: the same body twice would be a 409, not a valid request.
    body: () => ({ code: `NEW-${Math.random().toString(36).slice(2, 10)}`, name: "Gudang Baru" }),
    ...warehouse,
  },
  {
    method: "patch",
    path: "/api/warehouses/:id",
    kind: "item",
    action: "warehouse.manage",
    body: () => ({ name: "Nama Baru" }),
    ...warehouse,
  },
  // The assignment of a warehouse (E3-07): the row in the URL is the warehouse.
  { method: "get", path: "/api/warehouses/:id/members", kind: "item", action: "member.manage", ...warehouse },
  {
    method: "put",
    path: "/api/warehouses/:id/members",
    kind: "item",
    action: "member.manage",
    body: () => ({ userIds: [] }),
    // A user of organization B in the list is answered exactly like a user that does not exist.
    foreignBodies: [
      {
        key: "userIds",
        createForeign: async (world) => ({ id: world.users.B.VIEWER.id }),
        body: (world, id) => ({ userIds: [id] }),
      },
    ],
    ...warehouse,
  },
  // The stock summary (E4-06). The answer shows warehouse and product ids, not the stock row's id,
  // so `createRow` makes a warehouse with a stocked product and returns the WAREHOUSE id: the list
  // check looks for it in A's answer and must not find B's.
  {
    method: "get",
    path: "/api/stock",
    kind: "list",
    action: "stock.read",
    listQuery: { pageSize: 100 },
    warehouseScoped: { request: async (world, warehouseId) => ({ query: { warehouseId } }) },
    createRow: async (world, organization) => {
      const warehouseId = await world.createWarehouse(organization);
      const productId = await world.createProduct(organization);
      await createStockLevel(world.organizations[organization], warehouseId, productId, 5);
      return { id: warehouseId };
    },
    readRow: rawRow("Warehouses"),
  },
  // The history (E4-07). It has no warehouseScoped: a warehouse out of reach is an empty list, not
  // a 403, so the "unassigned warehouse is 403" check does not apply. A cursor holding B's id is
  // not a cursor at all (400); it must never return a row of B.
  {
    method: "get",
    path: "/api/stock/movements",
    kind: "list",
    action: "history.read",
    supportsCursor: true,
    ...movement,
  },
  // One movement (E4-08): another organization's id, a missing one, a malformed one and one in a
  // warehouse out of reach are the same 404. No warehouseScoped: that case is a 404, not a 403.
  { method: "get", path: "/api/stock/movements/:id", kind: "item", action: "history.read", ...movement },
  // Stock receipt (E4-02). The row the endpoint creates is a movement; the warehouse is what a
  // foreign key must be tried on, so `createRow` makes a warehouse (the default for foreignBodies).
  {
    method: "post",
    path: "/api/stock/receive",
    kind: "create",
    action: "stock.receive",
    idempotent: true,
    body: (world) => stockBody(world),
    // Every key of the body that ends in "Id" has one variant (the rule below enforces it): a
    // warehouse or product of B is answered exactly like a random UUID (403 for the warehouse,
    // which is authorized first, 404 for the product, which is looked up).
    foreignBodies: [
      { key: "warehouseId", body: (world, id) => stockBody(world, { warehouseId: id }) },
      {
        key: "productId",
        createForeign: async (world) => ({ id: await world.createProduct("B") }),
        body: (world, id) => stockBody(world, { productId: id }),
      },
    ],
    // A Warehouse Admin or Viewer works only in the warehouses assigned to them.
    warehouseScoped: { request: async (world, warehouseId) => ({ body: await stockBody(world, { warehouseId }) }) },
    createRow: async (world, organization) => ({ id: await world.createWarehouse(organization) }),
    readRow: rawRow("StockMovements"),
    countRows: rawCount("StockMovements"),
  },
  // Stock adjustment (E4-04): the same shape as the receipt. SET to a different quantity each
  // time would be needed for a repeated body, but a replay never runs it again, and each body
  // makes its own warehouse and product (no stock row yet, so SET 5 is a change from 0).
  {
    method: "post",
    path: "/api/stock/adjust",
    kind: "create",
    action: "stock.adjust",
    idempotent: true,
    body: (world) => stockBody(world, { quantity: undefined, mode: "SET", value: 5, reason: "STOCK_OPNAME" }),
    foreignBodies: [
      { key: "warehouseId", body: (world, id) => stockBody(world, { quantity: undefined, mode: "SET", value: 5, reason: "STOCK_OPNAME", warehouseId: id }) },
      {
        key: "productId",
        createForeign: async (world) => ({ id: await world.createProduct("B") }),
        body: (world, id) => stockBody(world, { quantity: undefined, mode: "SET", value: 5, reason: "STOCK_OPNAME", productId: id }),
      },
    ],
    warehouseScoped: {
      request: async (world, warehouseId) => ({
        body: await stockBody(world, { quantity: undefined, mode: "SET", value: 5, reason: "STOCK_OPNAME", warehouseId }),
      }),
    },
    createRow: async (world, organization) => ({ id: await world.createWarehouse(organization) }),
    readRow: rawRow("StockMovements"),
    countRows: rawCount("StockMovements"),
  },
  // Stock transfer (E5-04). The body needs two warehouses, a product and stock in the source; the
  // role is judged against the SOURCE warehouse, so a Warehouse Admin's request uses the warehouse
  // that was assigned. The rows the endpoint creates are transfers (countRows), and the warehouse
  // is what a foreign key is tried on. A foreign source is answered like a random one (403), a
  // foreign destination or product like a random one (404).
  {
    method: "post",
    path: "/api/stock/transfers",
    kind: "create",
    action: "stock.transfer",
    idempotent: true,
    body: (world) => transferBody(world),
    foreignBodies: [
      { key: "fromWarehouseId", body: (world, id) => transferBody(world, { fromWarehouseId: id }) },
      { key: "toWarehouseId", body: (world, id) => transferBody(world, { toWarehouseId: id }) },
      {
        key: "productId",
        createForeign: async (world) => ({ id: await world.createProduct("B") }),
        body: (world, id) => transferBody(world, { productId: id }),
      },
    ],
    warehouseScoped: { request: async (world, warehouseId) => ({ body: await transferBody(world, { fromWarehouseId: warehouseId }) }) },
    createRow: async (world, organization) => ({ id: await world.createWarehouse(organization) }),
    readRow: rawRow("StockTransfers"),
    countRows: rawCount("StockTransfers"),
  },
  { method: "get", path: "/api/products", kind: "list", action: "product.read", listQuery: { pageSize: 100 }, ...product },
  { method: "get", path: "/api/products/:id", kind: "item", action: "product.read", ...product },
  {
    method: "post",
    path: "/api/products",
    kind: "create",
    action: "product.manage",
    // A new SKU every time: the same body twice would be a 409, not a valid request.
    body: () => ({ sku: `NEW-${Math.random().toString(36).slice(2, 10)}`, name: "Produk Baru", unit: "pcs" }),
    ...product,
  },
  {
    method: "patch",
    path: "/api/products/:id",
    kind: "item",
    action: "product.manage",
    body: () => ({ name: "Nama Baru" }),
    ...product,
  },
];

// Writes under stock/, transfers or imports (docs/06): each key of the body that ends in "Id" and
// holds a UUID needs a foreignBodies variant that replaces exactly that key, so a new stock
// endpoint cannot skip the foreign-key check. Returns the problems for one entry (empty = fine).
const STOCK_WRITE = /^\/api\/(stock|transfers|imports)(\/|$)/;
const UUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FOREIGN_MARK = "44444444-4444-4444-8444-444444444444";

async function foreignBodyProblems(entry, world) {
  if (entry.method === "get" || !STOCK_WRITE.test(entry.path)) return [];
  const body = (await entry.body?.(world)) ?? {};
  const idKeys = Object.keys(body).filter((key) => /Id$/.test(key) && typeof body[key] === "string" && UUID_VALUE.test(body[key]));
  const variants = entry.foreignBodies ?? [];
  const problems = [];
  for (const key of idKeys) {
    const variant = variants.find((v) => v.key === key);
    if (!variant) {
      problems.push(`${labelOf(entry)}: the body key "${key}" has no foreignBodies variant`);
      continue;
    }
    const changed = await variant.body(world, FOREIGN_MARK);
    if (changed[key] !== FOREIGN_MARK) problems.push(`${labelOf(entry)}: the "${key}" variant does not put the foreign id in "${key}"`);
    for (const other of idKeys.filter((k) => k !== key)) {
      if (changed[other] === FOREIGN_MARK) problems.push(`${labelOf(entry)}: the "${key}" variant also changes "${other}"`);
    }
  }
  return problems;
}

const METHODS = ["get", "post", "put", "patch", "delete"];
const KINDS = ["item", "list", "create"];
const TENANT_ROLES = ["OWNER", "WAREHOUSE_ADMIN", "VIEWER"];

// "GET /warehouses/:id": the label the route inspector gives (no "/api" prefix).
const labelOf = (entry) => `${entry.method.toUpperCase()} ${entry.path.replace(/^\/api/, "")}`;

// The tenant roles that may perform the entry's action, derived from the permission matrix, so the
// harness and the application cannot disagree about it.
const allowedRoles = (entry) => TENANT_ROLES.filter((role) => ACTIONS[entry.action].roles.includes(role));

// Returns a list of problems (empty = fine), so a bad entry is reported with all its faults at once.
function validateEntry(entry) {
  const problems = [];
  if (!METHODS.includes(entry.method)) problems.push("method must be one of get, post, put, patch, delete");
  if (typeof entry.path !== "string" || !entry.path.startsWith("/api/")) problems.push('path must start with "/api/"');
  if (!KINDS.includes(entry.kind)) problems.push("kind must be item, list or create");
  if (!Object.hasOwn(ACTIONS, entry.action)) problems.push("action must be an action of helpers/permissions.js");
  if (typeof entry.createRow !== "function") problems.push("createRow is required");
  if (typeof entry.readRow !== "function") problems.push("readRow is required");

  const hasId = typeof entry.path === "string" && entry.path.includes(":id");
  if (entry.kind === "item" && !hasId) problems.push('an item entry needs ":id" in its path');
  if (entry.kind !== "item" && hasId) problems.push('only an item entry may have ":id" in its path');
  if (entry.kind === "list" && entry.method !== "get") problems.push("a list entry must use get");
  if (entry.kind === "create" && entry.method !== "post") problems.push("a create entry must use post");
  if (entry.kind === "item" && entry.method === "post") problems.push("an item entry cannot use post");
  if (entry.supportsCursor && entry.kind !== "list") problems.push("supportsCursor only fits a list entry");
  if ((entry.kind === "create" || entry.idempotent) && typeof entry.countRows !== "function") {
    problems.push("countRows is required for a create entry and for an idempotent one");
  }
  if (entry.idempotent && entry.method === "get") problems.push("a get entry cannot be idempotent");
  if (entry.foreignBodies) {
    if (!Array.isArray(entry.foreignBodies) || entry.foreignBodies.some((f) => !f.key || typeof f.body !== "function" || (f.createForeign && typeof f.createForeign !== "function"))) {
      problems.push("foreignBodies must be a list of { key, body(world, id), createForeign? }");
    }
  }
  if (entry.warehouseScoped && typeof entry.warehouseScoped.request !== "function") {
    problems.push("warehouseScoped must be { request(world, warehouseId) }");
  }
  return problems;
}

module.exports = { TENANT_ENDPOINTS, TENANT_ROLES, labelOf, allowedRoles, validateEntry, foreignBodyProblems };
