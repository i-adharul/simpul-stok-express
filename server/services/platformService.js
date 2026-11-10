const { findOrganizations } = require("../helpers/platformAccess");
const { pageBody, pageWindow } = require("../helpers/pagination");

// Platform admin use cases (BL25). The caller is already proven to be a Platform admin by the guard on
// the /api/platform prefix; the cross-tenant read itself lives in helpers/platformAccess.js.
// The list item of docs/04: only these fields leave the server. `status` is sent as stored (TRIAL
// stays TRIAL; the UI shows it as "Aktif", BL25). Without a subscription, plan and period end are null.
const toListItem = (row) => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  status: row.status,
  plan: row.Subscription?.Plan?.name ?? null,
  currentPeriodEnd: row.Subscription?.currentPeriodEnd ?? null,
  createdAt: row.createdAt,
});

async function listOrganizations(query) {
  const { rows, count } = await findOrganizations(pageWindow(query));
  return pageBody(rows.map(toListItem), count, query);
}

module.exports = { listOrganizations };
