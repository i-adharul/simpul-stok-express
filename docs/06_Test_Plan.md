# Test Plan: Simpul Stok (Express version)

|          |                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Version  | 1.0 (3 Nov 2026)                                                                                                                                 |
| Purpose  | Which tests prove the product's main claims and how to build them                                                                                |
| Audience | People who write and run tests                                                                                                                   |
| Related  | The required tests per business logic item are in the table below; the test stories are in the GitHub Issues and the project board of this repo |

## Testing strategy

The most important tests are the ones that prove the product's main claims (concurrency, atomicity, tenant isolation, idempotency), and all of them use a real Postgres, never a mock.

| Test | What it proves | How |
| --- | --- | --- |
| Stock concurrency | Stock never goes negative and no stock is lost or duplicated | Run 20 simultaneous transfers against a stock of 10 with `Promise.all`; exactly 10 succeed; check the final stock and the number of history rows |
| Transfer atomicity | A failure midway rolls everything back | Force an error after the source stock is decremented; make sure the source stock is unchanged and no movement exists |
| Tenant isolation | Tenant A cannot touch B's data | Create two organizations; for every endpoint in the registry, try to read, update, and delete an ID belonging to B from A's session; expect 404. One test makes sure every Express route is in the registry |
| Static checks | The architecture rules are not broken | Controllers and services do not import models directly; every write route uses `validate`; every write route installs `subscriptionGuard`; no code reads `organizationId` from the body, query or params; every file in `services/` that writes stock calls `lockWarehouse(` |
| Role access | Roles and warehouses are enforced | Role × action matrix; expect 403 for those not allowed |
| Idempotency | A repeated request does not repeat its effect | The same key twice, and in parallel: one effect and an equal answer |
| Sessions | An invalid token is refused | No token, a malformed token, an expired token, an inactive user, a token issued before a password change: all 401 |
| Webhook (M2) | Safe and idempotent | A wrong token is rejected; the same event sent twice is processed only once |
| Plan limits and downgrade (M2) | The effective limit locks usage while a downgrade invoice is Pending | With a Pending downgrade invoice to Starter, additions above the Starter limit are rejected with `PLAN_LIMIT_REACHED` and a reason message; after the invoice is Paid, Expired, Failed, or cancelled, the limit returns; an upgrade does not lock; choosing Starter while usage exceeds its limit is rejected |
| Billing cycle (M2) | The anchor date and invoice kinds are correct | Billing day 31: 31 Jan, 28 Feb, 31 Mar, 30 Apr; day 15 does not shift; validity per kind (initial and plan change 7 days, regular renewal due date + 10 days, replacement renewal the later of due date + 10 days and created + 7 days); paying during READ_ONLY moves the billing day to the payment date and does not trigger a new invoice until 7 days before the new period ends; paying during GRACE does not change the billing day |
| 30-day trial (M2) | The trial ends without data loss | Sign-up creates a 30-day period; after it ends, GRACE, READ_ONLY, then SUSPENDED follow; in SUSPENDED the Owner is directed to Choose a plan; paying the initial invoice (Starter or Business) activates the account and the data stays intact |
| Main flow end to end | The API works from start to finish | One Supertest flow: login, receive stock, transfer, check the stock and the history. The browser is checked by hand (no Playwright in this version) |

Supporting practices: a local Postgres, a separate test database whose name ends in `_test` (the Jest setup stops otherwise), consistent seed data, and `--runInBand` because every test file shares one database and empties its tables. There is no CI in this version: run `npm test` before every push and report the real result in the pull request. Write the concurrency test **before** writing the transfer code, and let it fail first so the problem is seen happening. After a test is green, break one thing on purpose (for example remove the warehouse lock) and make sure the matching test fails.

## Required test coverage

| Item | Why it matters | Decision |
| --- | --- | --- |
| Required tests | Protect the product's main claims | At minimum for BL01, BL02, BL03, BL11, BL12, BL13, BL14, BL15 in M1, and BL20, BL21, BL22, BL23 in M2; every other logic item has tests according to its criteria |

## Registering a new endpoint (tenant isolation)

Every route of the Express app must be accounted for in the cross-tenant harness (`server/__tests__/support/`). A test fails when a route is in none of three places, or in more than one:

| Where | For | What it needs |
| --- | --- | --- |
| `TENANT_ENDPOINTS` (`registry.js`) | A tenant route. The normal case. | One entry per HTTP method, see below |
| `EXEMPT_ROUTES` (`exemptions.js`) | A tenant route that cannot be tested this way. | A written reason |
| `PUBLIC_ROUTES` (`exemptions.js`) | A route that is not tenant at all (login, health, `/me`). | A written reason; it must not use the tenant data access |

A registry entry has a `kind`: `item` (an endpoint addressed by one row's ID), `list`, or `create`. Together with the permission (`action`, from `helpers/permissions.js`) and the role list derived from it (`allowedRoles`), a way to create a row for either organization (`createRow`), and a way to read it back (`readRow`), that is all the harness needs. Optional fields: `supportsCursor`, `idempotent: true`, and `foreignBodies` (an item may add `createForeign` when its key holds the ID of a different kind of row, for example a user ID in the warehouse assignment). For each entry it then runs, from organization A's session against organization B's data:

| Check | Expectation |
| --- | --- |
| No token | 401 |
| Platform admin | 403 |
| A role that may not perform the action | 403, checked before the existence of the row, even for B's ID |
| Read, update, delete with B's ID | 404, byte-identical to the response for an ID that does not exist; B's row is left untouched |
| List | Contains none of B's rows (and contains A's own) |
| Cursor holding B's ID (`supportsCursor`) | Returns none of B's rows |
| `organizationId` in the body or query | Ignored or rejected (400); never creates or moves a row in B |
| Missing or malformed `Idempotency-Key` (`idempotent: true`) | 400 `VALIDATION_ERROR`; no row is created |
| Same valid request twice with one key (`idempotent: true`) | Same 2xx status and identical body; only the second carries `Idempotency-Replayed: true`; exactly one row created (or the row is not changed again) |
| Foreign key in the body (`foreignBodies`) | Each key replaced by B's id gives the same response as a random UUID (403 when the key is authorized first, 404 when it is looked up), byte-identical; nothing is written in either organization |

The harness also requires, for every write under `stock/`, `transfers` or `imports`, one `foreignBodies` variant for each key ending in `Id` that holds a UUID in the body (each replacing exactly that key), so a new stock endpoint cannot skip the foreign-key check. A static test requires every file in `services/` that writes stock to call `lockWarehouse(` (decision 0013).

The harness is proven by a self-test (`harness.selftest.test.js`): a correctly scoped test-only route passes every check, and routes built with one deliberate flaw each (reading a model directly instead of the tenant data access, authorization after the lookup, trusting `organizationId` from the body, and so on) fail the matching check with the expected message. Stock writes get two more flaws: a route that ignores the `Idempotency-Key` header, and a route that declares `idempotent: true` but never uses the idempotency service.
