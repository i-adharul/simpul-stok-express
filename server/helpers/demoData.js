// The demo data of "Toko Maju" (docs/05, seed): 3 warehouses, 50 products, and about three weeks of
// history. Pure: it returns plain objects and touches no database, so it is easy to test and the
// seeder (seeders/20261108000300-demo-stock.js) only inserts what it returns.
//
// The history is built by replaying events in time order with a running balance per pair
// (warehouse, product), so a stock level is exactly the sum of its movements and never negative
// (rule 8 is the database's last line; this data never needs it). The "random" choices come from a
// fixed-seed generator, so the same instant gives the same data every time (the reset script
// relies on that).
const { wibDayRange } = require("./wibDay");

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const HISTORY_DAYS = 21;

const WAREHOUSES = [
  { code: "GD-JKT", name: "Gudang Jakarta", address: "Jl. Raya Cakung Cilincing No. 12, Jakarta Timur" },
  { code: "GD-BDG", name: "Gudang Bandung", address: "Jl. Soekarno-Hatta No. 88, Bandung" },
  { code: "GD-SBY", name: "Gudang Surabaya", address: "Jl. Rungkut Industri No. 5, Surabaya" },
];

// The Warehouse Admin works in the first two (the Viewer in the first only), so the roles see
// different dashboards. The Owner reaches all three.
const ADMIN_WAREHOUSE_CODES = ["GD-JKT", "GD-BDG"];
const VIEWER_WAREHOUSE_CODES = ["GD-JKT"];

