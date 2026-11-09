const { Organization, Plan, Subscription, User } = require("../models");

// Sign-up is the one place that writes an organization before one exists, so these calls are not
// tenant-scoped on purpose (like helpers/userAccess.js). Everything after sign-up goes through
// tenantScope. Keep this file small: every function here can see all tenants.
// Every function takes the transaction of the caller, so the three inserts commit or roll back together.

const findPlanByName = (name, transaction) => Plan.findOne({ where: { name }, transaction });

const insertOrganization = (values, transaction) => Organization.create(values, { transaction });

const insertUser = (values, transaction) => User.create(values, { transaction });

const insertSubscription = (values, transaction) => Subscription.create(values, { transaction });

// The organization of the caller. `organizationId` always comes from the request context (built from
// the user in the database), never from the URL or the body: there is no ID in /api/organization.
const findOrganization = (organizationId, options = {}) =>
  Organization.findByPk(organizationId, {
    attributes: ["id", "name", "slug", "address", "status", "createdAt"],
    ...options,
  });

const updateOrganization = (organizationId, values) =>
  Organization.update(values, { where: { id: organizationId } });

module.exports = {
  findPlanByName,
  insertOrganization,
  insertUser,
  insertSubscription,
  findOrganization,
  updateOrganization,
};
