// Where is every Express route accounted for in the cross-tenant harness? (docs/06_Test_Plan.md)
// A route must be in exactly one of: the registry, EXEMPT_ROUTES or PUBLIC_ROUTES. A registry or
// exemption label that matches no route is stale and is reported too.
const { listRoutes } = require("./routeInspector");
const { labelOf } = require("./registry");

function placementProblems(app, { endpoints, exempt, publicRoutes }) {
  const routeLabels = new Set(listRoutes(app).map((route) => route.label));
  const places = {
    "TENANT_ENDPOINTS (registry.js)": endpoints.map(labelOf),
    "EXEMPT_ROUTES (exemptions.js)": Object.keys(exempt),
    "PUBLIC_ROUTES (exemptions.js)": Object.keys(publicRoutes),
  };

  const problems = [];
  for (const label of routeLabels) {
    const where = Object.entries(places)
      .filter(([, labels]) => labels.includes(label))
      .map(([name]) => name);
    if (where.length === 0) problems.push(`${label} is in none of the three places`);
    if (where.length > 1) problems.push(`${label} is in more than one place: ${where.join(", ")}`);
  }
  for (const [name, labels] of Object.entries(places)) {
    for (const label of labels) {
      if (!routeLabels.has(label)) problems.push(`${label} is listed in ${name} but is not a route of the app`);
    }
  }
  return problems.sort();
}

module.exports = { placementProblems };
