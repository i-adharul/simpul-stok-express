const { notFound } = require("./errors");
const { tenant } = require("./tenantScope");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Loads one row by an ID that came from the outside (a URL or a body) and proves it is the
// caller's. Three different situations get one and the same answer, 404 with the default message:
// the ID does not exist, it belongs to another organization, or it is not even a UUID. The caller
// can therefore never tell "someone else has this" from "nobody has this" (rule 2, BL03).
//
// `Model` is the model name ("Warehouse"), because controllers and services may not import models
// (rule 3); the class is accepted too. A model that is not tenant data is a programming error and
// throws a plain Error (500), never a 404 that would hide the bug.
async function findOwned(ctx, Model, id, options = {}) {
  const name = typeof Model === "string" ? Model : Model?.name;
  const scoped = tenant(ctx)[name];
  if (!scoped) throw new Error(`findOwned needs a tenant model, got: ${name}`);

  // Checked before the query: Postgres would raise "invalid input syntax for type uuid" (a 500)
  // for a value like "abc", and that error itself would tell the caller something.
  if (typeof id !== "string" || !UUID.test(id)) throw notFound();

  const row = await scoped.findByPk(id, options);
  if (!row) throw notFound();
  return row;
}

module.exports = { findOwned };
