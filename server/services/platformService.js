const { findOrganizations } = require("../helpers/platformAccess");
const { pageBody, pageWindow } = require("../helpers/pagination");

// Platform admin use cases (BL25). The caller is already proven to be a Platform admin by the guard on
// the /api/platform prefix; the cross-tenant read itself lives in helpers/platformAccess.js.
async function listOrganizations(query) {
  const { rows, count } = await findOrganizations(pageWindow(query));
  return pageBody(rows, count, query);
}

module.exports = { listOrganizations };