// Units are the six of the schema: bks (bungkus), ktk (kotak), pcs, btl (botol), jrg (jeriken), pak.
const PRODUCTS = [
  // Minuman
  { sku: "MNM-001", name: "Teh Botol 450 ml", unit: "btl", minStock: 48 },
  { sku: "MNM-002", name: "Air Mineral 600 ml", unit: "btl", minStock: 120 },
  { sku: "MNM-003", name: "Kopi Sachet Isi 10", unit: "pak", minStock: 20 },
  { sku: "MNM-004", name: "Teh Celup Isi 25", unit: "ktk", minStock: 24 },
  { sku: "MNM-005", name: "Susu UHT Cokelat 200 ml", unit: "ktk", minStock: 36 },
  { sku: "MNM-006", name: "Sirup Markisa 460 ml", unit: "btl", minStock: 12 },
  { sku: "MNM-007", name: "Minuman Isotonik 500 ml", unit: "btl", minStock: 48 },
  { sku: "MNM-008", name: "Susu Kental Manis Kaleng", unit: "pcs", minStock: 30 },
  // Mi dan makanan instan
  { sku: "MIE-001", name: "Mi Goreng Instan 85 g", unit: "bks", minStock: 200 },
  { sku: "MIE-002", name: "Mi Kuah Soto 70 g", unit: "bks", minStock: 150 },
  { sku: "MIE-003", name: "Bihun Jagung 150 g", unit: "bks", minStock: 40 },
  { sku: "MIE-004", name: "Mi Telur Kering 200 g", unit: "bks", minStock: 60 },
  { sku: "MIE-005", name: "Bubur Instan Ayam", unit: "bks", minStock: 30 },
  { sku: "MIE-006", name: "Sarden Kaleng Saus Tomat", unit: "pcs", minStock: 36 },
  // Bahan pokok
  { sku: "POK-001", name: "Beras Premium 5 kg", unit: "bks", minStock: 40 },
  { sku: "POK-002", name: "Gula Pasir 1 kg", unit: "pak", minStock: 60 },
  { sku: "POK-003", name: "Tepung Terigu 1 kg", unit: "pak", minStock: 50 },
  { sku: "POK-004", name: "Garam Dapur Beryodium 250 g", unit: "bks", minStock: 40 },
  { sku: "POK-005", name: "Telur Ayam 1 kg", unit: "pak", minStock: 30 },
  { sku: "POK-006", name: "Kacang Hijau 500 g", unit: "pak", minStock: 20 },
  { sku: "POK-007", name: "Tepung Beras 500 g", unit: "pak", minStock: 25 },
  { sku: "POK-008", name: "Sagu Tani 500 g", unit: "pak", minStock: 15 },
  // Bumbu dan minyak
  { sku: "BMB-001", name: "Minyak Goreng 2 liter", unit: "jrg", minStock: 36 },
  { sku: "BMB-002", name: "Minyak Goreng 1 liter", unit: "pak", minStock: 48 },
  { sku: "BMB-003", name: "Kecap Manis 275 ml", unit: "btl", minStock: 24 },
  { sku: "BMB-004", name: "Saus Sambal 335 ml", unit: "btl", minStock: 24 },
  { sku: "BMB-005", name: "Kaldu Ayam Bubuk 100 g", unit: "bks", minStock: 50 },
  { sku: "BMB-006", name: "Merica Bubuk 50 g", unit: "bks", minStock: 20 },
  { sku: "BMB-007", name: "Bumbu Nasi Goreng", unit: "bks", minStock: 40 },
  { sku: "BMB-008", name: "Santan Instan 65 ml", unit: "bks", minStock: 60 },
  // Camilan
  { sku: "CML-001", name: "Keripik Singkong Balado 150 g", unit: "bks", minStock: 40 },
  { sku: "CML-002", name: "Biskuit Kelapa 300 g", unit: "ktk", minStock: 24 },
  { sku: "CML-003", name: "Wafer Cokelat 140 g", unit: "pak", minStock: 30 },
  { sku: "CML-004", name: "Kacang Garing 250 g", unit: "bks", minStock: 30 },
  { sku: "CML-005", name: "Permen Jahe Isi 50", unit: "pak", minStock: 16 },
  { sku: "CML-006", name: "Kerupuk Udang 250 g", unit: "bks", minStock: 30 },
  { sku: "CML-007", name: "Roti Tawar Gandum", unit: "pcs", minStock: 20 },
  // Kebersihan rumah tangga
  { sku: "RMH-001", name: "Sabun Mandi Batang 85 g", unit: "pcs", minStock: 72 },
  { sku: "RMH-002", name: "Sampo Sachet Isi 12", unit: "pak", minStock: 30 },
  { sku: "RMH-003", name: "Deterjen Bubuk 800 g", unit: "bks", minStock: 36 },
  { sku: "RMH-004", name: "Sabun Cuci Piring 400 ml", unit: "btl", minStock: 36 },
  { sku: "RMH-005", name: "Pewangi Pakaian 900 ml", unit: "btl", minStock: 24 },
  { sku: "RMH-006", name: "Pasta Gigi 120 g", unit: "pcs", minStock: 48 },
  { sku: "RMH-007", name: "Tisu Wajah Isi 250", unit: "pak", minStock: 40 },
  { sku: "RMH-008", name: "Pembersih Lantai 800 ml", unit: "btl", minStock: 20 },
  // Perlengkapan dapur dan lain-lain
  { sku: "DPR-001", name: "Kantong Plastik Hitam Isi 50", unit: "pak", minStock: 30 },
  { sku: "DPR-002", name: "Korek Api Gas", unit: "pcs", minStock: 60 },
  { sku: "DPR-003", name: "Baterai AA Isi 4", unit: "pak", minStock: 24 },
  { sku: "DPR-004", name: "Lilin Putih Isi 12", unit: "ktk", minStock: 10 },
  { sku: "DPR-005", name: "Kapur Barus Isi 6", unit: "pak", minStock: 12 },
];

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
function warehousesOf(productIndex) {
  const home = productIndex % 3;
  const codes = [WAREHOUSES[home].code];
  if (productIndex % 2 === 0) codes.push(WAREHOUSES[(home + 1) % 3].code);
  if (productIndex % 5 === 0) codes.push(WAREHOUSES[(home + 2) % 3].code);
  return [...new Set(codes)];
}

// Who records a movement in a warehouse: the Warehouse Admin only in their own warehouses.
const authorIn = (warehouseCode, pick) => (ADMIN_WAREHOUSE_CODES.includes(warehouseCode) && pick < 0.5 ? "WAREHOUSE_ADMIN" : "OWNER");

