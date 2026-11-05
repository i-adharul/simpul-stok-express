const WRITE_METHODS = ["post", "put", "patch", "delete"];

// Walks an Express 5 app (app.router) and the routers mounted inside it, calling visit(route)
// for every route. Layers with a `route` are endpoints; layers with a `handle.stack` are routers.
function walk(stack, visit) {
  for (const layer of stack) {
    if (layer.route) visit(layer.route);
    else if (layer.handle && Array.isArray(layer.handle.stack)) walk(layer.handle.stack, visit);
  }
}

function listRoutes(app) {
  const routes = [];
  walk(app.router.stack, (route) => {
    const methods = Object.keys(route.methods)
      .filter((method) => route.methods[method])
      .map((method) => method.toLowerCase());
    for (const method of methods) {
      routes.push({
        method,
        path: String(route.path),
        label: `${method.toUpperCase()} ${route.path}`,
        // A route validates when `validate` runs before the last handler (the controller).
        validates: route.stack.slice(0, -1).some((layer) => layer.handle.isValidate === true),
      });
    }
  });
  return routes;
}

const isWrite = (route) => WRITE_METHODS.includes(route.method);

// Write routes (POST, PUT, PATCH, DELETE; `all` counts because it includes them) without validate, minus the allowed ones.
// `allowed` holds labels such as "POST /webhooks/xendit" (the route's own path as declared).
function findUnvalidatedWriteRoutes(app, allowed = []) {
  return listRoutes(app)
    .filter(isWrite)
    .filter((route) => !route.validates)
    .map((route) => route.label)
    .filter((label) => !allowed.includes(label));
}

module.exports = { listRoutes, findUnvalidatedWriteRoutes };
