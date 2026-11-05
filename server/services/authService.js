const { comparePassword, hashPassword } = require("../helpers/bcrypt");
const { invalidCredentials } = require("../helpers/errors");
const { signToken } = require("../helpers/jwt");
const { findUserByEmail, touchLastLogin } = require("../helpers/userAccess");

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

module.exports = { login };
