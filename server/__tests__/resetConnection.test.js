const { resolveResetConnection } = require("../helpers/resetConnection");

const APP = "postgres://simpul_app.abcdref:secret1@pooler.example.com:5432/postgres";
const RESET = "postgres://simpul_reset.abcdref:secret2@pooler.example.com:5432/postgres";

describe("resolveResetConnection (ADR 0017)", () => {
  it("returns the reset URL when it is set and the user differs from the application's", () => {
    expect(resolveResetConnection({ nodeEnv: "production", resetUrl: RESET, appUrl: APP })).toBe(RESET);
  });

  it("requires the reset URL in production", () => {
    expect(() => resolveResetConnection({ nodeEnv: "production", resetUrl: null, appUrl: APP })).toThrow(/DEMO_RESET_DATABASE_URL is required/);
  });

  it("returns null outside production when the URL is not set, so the script uses the database NODE_ENV picks", () => {
    expect(resolveResetConnection({ nodeEnv: "development", resetUrl: null, appUrl: APP })).toBeNull();
  });

  it("refuses the application's own user, in any environment", () => {
    const sameUser = "postgres://simpul_app.abcdref:other@other-host:5432/postgres";
    expect(() => resolveResetConnection({ nodeEnv: "production", resetUrl: sameUser, appUrl: APP })).toThrow(/same database user/);
    expect(() => resolveResetConnection({ nodeEnv: "development", resetUrl: APP, appUrl: APP })).toThrow(/same database user/);
  });

  it("never puts a password in an error message", () => {
    try {
      resolveResetConnection({ nodeEnv: "production", resetUrl: APP, appUrl: APP });
    } catch (error) {
      expect(error.message).not.toContain("secret1");
    }
  });
});