// The planned events. Quantities of decrements are decided later, against the running balance.
function planEvents({ now, random }) {
  const events = [];
  const at = (daysAgo, fraction) => new Date(now.getTime() - daysAgo * DAY_MS - Math.floor(fraction * 10 * 60 * MINUTE_MS));

  PRODUCTS.forEach((product, index) => {
    const codes = warehousesOf(index);
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
    const from = WAREHOUSES[t % 3].code;
    const to = WAREHOUSES[(t + 1 + (t % 2)) % 3].code;
    const stocked = PRODUCTS.map((p, i) => ({ p, i })).filter(({ i }) => warehousesOf(i).includes(from));
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
function planToday({ now, random, state }) {
  const { from } = wibDayRange(now);
  const span = now.getTime() - from.getTime();
  const when = (fraction) => new Date(from.getTime() + Math.floor(span * fraction));
  const events = [];

  PRODUCTS.forEach((product, index) => {
    const home = warehousesOf(index)[0];
    if (index % 9 === 0) {
      events.push({ kind: "shape", warehouseCode: home, sku: product.sku, target: 0, reason: "STOCK_OPNAME", when: when(0.5 + 0.4 * random()) });
    } else if (index % 7 === 3 && product.minStock >= 4) {
      events.push({ kind: "shape", warehouseCode: home, sku: product.sku, target: Math.floor(product.minStock / 2), reason: "STOCK_OPNAME", when: when(0.5 + 0.4 * random()) });
    }
  });
  for (let i = 0; i < 3; i += 1) {
    const product = PRODUCTS[(i * 11 + 4) % PRODUCTS.length];
    const warehouseCode = warehousesOf((i * 11 + 4) % PRODUCTS.length)[0];
    events.push({ kind: "receive", warehouseCode, sku: product.sku, quantity: product.minStock * 2, when: when(0.1 + 0.15 * i), note: `PO-${200 + i}` });
  }
  state.todayFrom = from;
  return events;
}

// Replays the events in time order. A decrement that the balance cannot cover is cut down to what
// is there, or skipped, so no balance ever goes below zero.
function replay(events, now) {
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
      push({ warehouseCode: event.warehouseCode, sku: event.sku, type: "RECEIVE", quantityDelta: event.quantity, note: event.note, by: authorIn(event.warehouseCode, (event.index % 10) / 10), createdAt: when });
    } else if (event.kind === "adjust") {
      const quantity = Math.min(event.quantity, balance.get(key(event.warehouseCode, event.sku)) ?? 0);
      if (quantity > 0) push({ warehouseCode: event.warehouseCode, sku: event.sku, type: "ADJUST", quantityDelta: -quantity, reason: event.reason, by: authorIn(event.warehouseCode, (event.index % 10) / 10), createdAt: when });
    } else if (event.kind === "shape") {
      const current = balance.get(key(event.warehouseCode, event.sku)) ?? 0;
      if (current > event.target) push({ warehouseCode: event.warehouseCode, sku: event.sku, type: "ADJUST", quantityDelta: event.target - current, reason: event.reason, by: authorIn(event.warehouseCode, 0.9), createdAt: when });
    } else if (event.kind === "transfer") {
      const lines = event.items
        .map((item) => ({ sku: item.sku, quantity: Math.floor((balance.get(key(event.from, item.sku)) ?? 0) * item.fraction) }))
        .filter((line) => line.quantity > 0);
      if (lines.length === 0) continue;
      const code = `MT-${String(transfers.length + 1).padStart(4, "0")}`;
      const by = authorIn(event.from, (event.index % 10) / 10);
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
// levels }. `now` is the instant the history ends at (the seeder passes the current time).
function buildDemoData(now = new Date()) {
  const random = createRandom(20261108);
  const state = {};
  const events = [...planEvents({ now, random }), ...planToday({ now, random, state })];
  const { movements, transfers, balance } = replay(events, now);

  const levels = [...balance.entries()].map(([pair, quantity]) => {
    const [warehouseCode, sku] = pair.split("|");
    return { warehouseCode, sku, quantity };
  });

  return {
    warehouses: WAREHOUSES,
    products: PRODUCTS,
    adminWarehouseCodes: ADMIN_WAREHOUSE_CODES,
    viewerWarehouseCodes: VIEWER_WAREHOUSE_CODES,
    transfers,
    movements,
    levels,
  };
}

module.exports = { buildDemoData, WAREHOUSES, PRODUCTS, ADMIN_WAREHOUSE_CODES, VIEWER_WAREHOUSE_CODES };
