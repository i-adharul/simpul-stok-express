const { buildDemoData } = require("../helpers/demoData");
const { PROFILES, DEMO_SLUGS, profileOf } = require("../helpers/demoProfiles");
const { wibDayRange } = require("../helpers/wibDay");

const NOW = new Date("2026-11-08T05:00:00Z"); // 12:00 WIB on 8 Nov 2026
const balancesOf = (demo) => {
  const map = new Map();
  for (const m of demo.movements) {
    const key = `${m.warehouseCode}|${m.sku}`;
    map.set(key, (map.get(key) ?? 0) + m.quantityDelta);
  }
  return map;
};

describe.each(PROFILES.map((profile) => [profile.slug, profile]))("the demo data of %s", (_slug, profile) => {
  const { warehouses: WAREHOUSES, products: PRODUCTS } = profile;
  const demo = buildDemoData(NOW, profile);
  const balances = () => balancesOf(demo);

  it("is 3 warehouses and 50 products with valid, unique codes and SKUs", () => {
    expect(WAREHOUSES).toHaveLength(3);
    expect(PRODUCTS).toHaveLength(50);
    expect(new Set(WAREHOUSES.map((w) => w.code)).size).toBe(3);
    expect(new Set(PRODUCTS.map((p) => p.sku)).size).toBe(50);
    for (const w of WAREHOUSES) expect(w.code).toBe(w.code.trim().toUpperCase());
    for (const p of PRODUCTS) {
      expect(p.sku).toMatch(/^[A-Z0-9-]+$/);
      expect(["bks", "ktk", "pcs", "btl", "jrg", "pak"]).toContain(p.unit);
      expect(Number.isInteger(p.minStock)).toBe(true);
      expect(p.minStock).toBeGreaterThanOrEqual(0);
    }
  });

  it("is the same every time for the same instant", () => {
    expect(buildDemoData(NOW, profile)).toEqual(demo);
  });

  it("has a stock level equal to the sum of the movements of its pair, never negative", () => {
    const sums = balances();
    expect(demo.levels.length).toBe(sums.size);
    for (const level of demo.levels) {
      expect(level.quantity).toBeGreaterThanOrEqual(0);
      expect(sums.get(`${level.warehouseCode}|${level.sku}`)).toBe(level.quantity);
    }
  });

  it("never lets a running balance go below zero when the movements are replayed in time order", () => {
    const running = new Map();
    const ordered = [...demo.movements].sort((a, b) => a.createdAt - b.createdAt);
    for (const m of ordered) {
      const key = `${m.warehouseCode}|${m.sku}`;
      const next = (running.get(key) ?? 0) + m.quantityDelta;
      expect(next).toBeGreaterThanOrEqual(0);
      running.set(key, next);
    }
  });

  it("respects the movement rules of the schema: sign by type, a reason only for ADJUST, a transfer only for transfers", () => {
    for (const m of demo.movements) {
      if (m.type === "TRANSFER_OUT") expect(m.quantityDelta).toBeLessThan(0);
      else if (m.type === "ADJUST") expect(m.quantityDelta).not.toBe(0);
      else expect(m.quantityDelta).toBeGreaterThan(0);
      expect(m.reason !== null).toBe(m.type === "ADJUST");
      expect(m.transferCode !== null).toBe(m.type === "TRANSFER_OUT" || m.type === "TRANSFER_IN");
    }
  });

  it("writes two movements per transfer that cancel each other, with codes MT-0001, MT-0002, ... in time order", () => {
    expect(demo.transfers.length).toBeGreaterThanOrEqual(5);
    demo.transfers.forEach((t, i) => expect(t.code).toBe(`MT-${String(i + 1).padStart(4, "0")}`));
    const times = demo.transfers.map((t) => t.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    for (const t of demo.transfers) {
      expect(t.fromWarehouseCode).not.toBe(t.toWarehouseCode);
      const parts = demo.movements.filter((m) => m.transferCode === t.code);
      const out = parts.filter((m) => m.type === "TRANSFER_OUT");
      const into = parts.filter((m) => m.type === "TRANSFER_IN");
      expect(out.length).toBeGreaterThan(0);
      expect(out.length).toBe(into.length);
      expect(parts.reduce((sum, m) => sum + m.quantityDelta, 0)).toBe(0);
    }
  });

  it("has history over about three weeks, nothing in the future, and movements on the WIB day of `now`", () => {
    const { from } = wibDayRange(NOW);
    const times = demo.movements.map((m) => m.createdAt.getTime());
    expect(Math.max(...times)).toBeLessThanOrEqual(NOW.getTime());
    expect(NOW.getTime() - Math.min(...times)).toBeGreaterThan(14 * 24 * 3600 * 1000);
    expect(demo.movements.filter((m) => m.createdAt >= from).length).toBeGreaterThanOrEqual(3);
    expect(demo.movements.length).toBeGreaterThan(150);
  });

  it("leaves a mix of OUT, LOW and OK pairs so the dashboard has something to show", () => {
    const minOf = new Map(PRODUCTS.map((p) => [p.sku, p.minStock]));
    const status = (l) => (l.quantity === 0 ? "OUT" : l.quantity < minOf.get(l.sku) ? "LOW" : "OK");
    const counts = demo.levels.reduce((acc, l) => ({ ...acc, [status(l)]: (acc[status(l)] ?? 0) + 1 }), {});
    expect(counts.OUT).toBeGreaterThanOrEqual(5);
    expect(counts.LOW).toBeGreaterThanOrEqual(5);
    expect(counts.OK).toBeGreaterThan(50);
  });

  it("does not stock every product in every warehouse, and the assigned warehouses own the movements of their admin", () => {
    expect(demo.levels.length).toBeLessThan(150);
    expect(demo.levels.length).toBeGreaterThan(50);
    for (const m of demo.movements) expect(["OWNER", "WAREHOUSE_ADMIN"]).toContain(m.by);
    // The Warehouse Admin is assigned to these only (see adminWarehouseCodes), so a movement by them is in one of them.
    for (const m of demo.movements.filter((x) => x.by === "WAREHOUSE_ADMIN")) {
      expect(demo.adminWarehouseCodes).toContain(m.warehouseCode);
    }
  });
});

describe("the demo profiles", () => {
  it("are two businesses with different slugs, names, warehouse codes and SKUs, and the first keeps its seed", () => {
    expect(DEMO_SLUGS).toEqual(["tokomaju", "kopisenja"]);
    const [first, second] = PROFILES;
    expect(first.seed).toBe(20261108);
    expect(second.name).toBe("Kopi Senja");
    const codes = (p) => p.warehouses.map((w) => w.code);
    const skus = (p) => p.products.map((x) => x.sku);
    expect(codes(first).some((c) => codes(second).includes(c))).toBe(false);
    expect(skus(first).some((s) => skus(second).includes(s))).toBe(false);
  });

  it("assign the admin and the viewer only to warehouses that exist in the same profile", () => {
    for (const p of PROFILES) {
      const codes = p.warehouses.map((w) => w.code);
      for (const code of [...p.adminWarehouseCodes, ...p.viewerWarehouseCodes]) expect(codes).toContain(code);
    }
  });

  it("make two histories that differ from each other", () => {
    const [a, b] = PROFILES.map((p) => buildDemoData(NOW, p));
    expect(a.movements.length).not.toBe(b.movements.length);
  });

  it("give an error for an unknown slug", () => {
    expect(() => profileOf("tokolain")).toThrow(/Unknown demo organization/);
  });
});
