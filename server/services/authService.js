const { UniqueConstraintError } = require("sequelize");
const env = require("../config/env");
const { comparePassword, hashPassword } = require("../helpers/bcrypt");
const {
  conflict,
  invalidCredentials,
  invalidCurrentPassword,
  notFound,
  unauthenticated,
  validationError,
} = require("../helpers/errors");
const invitationAccess = require("../helpers/invitationAccess");
const { signToken } = require("../helpers/jwt");
const { validatePassword } = require("../helpers/password");
const { inTransaction } = require("../helpers/transaction");
const { tenant } = require("../helpers/tenantScope");
const { lockWarehouse } = require("./warehouseLock");
const invitationService = require("./invitationService");
const { assertWithinLimit, lockOrganization } = require("./planLimitService");
const {
  findUserByEmail,
  findUserWithPasswordHash,
  savePassword,
  touchLastLogin,
} = require("../helpers/userAccess");

// A hash that matches no real password. When the email is unknown we still run one bcrypt
// compare against it, so "unknown email" does not answer much faster than "wrong password" and
// the response time does not reveal which emails exist. Created once, on first use.
let dummyHash;
const getDummyHash = () => (dummyHash ??= hashPassword("not-a-real-password-0"));

const publicUser = ({ id, name, email, role }) => ({ id, name, email, role });
const redirectFor = (role) => (role === "PLATFORM_ADMIN" ? "/platform" : "/dashboard");

// BL01. `email` is already trimmed and lowercase (loginSchema). Every failure throws the same
// INVALID_CREDENTIALS error: unknown email, wrong password, inactive user, password over 72 bytes.
async function login({ email, password }) {
  const user = await findUserByEmail(email);
  const matches = await comparePassword(
    password,
    user ? user.passwordHash : await getDummyHash(),
  );

  // The password is checked before the status, so an inactive account answers like any other failure.
  if (!user || !matches || !user.isActive) throw invalidCredentials();

  await touchLastLogin(user.id);
  return {
    token: signToken(user.id),
    user: publicUser(user),
    redirectTo: redirectFor(user.role),
  };
}

// BL31. Which environment variable holds the email of each demo role. The role comes from the request
// (already one of three values, demoLoginSchema); the email never does.
const DEMO_EMAIL_KEY = {
  OWNER: "DEMO_OWNER_EMAIL",
  WAREHOUSE_ADMIN: "DEMO_ADMIN_EMAIL",
  VIEWER: "DEMO_VIEWER_EMAIL",
};
const DEMO_TOKEN_LIFETIME = "8h"; // BL31 says 8 hours, whatever JWT_EXPIRES_IN is

// BL31, ADR 0016. A token for the configured account of the role, without a password. Every refusal is
// the same 404: demo mode off (also checked by the middleware before validate), no such account, an
// inactive one, or an account that does not hold the role it is configured for (so a wrong email in the
// configuration, even the platform admin's, can never be signed in through this door).
async function demoLogin({ role }) {
  if (!env.DEMO_MODE) throw notFound();
  const email = env[DEMO_EMAIL_KEY[role]];
  const user = email ? await findUserByEmail(email) : null;
  if (!user || !user.isActive || user.role !== role) throw notFound();

  await touchLastLogin(user.id);
  return {
    token: signToken(user.id, DEMO_TOKEN_LIFETIME),
    user: publicUser(user),
    redirectTo: redirectFor(user.role),
  };
}

// BL01. The caller is already authenticated, so `userId` is trusted. Order matters (docs/04): the
// current password is verified first, and only then are the rules applied to the new one, so a
// stranger holding a stolen token cannot probe the password rules.
async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await findUserWithPasswordHash(userId);
  // Deleted between the authentication check and here: treat it like any lost session.
  if (!user) throw unauthenticated();

  if (!(await comparePassword(currentPassword, user.passwordHash))) {
    throw invalidCurrentPassword();
  }

  const check = validatePassword(newPassword, { email: user.email });
  if (!check.valid) {
    throw validationError(
      [{ source: "body", path: "newPassword", message: check.message }],
      check.message,
    );
  }

  const changedAt = new Date();
  await savePassword(user.id, await hashPassword(newPassword), changedAt);
  // Signed after the save: its `iat` is not older than `passwordChangedAt`, so it stays valid
  // while every token issued earlier (on any device) is refused by the authentication middleware.
  return { token: signToken(user.id) };
}

// The password rules (helpers/password.js) with the INVITED email, which only the invitation knows.
// Same 400 shape as the change of a password: the reason is the message.
function assertPasswordAllowed(password, email) {
  const check = validatePassword(password, { email });
  if (check.valid) return;
  throw validationError([{ source: "body", path: "password", message: check.message }], check.message);
}

