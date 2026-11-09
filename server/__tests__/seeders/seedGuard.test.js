const { Sequelize } = require("sequelize");
const {
  assertSeedAllowed,
  isLocalHost,
  resolveSeedPassword,
} = require("../../helpers/seedGuard");
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

describe("resolveSeedPassword", () => {
  const DEMO = "Simpul-Demo-2026";
  const STRONG = "Kd9-vR4wQz-77-prod";
  const local = () =>
    new Sequelize("postgres://u@localhost:5432/simpul_dev", {
      dialect: "postgres",
      logging: false,
    });

  it("falls back to the public demo password on a local database", () => {
    expect(resolveSeedPassword(local(), { seedPassword: null, demoPassword: DEMO })).toBe(DEMO);
  });

  it("uses SEED_PASSWORD on a local database when it is set", () => {
    expect(resolveSeedPassword(local(), { seedPassword: STRONG, demoPassword: DEMO })).toBe(STRONG);
  });

  it("uses a strong SEED_PASSWORD on a remote database", () => {
    expect(resolveSeedPassword(fakeRemote(), { seedPassword: STRONG, demoPassword: DEMO })).toBe(STRONG);
  });

  it("refuses a remote database without SEED_PASSWORD", () => {
    expect(() =>
      resolveSeedPassword(fakeRemote(), { seedPassword: null, demoPassword: DEMO }),
    ).toThrow(/SEED_PASSWORD/);
  });

  it("refuses the public demo password on a remote database", () => {
    expect(() =>
      resolveSeedPassword(fakeRemote(), { seedPassword: DEMO, demoPassword: DEMO }),
    ).toThrow(/public demo password/);
  });

  it("refuses a weak SEED_PASSWORD on a remote database without echoing it", () => {
    expect(() =>
      resolveSeedPassword(fakeRemote(), { seedPassword: "password123", demoPassword: DEMO }),
    ).toThrow(expect.objectContaining({ message: expect.not.stringContaining("password123") }));
  });
});

describe("base accounts seeder password", () => {
  it("hashes SEED_PASSWORD, not the demo password, when it is set", async () => {
    const bcrypt = require("bcryptjs");
    const sequelize = new Sequelize("postgres://u@localhost:5432/x", { dialect: "postgres", logging: false });
    const hashes = [];
    sequelize.query = jest.fn(async (sql, options) => {
      if (options?.replacements?.passwordHash) hashes.push(options.replacements.passwordHash);
      if (/SELECT/.test(sql)) return [[{ id: "00000000-0000-0000-0000-000000000001" }]];
      return [[]];
    });
    process.env.SEED_PASSWORD = "Kd9-vR4wQz-77-prod";
    let seeder;
    jest.isolateModules(() => {
      seeder = require("../../seeders/20261105000200-base-accounts");
    });
    delete process.env.SEED_PASSWORD;

    await seeder.up({ sequelize });

    expect(hashes.length).toBeGreaterThan(0);
    expect(await bcrypt.compare("Kd9-vR4wQz-77-prod", hashes[0])).toBe(true);
    expect(await bcrypt.compare("Simpul-Demo-2026", hashes[0])).toBe(false);
  });
});
