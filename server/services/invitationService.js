const { Op } = require("sequelize");
const { conflict, notFound } = require("../helpers/errors");
const { generateToken, hashToken } = require("../helpers/token");
const { inTransaction } = require("../helpers/transaction");
const { tenant } = require("../helpers/tenantScope");
const { findUserByEmail } = require("../helpers/userAccess");

// BL05. Invitations are copied links, valid for 7 days and used once. The service knows nothing
// about HTTP: the controller passes the request context and the validated body.

const VALID_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// PENDING (usable), EXPIRED (past its time, still listed so the Owner can cancel it) or ACCEPTED
// (used; never listed). Derived from the row, never stored, so it cannot go out of date.
function statusOf(invitation, now = new Date()) {
  if (invitation.acceptedAt) return "ACCEPTED";
  return invitation.expiresAt <= now ? "EXPIRED" : "PENDING";
}

// The documented fields only: never `tokenHash`, and never the raw token (that one leaves the server
// once, in the response of create).
const toInvitation = (row, now) => ({
  id: row.id,
  email: row.email,
  role: row.role,
  warehouseIds: row.warehouseIds,
  expiresAt: row.expiresAt,
  status: statusOf(row, now),
});

// Who owns this email already? Not tenant-scoped on purpose: a user of ANOTHER organization must
// block the invitation too (one user belongs to one organization), so this goes through
// helpers/userAccess.js. Only an inactive member of the SAME organization may be invited again
// (the new acceptance reactivates that user, BL06). Anything else is a 409 with one message.
async function assertEmailFree(ctx, email) {
  const user = await findUserByEmail(email);
  if (!user) return;
  const sameOrganization = user.organizationId === ctx.organizationId;
  if (sameOrganization && !user.isActive) return;
  throw conflict("Email sudah terdaftar.", [{ source: "body", path: "email", message: "Email sudah terdaftar." }]);
}

// A pending invitation of THIS organization for the same email. Invitations of other organizations
// are not read: that clash is refused when the invitation is accepted (BL06), so this call can never
// tell the Owner that another organization invited the same person.
async function assertNoPending(ctx, email, transaction) {
  const pending = await tenant(ctx).Invitation.count({
    where: { email, acceptedAt: null, expiresAt: { [Op.gt]: new Date() } },
    transaction,
  });
  if (pending > 0) {
    throw conflict("Undangan untuk email ini masih berlaku.", [
      { source: "body", path: "email", message: "Undangan untuk email ini masih berlaku." },
    ]);
  }
}

// Every ID must be an ACTIVE warehouse of this organization. Missing, foreign and archived are one
// and the same 404, so the answer never says which of them it was (rule 2).
async function assertWarehouses(ctx, warehouseIds, transaction) {
  if (warehouseIds.length === 0) return;
  const found = await tenant(ctx).Warehouse.findAll({
    where: { id: { [Op.in]: warehouseIds }, archivedAt: null },
    attributes: ["id"],
    transaction,
  });
  if (found.length !== warehouseIds.length) throw notFound();
}

// The warehouses are checked first, then the email: a foreign warehouse ID is a 404 whatever the
// email is. Everything runs in one transaction, so the row is written only when every check passed.
// Returns the invitation and the raw token; the controller is the only place the token leaves.
function create(ctx, { email, role, warehouseIds }) {
  return inTransaction(async (transaction) => {
    await assertWarehouses(ctx, warehouseIds, transaction);
    await assertEmailFree(ctx, email);
    await assertNoPending(ctx, email, transaction);

    const token = generateToken();
    const now = new Date();
    const row = await tenant(ctx).Invitation.create(
      {
        email,
        role,
        warehouseIds,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + VALID_DAYS * DAY_MS),
        createdById: ctx.userId,
      },
      { transaction },
    );
    return { invitation: toInvitation(row, now), token };
  });
}

module.exports = { create, statusOf, toInvitation, VALID_DAYS };
