const { Op } = require("sequelize");
const { conflict, notFound } = require("../helpers/errors");
const { findOwned } = require("../helpers/ownership");
const { pageBody, pageWindow } = require("../helpers/pagination");
const invitationAccess = require("../helpers/invitationAccess");
const { generateToken, hashToken } = require("../helpers/token");
const { inTransaction } = require("../helpers/transaction");
const { tenant } = require("../helpers/tenantScope");
const { findUserByEmail } = require("../helpers/userAccess");
const { assertWithinLimit, lockOrganization } = require("./planLimitService");

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
async function assertEmailFree(ctx, email, transaction) {
  // Read inside the caller's transaction: a read outside it would ask the pool for a SECOND connection
  // while this transaction holds one, and many simultaneous invitations could starve the pool.
  const user = await findUserByEmail(email, { transaction });
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
//
// BL20: the member limit is checked here too (active users are counted, pending invitations are not,
// and the limit is checked again when the invitation is accepted). The organization row is locked
// first (lock order: organization, then warehouses), which also makes two simultaneous invitations
// of one email run one after the other, so only one of them can pass the "no pending invitation" check.
function create(ctx, { email, role, warehouseIds }) {
  return inTransaction(async (transaction) => {
    await lockOrganization(ctx.organizationId, transaction);
    await assertWarehouses(ctx, warehouseIds, transaction);
    await assertEmailFree(ctx, email, transaction);
    await assertNoPending(ctx, email, transaction);
    await assertWithinLimit(ctx.organizationId, "MEMBER", { transaction });

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

// Pending and Expired invitations of the own organization, newest first. Accepted ones are history
// and are not listed. `tenant(ctx)` adds the organization filter, so another organization's rows
// can never appear.
async function list(ctx, query) {
  const where = { acceptedAt: null };
  const invitations = tenant(ctx).Invitation;
  const [total, rows] = await Promise.all([
    invitations.count({ where }),
    invitations.findAll({ where, order: [["createdAt", "DESC"], ["id", "DESC"]], ...pageWindow(query) }),
  ]);
  const now = new Date();
  return pageBody(rows.map((row) => toInvitation(row, now)), total, query);
}

// Cancels a Pending or Expired invitation by deleting its row (the link then stops working). A
// missing, foreign, malformed or already accepted one is the same 404 (rule 2). The row is read
// again under a lock, so a cancel and an acceptance at the same moment cannot both win: the
// acceptance locks the same row (E7-06).
function cancel(ctx, id) {
  return inTransaction(async (transaction) => {
    const invitation = await findOwned(ctx, "Invitation", id, { transaction, lock: transaction.LOCK.UPDATE });
    if (invitation.acceptedAt) throw notFound();
    await invitation.destroy({ transaction });
  });
}

// A token has exactly the shape generateToken() makes. Anything else cannot match a hash, so it is
// refused before hashing (no work for a garbage URL).
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

// The invitation behind a raw token, if it can still be accepted: it exists, is not used and has not
// expired. Malformed, unknown, expired and used tokens are ONE and the same 404 with the same body,
// so the answer never says which of them it was (BL06). Not tenant-scoped: no session exists yet.
async function findUsable(token, options = {}) {
  if (typeof token !== "string" || !TOKEN_SHAPE.test(token)) throw notFound();
  const invitation = await invitationAccess.findByTokenHash(hashToken(token), options);
  if (!invitation || statusOf(invitation) !== "PENDING") throw notFound();
  return invitation;
}

// Public: what the person who opens the link needs to see before choosing a password.
async function showByToken(token) {
  const invitation = await findUsable(token);
  return {
    email: invitation.email,
    role: invitation.role,
    organizationName: await invitationAccess.findOrganizationName(invitation.organizationId),
    expiresAt: invitation.expiresAt,
  };
}

module.exports = { create, list, cancel, showByToken, findUsable, statusOf, toInvitation, VALID_DAYS };
