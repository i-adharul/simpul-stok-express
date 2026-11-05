const { runConcurrently } = require("./support/concurrency");

describe("runConcurrently", () => {
  it("starts every call before any of them has finished", async () => {
    const events = [];
    await runConcurrently(3, async (index) => {
      events.push(`start ${index}`);
      await new Promise((resolve) => setTimeout(resolve, 5 * (3 - index)));
      events.push(`end ${index}`);
    });

    expect(events.slice(0, 3)).toEqual(["start 0", "start 1", "start 2"]);
    expect(events.slice(3)).toEqual(["end 2", "end 1", "end 0"]);
  });

  it("returns the results in index order, whatever the order of finishing", async () => {
    const results = await runConcurrently(4, async (index) => {
      await new Promise((resolve) => setTimeout(resolve, 5 * (4 - index)));
      return index * 10;
    });

    expect(results).toEqual([0, 10, 20, 30]);
  });

  it("rejects when one call rejects", async () => {
    await expect(runConcurrently(2, async (index) => { if (index === 1) throw new Error("boom"); })).rejects.toThrow("boom");
  });

  it("refuses an n that is not a positive integer", () => {
    for (const n of [0, -1, 1.5, "3", undefined]) expect(() => runConcurrently(n, async () => {})).toThrow("positive integer");
  });
});
