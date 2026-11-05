const { Op } = require("sequelize");
const db = require("../models");

// The only door to tenant data (docs/05, decision 2). Controllers and services never touch a model
// directly: they call tenant(req.ctx).<Model>.<method>, and the organization filter is added here,
// so forgetting it is not possible. Only these seven methods exist on purpose: there is no destroy
// and no raw query, so nothing can skip the filter. Add a method here, with a test, when a story
// really needs it (bulkCreate came with the transfer, which writes two movements per item at once).

// AND, never a merge of keys: if the caller also filters on `organizationId` (by mistake or on
// purpose), both conditions must hold, so the row of another organization can never match.
const scopeWhere = (where, organizationId) => ({
  [Op.and]: [where ?? {}, { organizationId }],
});

function scopeModel(Model, organizationId) {
  const scoped = (options = {}) => ({ ...options, where: scopeWhere(options.where, organizationId) });

  return {
    findAll: (options) => Model.findAll(scoped(options)),
    findOne: (options) => Model.findOne(scoped(options)),
    count: (options) => Model.count(scoped(options)),

    // findByPk with a scope is a findOne on the primary key. A row of another organization is
    // simply not found (null), the same answer as an ID that does not exist.
    findByPk: (id, options = {}) => {
      if (id === null || id === undefined) return Promise.resolve(null);
      return Model.findOne(scoped({ ...options, where: { [Model.primaryKeyAttribute]: id } }));
    },

    // The organization is written after the caller's values, so it always comes from the context.
    create: (values, options) => Model.create({ ...values, organizationId }, options),

    // Every row gets the organization from the context, after its own values, like create.
    bulkCreate: (rows, options) => Model.bulkCreate(rows.map((values) => ({ ...values, organizationId })), options),

    // `organizationId` is removed from the values so an update can never move a row to another
    // organization; the where is scoped, so a row of another organization is never touched.
    update: (values, options) => {
      const { organizationId: _ignored, ...rest } = values;
      return Model.update(rest, scoped(options));
    },
  };
}

// Only models that have an `organizationId` column are tenant data. Plan and WebhookEvent are
// global and Organization is the tenant itself, so none of them is offered here.
const TENANT_MODELS = Object.keys(db).filter((name) => db[name]?.rawAttributes?.organizationId);

function tenant(ctx) {
  if (!ctx?.organizationId) {
    // A programming error, not a client error: a route that reaches here without an organization
    // (for example a Platform admin) must be stopped by authorization first.
    throw new Error("tenant(ctx) needs ctx.organizationId");
  }
  return Object.freeze(
    Object.fromEntries(TENANT_MODELS.map((name) => [name, scopeModel(db[name], ctx.organizationId)])),
  );
}

module.exports = { tenant, scopeModel, scopeWhere };