const EMAIL_TAKEN = "Email sudah terdaftar.";

// Replaces ALL assignment rows of the user by the invitation's warehouses that are still active.
// Each warehouse is locked in ID order (the same order as every other writer, ADR 0013) and read
// again under the lock, so an archive that runs at the same moment cannot leave an assignment on an
// archived warehouse. Missing or archived ones are skipped: the person joins with what is left.
async function replaceAssignment(ctx, userId, warehouseIds, transaction) {
  const old = await tenant(ctx).UserWarehouse.findAll({ where: { userId }, transaction });
  for (const row of old) await row.destroy({ transaction });

  for (const warehouseId of [...warehouseIds].sort()) {
    const warehouse = await lockWarehouse(ctx, warehouseId, transaction);
    if (warehouse && !warehouse.archivedAt) {
      await tenant(ctx).UserWarehouse.create({ userId, warehouseId }, { transaction });
    }
  }
}

// An email that now belongs to ANY active user, to a user of another organization, or to an Owner or
// Platform admin is a 409 (docs/04). Only an inactive Warehouse Admin or Viewer of THIS organization
// is brought back, with the new name, password, role and assignment (BL06); `passwordChangedAt` makes
// every token that user held earlier stop working (BL01).
function canRejoin(user, organizationId) {
  return user.organizationId === organizationId && !user.isActive && ["WAREHOUSE_ADMIN", "VIEWER"].includes(user.role);
}

async function reactivate(ctx, user, invitation, { name, passwordHash }, now, transaction) {
  await tenant(ctx).User.update(
    { name, passwordHash, role: invitation.role, isActive: true, passwordChangedAt: now, lastLoginAt: now },
    { where: { id: user.id }, transaction },
  );
  return { id: user.id, name, email: user.email, role: invitation.role };
}

// A second organization may be accepting the same email at this very moment: the unique key of the
// email decides, and the loser gets the same 409.
async function createMember(ctx, invitation, { name, passwordHash }, now, transaction) {
  try {
    const user = await tenant(ctx).User.create(
      { email: invitation.email, name, passwordHash, role: invitation.role, lastLoginAt: now },
      { transaction },
    );
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  } catch (err) {
    if (err instanceof UniqueConstraintError) throw conflict(EMAIL_TAKEN);
    throw err;
  }
}

async function joinOrganization(invitation, credentials, transaction) {
  // The organization comes from the invitation row, which was found by the hash of the token and
  // locked: nothing from the request can choose it (rule 1).
  const ctx = { organizationId: invitation.organizationId };
  const now = new Date();
  const existing = await findUserByEmail(invitation.email, { transaction, lock: transaction.LOCK.UPDATE });

  // Who the email belongs to is judged first (409), then the member limit (403): both a new member and
  // a reactivated one become an ACTIVE user, so both are counted again here, under the organization
  // lock the caller holds (BL20, BL06).
  if (existing && !canRejoin(existing, invitation.organizationId)) throw conflict(EMAIL_TAKEN);
  await assertWithinLimit(invitation.organizationId, "MEMBER", { transaction });

  const user = existing
    ? await reactivate(ctx, existing, invitation, credentials, now, transaction)
    : await createMember(ctx, invitation, credentials, now, transaction);

  await replaceAssignment(ctx, user.id, invitation.warehouseIds, transaction);
  await invitationAccess.markAccepted(invitation.id, now, transaction);
  return user;
}

// BL06. A usable token is checked first (an invalid one is a 404 whatever the password is), then the
// password rules with the invited email (400). bcrypt runs before the transaction so no connection
// waits for it. Then ONE transaction locks the organization (plan limit) and the invitation row
// (FOR UPDATE) and judges the invitation again: of two simultaneous acceptances of one token, the second waits for the first to commit, sees
// `acceptedAt` and gets the same 404. The user, the assignment and `acceptedAt` commit together.
async function acceptInvite({ token, name, password }) {
  const first = await invitationService.findUsable(token);
  assertPasswordAllowed(password, first.email);
  const passwordHash = await hashPassword(password);

  const user = await inTransaction(async (transaction) => {
    // Lock order: the organization first (the plan limit), then the invitation row, then the user row
    // and the warehouses. The organization of `first` comes from the invitation found by the token hash,
    // never from the request; the invitation is judged again under its own lock right after.
    await lockOrganization(first.organizationId, transaction);
    const invitation = await invitationService.findUsable(token, { transaction, lock: transaction.LOCK.UPDATE });
    return joinOrganization(invitation, { name, passwordHash }, transaction);
  });

  // Signed after the commit; `iat` is not older than `passwordChangedAt`, so the new token is valid.
  return { token: signToken(user.id), user, redirectTo: "/dashboard" };
}

module.exports = { login, demoLogin, changePassword, acceptInvite };
