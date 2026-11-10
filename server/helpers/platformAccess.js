const { Organization } = require("../models");

// The ONLY place that reads organizations across tenants: there is no organizationId filter here on
// purpose. It is used by the Platform admin routes (/api/platform/*) and by nothing else; those
// routes are behind requirePlatformAdmin, which runs before any of these calls. Tenant routes must
// never import this file (a static test checks it). Keep it small: every function here sees all tenants.

// One page of organizations, newest first, each with its subscription and plan name (the include is
// a left join: an organization without a subscription is still listed). `limit` and `offset` come
// from validated pagination. The associations are named, so no other model is imported here.
const findOrganizations = ({ limit, offset }) =>
  Organization.findAndCountAll({
    attributes: ["id", "name", "slug", "status", "createdAt"],
    include: [
      {
        association: "Subscription",
        attributes: ["currentPeriodEnd"],
        required: false,
        include: [{ association: "Plan", attributes: ["name"] }],
      },
    ],
    distinct: true,
    order: [["createdAt", "DESC"], ["id", "ASC"]],
    limit,
    offset,
  });

// One organization by ID, whoever owns it. Null when it does not exist.
const findOrganizationById = (id) =>
  Organization.findByPk(id, {
    attributes: ["id", "name", "slug", "address", "status", "createdAt"],
  });

module.exports = { findOrganizations, findOrganizationById };
