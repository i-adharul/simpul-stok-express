const { internalError, planLimitReached } = require("../helpers/errors");
const organizationAccess = require("../helpers/organizationAccess");
const { tenant } = require("../helpers/tenantScope");

// Plan limits (BL20): what an organization uses, what its plan allows, and a check that refuses an
// addition above the limit. It knows nothing about HTTP and, by design, nothing about stock: stock
// services may call it, it never calls them (dependency direction, CLAUDE.md).
//
// A resource is one of these names everywhere (usage, limits, errors): WAREHOUSE, PRODUCT, MEMBER.

const RESOURCES = Object.freeze(["WAREHOUSE", "PRODUCT", "MEMBER"]);
const STARTER = "Starter";

// Non-archived warehouses and products, and ACTIVE users (the Owner included, pending invitations
// not). `tenant({ organizationId })` adds the organization filter, so another organization is never
// counted. `options` may carry the `transaction` that holds the organization lock.
async function getUsage(organizationId, options = {}) {
  const scoped = tenant({ organizationId });
  const [WAREHOUSE, PRODUCT, MEMBER] = await Promise.all([
    scoped.Warehouse.count({ where: { archivedAt: null }, ...options }),
    scoped.Product.count({ where: { archivedAt: null }, ...options }),
    scoped.User.count({ where: { isActive: true }, ...options }),
  ]);
  return { WAREHOUSE, PRODUCT, MEMBER };
}

const toLimits = (plan) => ({
  WAREHOUSE: plan.maxWarehouses,
  PRODUCT: plan.maxProducts,
  MEMBER: plan.maxMembers,
});

// The limits of the organization's current plan: Subscription, then Plan. A trial subscription
// points at Starter (BL04), so a trial is held to the Starter limits without a special case. An
// organization without a subscription is treated like a trial (Starter), the strictest plan, so a
// missing row never opens a limit. A missing Starter plan means broken seed data: a 500, not a guess.
async function getPlanLimits(organizationId, options = {}) {
  const plan =
    (await organizationAccess.findPlanOf(organizationId, options)) ??
    (await organizationAccess.findPlanByName(STARTER, options.transaction));
  if (!plan) throw internalError();
  return toLimits(plan);
}

// The limits that apply right now. For now this is the plan's own limit; E9-11 lowers it while an
// unpaid downgrade request exists (BL20), and every caller already goes through here.
const getEffectiveLimits = (organizationId, options = {}) => getPlanLimits(organizationId, options);

const LABEL = Object.freeze({ WAREHOUSE: "gudang", PRODUCT: "produk", MEMBER: "anggota" });

// Refuses ONE more WAREHOUSE, PRODUCT or MEMBER when the organization already uses its whole limit:
// used >= limit means the addition would exceed it. 403 PLAN_LIMIT_REACHED with
// `details: { resource, limit, used }` and an Indonesian message. Must run inside the caller's
// transaction, and the caller writes in that same transaction right after: usage is only meaningful
// while nobody else can add in between (the organization lock, below). Pending invitations are not
// counted; they are checked again when accepted.
async function assertWithinLimit(organizationId, resource, { transaction } = {}) {
  if (!transaction) throw new Error("assertWithinLimit must run inside a transaction");
  if (!RESOURCES.includes(resource)) throw new Error(`Unknown plan resource: ${resource}`);

  const options = { transaction };
  const [usage, limits] = await Promise.all([
    getUsage(organizationId, options),
    getEffectiveLimits(organizationId, options),
  ]);
  const used = usage[resource];
  const limit = limits[resource];
  if (used >= limit) {
    throw planLimitReached(`Batas ${LABEL[resource]} pada paket Anda sudah tercapai (${used} dari ${limit}).`, {
      resource,
      limit,
      used,
    });
  }
}

module.exports = { RESOURCES, getUsage, getPlanLimits, getEffectiveLimits, assertWithinLimit };
