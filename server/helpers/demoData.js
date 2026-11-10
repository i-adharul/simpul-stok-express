// The demo stock of one demo organization (docs/05, seed): 3 warehouses, 50 products, and about three
// weeks of history. Who the organization is and what it sells comes from a profile (demoProfiles.js). Pure: it returns plain objects and touches no database, so it is easy to test and the
// seeder (seeders/20261108000300-demo-stock.js) only inserts what it returns.
//
// The history is built by replaying events in time order with a running balance per pair
// (warehouse, product), so a stock level is exactly the sum of its movements and never negative
// (rule 8 is the database's last line; this data never needs it). The "random" choices come from a
// fixed-seed generator, so the same instant gives the same data every time (the reset script
// relies on that).
const { wibDayRange } = require("./wibDay");
const { PROFILES } = require("./demoProfiles");

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const HISTORY_DAYS = 21;

const ADJUST_REASONS = ["STOCK_OPNAME", "DAMAGED", "LOST", "CORRECTION"];

// mulberry32: a tiny generator that is fully determined by its seed.
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Which warehouses stock a product: always one (its home), often two, sometimes all three. So not
// every pair has a stock row, as in a real business (S09 draws a strip for the missing ones).
function warehousesOf(profile, productIndex) {
  const home = productIndex % 3;
  const codes = [profile.warehouses[home].code];
  if (productIndex % 2 === 0) codes.push(profile.warehouses[(home + 1) % 3].code);
  if (productIndex % 5 === 0) codes.push(profile.warehouses[(home + 2) % 3].code);
  return [...new Set(codes)];
}

// Who records a movement in a warehouse: the Warehouse Admin only in their own warehouses.
const authorIn = (profile, warehouseCode, pick) => (profile.adminWarehouseCodes.includes(warehouseCode) && pick < 0.5 ? "WAREHOUSE_ADMIN" : "OWNER");

// The planned events. Quantities of decrements are decided later, against the running balance.
function planEvents({ now, random, profile }) {
  const events = [];
  const at = (daysAgo, fraction) => new Date(now.getTime() - daysAgo * DAY_MS - Math.floor(fraction * 10 * 60 * MINUTE_MS));

  profile.products.forEach((product, index) => {
    const codes = warehousesOf(profile, index);
    codes.forEach((warehouseCode) => {
      // The first receipt, three weeks ago: two to six times the minimum.
      events.push({ kind: "receive", warehouseCode, sku: product.sku, quantity: Math.max(12, product.minStock * (2 + Math.floor(random() * 5)) + Math.floor(random() * 20)), when: at(HISTORY_DAYS - 1 - random() * 2, random()), note: "Penerimaan awal" });
      // One to three later receipts.
      const extra = 1 + Math.floor(random() * 3);
      for (let i = 0; i < extra; i += 1) {
        events.push({ kind: "receive", warehouseCode, sku: product.sku, quantity: Math.max(6, Math.floor(product.minStock * (0.5 + random()))), when: at(1 + random() * (HISTORY_DAYS - 4), random()), note: `PO-${100 + Math.floor(random() * 900)}` });
      }
      // Now and then a stock count correction (a small loss or damage).
      if (random() < 0.3) {
        events.push({ kind: "adjust", warehouseCode, sku: product.sku, quantity: 1 + Math.floor(random() * 6), reason: ADJUST_REASONS[1 + Math.floor(random() * 2)], when: at(1 + random() * (HISTORY_DAYS - 6), random()), note: null });
      }
    });
  });

  // Transfers between warehouses, spread over the weeks; the last one is today. Each moves one to
  // three products that the source stocks, to a different warehouse.
  const TRANSFER_COUNT = 8;
  for (let t = 0; t < TRANSFER_COUNT; t += 1) {
    const from = profile.warehouses[t % 3].code;
    const to = profile.warehouses[(t + 1 + (t % 2)) % 3].code;
    const stocked = profile.products.map((p, i) => ({ p, i })).filter(({ i }) => warehousesOf(profile, i).includes(from));
    const items = [];
    for (let k = 0; k < 1 + Math.floor(random() * 3); k += 1) {
      const { p } = stocked[Math.floor(random() * stocked.length)];
      if (!items.some((item) => item.sku === p.sku)) items.push({ sku: p.sku, fraction: 0.15 + random() * 0.25 });
    }
    events.push({ kind: "transfer", from, to, items, when: t === TRANSFER_COUNT - 1 ? null : at(1 + (t * (HISTORY_DAYS - 5)) / TRANSFER_COUNT, random()), note: t % 2 === 0 ? "Pemerataan stok" : null, todayFraction: 0.35 });
  }
  return events;
}

