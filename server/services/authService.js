const { comparePassword, hashPassword } = require("../helpers/bcrypt");
const {
  invalidCredentials,
  invalidCurrentPassword,
  unauthenticated,
  validationError,
} = require("../helpers/errors");
const { signToken } = require("../helpers/jwt");
const { validatePassword } = require("../helpers/password");
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

module.exports = { login, changePassword };
