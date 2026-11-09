const { UniqueConstraintError } = require("sequelize");
const { hashPassword } = require("../helpers/bcrypt");
const { conflict, internalError } = require("../helpers/errors");
const { signToken } = require("../helpers/jwt");
const organizationAccess = require("../helpers/organizationAccess");
const { inTransaction } = require("../helpers/transaction");

// BL04. Sign-up knows nothing about HTTP: the controller passes the validated body.

const TRIAL_DAYS = 30;
const GRACE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const STARTER = "Starter";

// The unique constraints are the single source of truth for "email or slug is taken": the database
// decides, so two sign-ups racing for one email cannot both succeed. No check-then-insert.
// `details` has the shape of a validation detail, so the form can show it under the right field.
const TAKEN = {
  Users_email_key: { path: "email", message: "Email sudah terdaftar." },
  Organizations_slug_key: { path: "slug", message: "Slug sudah dipakai." },
};

function rethrowDuplicate(err) {
  const taken = err instanceof UniqueConstraintError ? TAKEN[err.parent?.constraint] : undefined;
  if (!taken) throw err;
  throw conflict(taken.message, [{ source: "body", ...taken }]);
}

// Trial period of BL04: 30 days, then 3 days of grace. `billingDay` stays empty until the first payment.
function trialPeriod(now) {
  const currentPeriodEnd = new Date(now.getTime() + TRIAL_DAYS * DAY_MS);
  return {
    currentPeriodStart: now,
    currentPeriodEnd,
    graceUntil: new Date(currentPeriodEnd.getTime() + GRACE_DAYS * DAY_MS),
  };
}

// The hash is made before the transaction starts, so the database connection is not held for the
// few hundred milliseconds bcrypt needs.
async function register({ organizationName, slug, name, email, password }) {
  const passwordHash = await hashPassword(password);
  const now = new Date();

  const { organization, owner } = await inTransaction(async (transaction) => {
    const plan = await organizationAccess.findPlanByName(STARTER, transaction);
    // The plans are seed data: a missing Starter plan is a broken deployment, not a client error.
    if (!plan) throw internalError();

    const organization = await organizationAccess
      .insertOrganization({ name: organizationName, slug, status: "TRIAL" }, transaction)
      .catch(rethrowDuplicate);
    const owner = await organizationAccess
      .insertUser({ organizationId: organization.id, email, name, passwordHash, role: "OWNER" }, transaction)
      .catch(rethrowDuplicate);
    await organizationAccess.insertSubscription(
      { organizationId: organization.id, planId: plan.id, ...trialPeriod(now) },
      transaction,
    );
    return { organization, owner };
  });

  return {
    token: signToken(owner.id),
    user: { id: owner.id, name: owner.name, email: owner.email, role: owner.role },
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      status: organization.status,
    },
    redirectTo: "/dashboard",
  };
}

module.exports = { register, TRIAL_DAYS, GRACE_DAYS };
