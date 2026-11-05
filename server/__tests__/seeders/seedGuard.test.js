const { Sequelize } = require("sequelize");
const { assertSeedAllowed, isLocalHost } = require("../../helpers/seedGuard");
const plans = require("../../seeders/20261105000100-plans");
const baseAccounts = require("../../seeders/20261105000200-base-accounts");

// A fake URL: Sequelize connects lazily, so nothing leaves this computer.
const FAKE_URL =
  "postgres://admin:s3cret-pass@db.fake-project.supabase.co:5432/postgres";
const fakeRemote = () =>
  new Sequelize(FAKE_URL, { dialect: "postgres", logging: false });

describe("isLocalHost", () => {
  it.each(["localhost", "127.0.0.1", "::1", "/var/run/postgresql", undefined])(
    "treats %s as local",
    (host) => {
      expect(isLocalHost(host)).toBe(true);
    },
  );

  it.each(["db.fake-project.supabase.co", "10.0.0.5", "localhost.example.com"])(
    "treats %s as remote",
    (host) => {
      expect(isLocalHost(host)).toBe(false);
    },
  );
});

describe("assertSeedAllowed", () => {
  it("refuses a remote host by default", () => {
    expect(() => assertSeedAllowed(fakeRemote(), false)).toThrow(
      /Refusing to seed/,
    );
  });

  it("names the host but never the password or the user", () => {
    expect(() => assertSeedAllowed(fakeRemote(), false)).toThrow(
      expect.objectContaining({
        message: expect.stringContaining("db.fake-project.supabase.co"),
      }),
    );
    expect(() => assertSeedAllowed(fakeRemote(), false)).toThrow(
      expect.objectContaining({
        message: expect.not.stringMatching(/s3cret-pass|admin/),
      }),
    );
  });

  it("allows a remote host when SEED_ALLOW_REMOTE is true", () => {
    expect(() => assertSeedAllowed(fakeRemote(), true)).not.toThrow();
  });

  it("allows the local test database", () => {
    const local = new Sequelize("postgres://u@localhost:5432/simpul_test", {
      dialect: "postgres",
      logging: false,
    });

    expect(() => assertSeedAllowed(local, false)).not.toThrow();
  });
});

describe.each([
  ["plans", plans],
  ["base accounts", baseAccounts],
])("%s seeder against a fake remote database", (_name, seeder) => {
  it.each(["up", "down"])(
    "refuses %s before it sends any query",
    async (direction) => {
      const sequelize = fakeRemote();
      const queryInterface = { sequelize };
      sequelize.query = jest.fn();

      await expect(seeder[direction](queryInterface)).rejects.toThrow(
        /Refusing to seed/,
      );
      expect(sequelize.query).not.toHaveBeenCalled();
    },
  );
});
