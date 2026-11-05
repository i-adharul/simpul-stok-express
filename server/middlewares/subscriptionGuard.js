// The single place where write routes check the subscription (BL23, rule 17).
//
// TEMPORARY: until the billing stories (E8) this always lets the request through. E8 replaces the
// body of this one function: it will compute the access status from Organization.status,
// currentPeriodEnd and graceUntil, and answer 403 SUBSCRIPTION_READ_ONLY when writes are not
// allowed. Because every write route already has it, no route needs to change then.
//
// Placement on a route: after authentication and the role check (a role without the right gets
// 403 first, rule 2), before validate. Not installed on login, logout and password change, which
// must work in every subscription state (BL23); the static test lists them with that reason.
function subscriptionGuard(req, res, next) {
  next();
}

// A marker for the static test (__tests__/support/routeInspector.js), like `isValidate`.
subscriptionGuard.isSubscriptionGuard = true;

module.exports = subscriptionGuard;
