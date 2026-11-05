// Shared helpers of the mandatory stock tests (BL11, BL12, BL14, BL15): sending the stock writes,
// reading the stock and the ledger with raw SQL (so the proof does not depend on the code it
// checks), and a trigger that makes the movement insert fail on purpose.
const crypto = require("crypto");
const request = require("supertest");
const { getSequelize } = require("./db");

const sql = async (query, replacements) => (await getSequelize().query(query, { replacements }))[0];

const send = (app, world, path, body, { role = "OWNER", organization = "A", key } = {}) => {
  let req = request(app).post(path).set("Authorization", world.users[organization][role].authorization);
  if (key !== null) req = req.set("Idempotency-Key", key ?? crypto.randomUUID());
  return req.send(body);
};

const quantityOf = async (warehouseId, productId) =>
  (await sql(`SELECT quantity FROM "StockLevels" WHERE "warehouseId" = :warehouseId AND "productId" = :productId`, { warehouseId, productId }))[0]?.quantity;
const levelRows = async (warehouseId, productId) =>
  Number((await sql(`SELECT count(*) AS n FROM "StockLevels" WHERE "warehouseId" = :warehouseId AND "productId" = :productId`, { warehouseId, productId }))[0].n);
const movementRows = (warehouseId, productId) =>
  sql(`SELECT * FROM "StockMovements" WHERE "warehouseId" = :warehouseId AND "productId" = :productId ORDER BY "createdAt", id`, { warehouseId, productId });
const ledgerSum = async (warehouseId, productId) =>
  Number((await sql(`SELECT COALESCE(sum("quantityDelta"), 0) AS n FROM "StockMovements" WHERE "warehouseId" = :warehouseId AND "productId" = :productId`, { warehouseId, productId }))[0].n);
const keyRows = async () => Number((await sql(`SELECT count(*) AS n FROM "IdempotencyKeys"`))[0].n);

// While `body` runs, every insert into StockMovements fails inside the database. The stock row was
// written BEFORE the movement, so a stock write that were not one transaction would leave it behind.
async function withFailingMovementInsert(body) {
  await sql(`CREATE OR REPLACE FUNCTION fail_movement_insert() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'movement insert failed on purpose'; END; $$ LANGUAGE plpgsql`);
  await sql(`CREATE TRIGGER fail_movement_insert_trg BEFORE INSERT ON "StockMovements" FOR EACH ROW EXECUTE FUNCTION fail_movement_insert()`);
  try {
    return await body();
  } finally {
    await sql(`DROP TRIGGER IF EXISTS fail_movement_insert_trg ON "StockMovements"`);
    await sql(`DROP FUNCTION IF EXISTS fail_movement_insert()`);
  }
}

// While `body` runs, every INSERT of a stock row (StockLevels) fails inside the database. A transfer
// creates the destination row only AFTER every source row was decremented, so this is the way to
// make it fail exactly between the two halves (E5-02) without touching the code under test: no spy
// on a function name, so a refactor of the service cannot silently turn the test into a no-op.
// An UPDATE of an existing row is not affected, so the source decrement itself still succeeds.
async function withFailingStockLevelInsert(body) {
  await sql(`CREATE OR REPLACE FUNCTION fail_stock_level_insert() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'stock level insert failed on purpose'; END; $$ LANGUAGE plpgsql`);
  await sql(`CREATE TRIGGER fail_stock_level_insert_trg BEFORE INSERT ON "StockLevels" FOR EACH ROW EXECUTE FUNCTION fail_stock_level_insert()`);
  try {
    return await body();
  } finally {
    await sql(`DROP TRIGGER IF EXISTS fail_stock_level_insert_trg ON "StockLevels"`);
    await sql(`DROP FUNCTION IF EXISTS fail_stock_level_insert()`);
  }
}

module.exports = { sql, send, quantityOf, levelRows, movementRows, ledgerSum, keyRows, withFailingMovementInsert, withFailingStockLevelInsert };
