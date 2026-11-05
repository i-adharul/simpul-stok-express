const {
  createDatabaseCheck,
  UP_TTL_MS,
  DOWN_TTL_MS,
  PING_TIMEOUT_MS,
} = require("../helpers/databaseHealth");

// A clock the test moves by hand, so no test waits for real time.
const makeClock = () => {
  let time = 1_000_000;
  return { now: () => time, advance: (ms) => (time += ms) };
};

describe("createDatabaseCheck", () => {
  it("reports up with the latency when the ping succeeds", async () => {
    const clock = makeClock();
    const check = createDatabaseCheck(async () => clock.advance(7), {
      now: clock.now,
    });

    expect(await check()).toEqual({ status: "up", latencyMs: 7 });
  });

  it("reports down, without any error text, when the ping fails", async () => {
    const onFailure = jest.fn();
    const check = createDatabaseCheck(
      async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2");
      },
      { onFailure },
    );
    const result = await check();

    expect(result).toEqual({ status: "down" });
    expect(JSON.stringify(result)).not.toMatch(
      /ECONNREFUSED|10\.0\.0\.5|hunter2/,
    );
    expect(onFailure).toHaveBeenCalledTimes(1);
  });

  it("caches an up result for 60 seconds", async () => {
    const clock = makeClock();
    const ping = jest.fn(async () => {});
    const check = createDatabaseCheck(ping, { now: clock.now });

    await check();
    clock.advance(UP_TTL_MS - 1);
    await check();
    expect(ping).toHaveBeenCalledTimes(1);

    clock.advance(1);
    await check();
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it("caches a down result for only 15 seconds", async () => {
    const clock = makeClock();
    const ping = jest
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue();
    const check = createDatabaseCheck(ping, { now: clock.now });

    expect(await check()).toEqual({ status: "down" });
    clock.advance(DOWN_TTL_MS - 1);
    expect(await check()).toEqual({ status: "down" });
    expect(ping).toHaveBeenCalledTimes(1);

    clock.advance(1);
    expect((await check()).status).toBe("up");
    expect(ping).toHaveBeenCalledTimes(2);
  });

  it("lets callers that arrive during a running check share it", async () => {
    let finish;
    const ping = jest.fn(() => new Promise((resolve) => (finish = resolve)));
    const check = createDatabaseCheck(ping);

    const results = [check(), check(), check()];
    finish();

    expect((await Promise.all(results)).map((r) => r.status)).toEqual([
      "up",
      "up",
      "up",
    ]);
    expect(ping).toHaveBeenCalledTimes(1);
  });

  describe("when the database does not answer", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("reports down after the timeout instead of hanging", async () => {
      const check = createDatabaseCheck(() => new Promise(() => {}));
      const pending = check();
      await jest.advanceTimersByTimeAsync(PING_TIMEOUT_MS);

      expect(await pending).toEqual({ status: "down" });
    });
  });
});
