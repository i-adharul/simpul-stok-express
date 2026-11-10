// The two demo organizations (docs/05, seed), as plain data: who they are, where they keep stock and
// what they sell. helpers/demoData.js turns one profile into stock history; the seeders and the reset
// script walk the list. A profile is data only (no database, no randomness), so adding a third demo
// business means adding an object here and its slug to DEMO_SLUGS, nothing else.
//
// "seed" feeds the fixed-seed generator in demoData.js. The first profile keeps the seed it always
// had, so the content of "Toko Maju" does not change. The Warehouse Admin works in the first two
// warehouses (the Viewer in the first only), so the roles see different dashboards; the Owner reaches
// all three. Units are the six of the schema: bks (bungkus), ktk (kotak), pcs, btl (botol), jrg
// (jeriken), pak.

const TOKO_MAJU_WAREHOUSES = [
  { code: "GD-JKT", name: "Gudang Jakarta", address: "Jl. Raya Cakung Cilincing No. 12, Jakarta Timur" },
  { code: "GD-BDG", name: "Gudang Bandung", address: "Jl. Soekarno-Hatta No. 88, Bandung" },
  { code: "GD-SBY", name: "Gudang Surabaya", address: "Jl. Rungkut Industri No. 5, Surabaya" },
];

const TOKO_MAJU_PRODUCTS = [
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

const KOPI_SENJA_WAREHOUSES = [
  { code: "KS-BDG", name: "Dapur Pusat Bandung", address: "Jl. Braga No. 21, Bandung" },
  { code: "KS-DGO", name: "Gudang Outlet Dago", address: "Jl. Ir. H. Djuanda No. 140, Bandung" },
  { code: "KS-LBG", name: "Gudang Outlet Lembang", address: "Jl. Raya Lembang No. 67, Lembang" },
];

const KOPI_SENJA_PRODUCTS = [
  // Kopi
  { sku: "KPI-001", name: "Biji Kopi Arabika Gayo 1 kg", unit: "bks", minStock: 20 },
  { sku: "KPI-002", name: "Biji Kopi Robusta Lampung 1 kg", unit: "bks", minStock: 20 },
  { sku: "KPI-003", name: "Biji Kopi House Blend 1 kg", unit: "bks", minStock: 30 },
  { sku: "KPI-004", name: "Biji Kopi Decaf 500 g", unit: "bks", minStock: 8 },
  { sku: "KPI-005", name: "Kopi Bubuk Tubruk 250 g", unit: "bks", minStock: 15 },
  { sku: "KPI-006", name: "Kopi Instan 3 in 1 Isi 20", unit: "pak", minStock: 12 },
  { sku: "KPI-007", name: "Kopi Cold Brew Konsentrat 1 liter", unit: "btl", minStock: 10 },
  { sku: "KPI-008", name: "Kertas Filter V60 Isi 100", unit: "pak", minStock: 10 },
  // Susu dan krim
  { sku: "SSU-001", name: "Susu Segar Full Cream 1 liter", unit: "ktk", minStock: 48 },
  { sku: "SSU-002", name: "Susu Oat 1 liter", unit: "ktk", minStock: 24 },
  { sku: "SSU-003", name: "Susu Almond 1 liter", unit: "ktk", minStock: 12 },
  { sku: "SSU-004", name: "Krimer Nabati 1 kg", unit: "pak", minStock: 10 },
  { sku: "SSU-005", name: "Whipped Cream 1 liter", unit: "ktk", minStock: 12 },
  { sku: "SSU-006", name: "Susu Kental Manis 1 kg", unit: "pak", minStock: 10 },
  { sku: "SSU-007", name: "Yogurt Plain 500 ml", unit: "btl", minStock: 12 },
  // Sirup, saus dan bubuk
  { sku: "SRP-001", name: "Sirup Karamel 750 ml", unit: "btl", minStock: 10 },
  { sku: "SRP-002", name: "Sirup Vanila 750 ml", unit: "btl", minStock: 10 },
  { sku: "SRP-003", name: "Sirup Hazelnut 750 ml", unit: "btl", minStock: 8 },
  { sku: "SRP-004", name: "Saus Cokelat 2 kg", unit: "jrg", minStock: 6 },
  { sku: "SRP-005", name: "Bubuk Cokelat 1 kg", unit: "bks", minStock: 12 },
  { sku: "SRP-006", name: "Bubuk Matcha 500 g", unit: "bks", minStock: 8 },
  { sku: "SRP-007", name: "Bubuk Red Velvet 500 g", unit: "bks", minStock: 6 },
  // Teh dan pemanis
  { sku: "TEH-001", name: "Teh Hitam Daun 500 g", unit: "bks", minStock: 10 },
  { sku: "TEH-002", name: "Teh Melati 500 g", unit: "bks", minStock: 10 },
  { sku: "TEH-003", name: "Teh Earl Grey Isi 25", unit: "ktk", minStock: 8 },
  { sku: "TEH-004", name: "Gula Cair 5 liter", unit: "jrg", minStock: 15 },
  { sku: "TEH-005", name: "Madu Murni 650 ml", unit: "btl", minStock: 8 },
  { sku: "TEH-006", name: "Es Batu Kristal 5 kg", unit: "bks", minStock: 20 },
  // Roti dan kue
  { sku: "ROT-001", name: "Croissant Beku Isi 10", unit: "pak", minStock: 12 },
  { sku: "ROT-002", name: "Roti Tawar Susu", unit: "pcs", minStock: 15 },
  { sku: "ROT-003", name: "Roti Bun Burger Isi 6", unit: "pak", minStock: 10 },
  { sku: "ROT-004", name: "Tepung Terigu Protein Sedang 1 kg", unit: "pak", minStock: 20 },
  { sku: "ROT-005", name: "Mentega Tawar 1 kg", unit: "pak", minStock: 8 },
  { sku: "ROT-006", name: "Cokelat Batang Masak 1 kg", unit: "pak", minStock: 6 },
  { sku: "ROT-007", name: "Telur Ayam 1 kg", unit: "pak", minStock: 15 },
  // Bahan dapur
  { sku: "BHN-001", name: "Gula Pasir 1 kg", unit: "pak", minStock: 30 },
  { sku: "BHN-002", name: "Garam Dapur 500 g", unit: "bks", minStock: 5 },
  { sku: "BHN-003", name: "Minyak Goreng 2 liter", unit: "jrg", minStock: 10 },
  { sku: "BHN-004", name: "Keju Cheddar Slice Isi 24", unit: "pak", minStock: 8 },
  { sku: "BHN-005", name: "Daging Asap Slice 500 g", unit: "pak", minStock: 8 },
  { sku: "BHN-006", name: "Selai Stroberi 1 kg", unit: "btl", minStock: 6 },
  { sku: "BHN-007", name: "Kacang Almond Slice 500 g", unit: "bks", minStock: 6 },
  // Kemasan dan perlengkapan
  { sku: "PKG-001", name: "Gelas Plastik 16 oz Isi 50", unit: "pak", minStock: 40 },
  { sku: "PKG-002", name: "Tutup Gelas Plastik Isi 50", unit: "pak", minStock: 40 },
  { sku: "PKG-003", name: "Sedotan Kertas Isi 100", unit: "pak", minStock: 30 },
  { sku: "PKG-004", name: "Penahan Gelas Karton Isi 50", unit: "pak", minStock: 10 },
  { sku: "PKG-005", name: "Gelas Kertas Panas 8 oz Isi 50", unit: "pak", minStock: 30 },
  { sku: "PKG-006", name: "Kantong Kertas Isi 100", unit: "pak", minStock: 10 },
  { sku: "PKG-007", name: "Tisu Meja Isi 200", unit: "pak", minStock: 20 },
  { sku: "PKG-008", name: "Sarung Tangan Plastik Isi 100", unit: "ktk", minStock: 10 },
];

const PROFILES = [
  {
    slug: "tokomaju",
    name: "Toko Maju",
    seed: 20261108,
    warehouses: TOKO_MAJU_WAREHOUSES,
    adminWarehouseCodes: ["GD-JKT", "GD-BDG"],
    viewerWarehouseCodes: ["GD-JKT"],
    products: TOKO_MAJU_PRODUCTS,
  },
  {
    slug: "kopisenja",
    name: "Kopi Senja",
    seed: 20261110,
    warehouses: KOPI_SENJA_WAREHOUSES,
    adminWarehouseCodes: ["KS-BDG", "KS-DGO"],
    viewerWarehouseCodes: ["KS-BDG"],
    products: KOPI_SENJA_PRODUCTS,
  },
];

const DEMO_SLUGS = PROFILES.map((profile) => profile.slug);

// The profile of a slug, or an error: a typo must not silently seed nothing.
function profileOf(slug) {
  const profile = PROFILES.find((candidate) => candidate.slug === slug);
  if (!profile) throw new Error(`Unknown demo organization "${slug}".`);
  return profile;
}

module.exports = { PROFILES, DEMO_SLUGS, profileOf };
