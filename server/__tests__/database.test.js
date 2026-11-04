const { getSequelize } = require("./support/db");

describe("test database connection", () => {
  it("is connected to a database whose name ends in _test", async () => {
    const [rows] = await getSequelize().query(
      "SELECT current_database() AS name",
    );

    expect(rows[0].name).toMatch(/_test$/);
  });
});
