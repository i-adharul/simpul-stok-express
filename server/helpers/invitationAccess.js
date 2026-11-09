const { Invitation, Organization } = require("../models");

// Accepting an invitation happens before any session exists: the only thing the caller holds is a
// token, so the organization is NOT known yet and these reads are not tenant-scoped on purpose (like
// helpers/userAccess.js). The token is looked up by its hash. Everything after the invitation is
// found uses the organization of the invitation row, never anything from the request.
// Keep this file small: every function here can see all tenants.

// `options` may carry `transaction` and `lock` (FOR UPDATE) for the accept flow.
const findByTokenHash = (tokenHash, options = {}) => Invitation.findOne({ where: { tokenHash }, ...options });

const findOrganizationName = async (organizationId, options = {}) =>
  (await Organization.findByPk(organizationId, { attributes: ["name"], ...options }))?.name ?? null;

const markAccepted = (id, acceptedAt, transaction) =>
  Invitation.update({ acceptedAt }, { where: { id }, transaction });

module.exports = { findByTokenHash, findOrganizationName, markAccepted };
