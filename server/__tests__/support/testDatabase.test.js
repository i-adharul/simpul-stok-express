const { assertTestDatabase, databaseName } = require("./testDatabase");

describe("databaseName", () => {
  it("reads the name from the path of the URL", () => {
    expect(databaseName("postgres://u:p@localhost:5432/simpul_test")).toBe(
      "simpul_test",
    );
  });

  it("ignores the query string", () => {
    expect(
      databaseName("postgres://u@localhost:5432/simpul_test?sslmode=require"),
    ).toBe("simpul_test");
  });
});

describe("assertTestDatabase", () => {
  it("accepts a name that ends in _test", () => {
    expect(() =>
      assertTestDatabase("postgres://u@localhost:5432/simpul_test"),
    ).not.toThrow();
  });

  it("refuses the development database", () => {
    expect(() =>
      assertTestDatabase("postgres://u@localhost:5432/simpul_dev"),
    ).toThrow(/_test/);
  });

  it("refuses a name that only contains test", () => {
    expect(() =>
      assertTestDatabase("postgres://u@localhost:5432/test_simpul"),
    ).toThrow();
  });

  it("refuses a URL without a database name", () => {
    expect(() => assertTestDatabase("postgres://u@localhost:5432")).toThrow();
  });

  it("refuses an unparsable URL", () => {
    expect(() => assertTestDatabase("not a url")).toThrow();
  });

  it("names the database but never prints the password", () => {
    let message = "";
    try {
      assertTestDatabase("postgres://u:s3cret@localhost:5432/simpul_dev");
    } catch (error) {
      message = error.message;
    }
    expect(message).toContain("simpul_dev");
    expect(message).not.toContain("s3cret");
  });
});