// Events of today (WIB): a receipt, a correction that empties one pair (OUT) and one that lowers a
// pair under its minimum (LOW), so the dashboard has a restock list and activity "today".
function planToday({ now, random, state, profile }) {
  const { from } = wibDayRange(now);
  const span = now.getTime() - from.getTime();
  const when = (fraction) => new Date(from.getTime() + Math.floor(span * fraction));
  const events = [];

  profile.products.forEach((product, index) => {
    const home = warehousesOf(profile, index)[0];
    if (index % 9 === 0) {
      events.push({ kind: "shape", warehouseCode: home, sku: product.sku, target: 0, reason: "STOCK_OPNAME", when: when(0.5 + 0.4 * random()) });
    } else if (index % 7 === 3 && product.minStock >= 4) {
      events.push({ kind: "shape", warehouseCode: home, sku: product.sku, target: Math.floor(product.minStock / 2), reason: "STOCK_OPNAME", when: when(0.5 + 0.4 * random()) });
    }
  });
  for (let i = 0; i < 3; i += 1) {
    const product = profile.products[(i * 11 + 4) % profile.products.length];
    const warehouseCode = warehousesOf(profile, (i * 11 + 4) % profile.products.length)[0];
    events.push({ kind: "receive", warehouseCode, sku: product.sku, quantity: product.minStock * 2, when: when(0.1 + 0.15 * i), note: `PO-${200 + i}` });
  }
  state.todayFrom = from;
  return events;
}

// Replays the events in time order. A decrement that the balance cannot cover is cut down to what
// is there, or skipped, so no balance ever goes below zero.
function replay(events, now, profile) {
  const balance = new Map();
  const key = (warehouseCode, sku) => `${warehouseCode}|${sku}`;
  const movements = [];
  const transfers = [];
  const ordered = events
    .map((event, index) => ({ ...event, when: event.when ?? new Date(now.getTime() - 3 * 60 * MINUTE_MS), index }))
    .sort((a, b) => a.when - b.when || a.index - b.index);
  let tick = 0;
  const stamp = (when) => new Date(when.getTime() + (tick += 1));

  const push = (m) => {
    balance.set(key(m.warehouseCode, m.sku), (balance.get(key(m.warehouseCode, m.sku)) ?? 0) + m.quantityDelta);
    movements.push({ reason: null, note: null, transferCode: null, ...m });
  };

  for (const event of ordered) {
    const when = stamp(event.when);
    if (event.kind === "receive") {
      push({ warehouseCode: event.warehouseCode, sku: event.sku, type: "RECEIVE", quantityDelta: event.quantity, note: event.note, by: authorIn(profile, event.warehouseCode, (event.index % 10) / 10), createdAt: when });
    } else if (event.kind === "adjust") {
      const quantity = Math.min(event.quantity, balance.get(key(event.warehouseCode, event.sku)) ?? 0);
      if (quantity > 0) push({ warehouseCode: event.warehouseCode, sku: event.sku, type: "ADJUST", quantityDelta: -quantity, reason: event.reason, by: authorIn(profile, event.warehouseCode, (event.index % 10) / 10), createdAt: when });
    } else if (event.kind === "shape") {
      const current = balance.get(key(event.warehouseCode, event.sku)) ?? 0;
      if (current > event.target) push({ warehouseCode: event.warehouseCode, sku: event.sku, type: "ADJUST", quantityDelta: event.target - current, reason: event.reason, by: authorIn(profile, event.warehouseCode, 0.9), createdAt: when });
    } else if (event.kind === "transfer") {
      const lines = event.items
        .map((item) => ({ sku: item.sku, quantity: Math.floor((balance.get(key(event.from, item.sku)) ?? 0) * item.fraction) }))
        .filter((line) => line.quantity > 0);
      if (lines.length === 0) continue;
      const code = `MT-${String(transfers.length + 1).padStart(4, "0")}`;
      const by = authorIn(profile, event.from, (event.index % 10) / 10);
      transfers.push({ code, fromWarehouseCode: event.from, toWarehouseCode: event.to, note: event.note, by, createdAt: when });
      for (const line of lines) {
        push({ warehouseCode: event.from, sku: line.sku, type: "TRANSFER_OUT", quantityDelta: -line.quantity, transferCode: code, by, createdAt: when });
        push({ warehouseCode: event.to, sku: line.sku, type: "TRANSFER_IN", quantityDelta: line.quantity, transferCode: code, by, createdAt: when });
      }
    }
  }
  return { movements, transfers, balance };
}

// Returns { warehouses, products, adminWarehouseCodes, viewerWarehouseCodes, transfers, movements,
// levels } for one profile (the first when none is given). `now` is the instant the history ends at
// (the seeder passes the current time); the profile seed makes the same instant give the same data.
function buildDemoData(now = new Date(), profile = PROFILES[0]) {
  const random = createRandom(profile.seed);
  const state = {};
  const events = [...planEvents({ now, random, profile }), ...planToday({ now, random, state, profile })];
  const { movements, transfers, balance } = replay(events, now, profile);

  const levels = [...balance.entries()].map(([pair, quantity]) => {
    const [warehouseCode, sku] = pair.split("|");
    return { warehouseCode, sku, quantity };
  });

  return {
    warehouses: profile.warehouses,
    products: profile.products,
    adminWarehouseCodes: profile.adminWarehouseCodes,
    viewerWarehouseCodes: profile.viewerWarehouseCodes,
    transfers,
    movements,
    levels,
  };
}

// WAREHOUSES and PRODUCTS are the first profile (Toko Maju), kept for the callers that only know one.
module.exports = { buildDemoData, WAREHOUSES: PROFILES[0].warehouses, PRODUCTS: PROFILES[0].products };
