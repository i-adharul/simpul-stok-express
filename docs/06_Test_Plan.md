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
| Required tests | Protect the product's main claims | At minimum for BL01, BL02, BL03, BL11, BL12, BL13, BL14, BL15 in M1, and BL20, BL21, BL22, BL23, BL31 in M2; every other logic item has tests according to its criteria |

## Registering a new endpoint (tenant isolation)

Every route of the Express app must be accounted for in the cross-tenant harness (`server/__tests__/support/`). A test fails when a route is in none of three places, or in more than one:

| Where | For | What it needs |
| --- | --- | --- |
| `TENANT_ENDPOINTS` (`registry.js`) | A tenant route. The normal case. | One entry per HTTP method, see below |
| `EXEMPT_ROUTES` (`exemptions.js`) | A tenant route that cannot be tested this way. | A written reason |
| `PUBLIC_ROUTES` (`exemptions.js`) | A route that is not tenant at all (login, health, `/me`). | A written reason; it must not use the tenant data access |

A registry entry has a `kind`: `item` (an endpoint addressed by one row's ID), `list`, or `create`. Together with the permission (`action`, from `helpers/permissions.js`) and the role list derived from it (`allowedRoles`), a way to create a row for either organization (`createRow`), and a way to read it back (`readRow`), that is all the harness needs. Optional fields: `supportsCursor`, `listQuery` (a query for the list check, such as `{ pageSize: 100 }`, because the world is shared by all entries and stock bodies add many rows), `idempotent: true`, `body` (it may be async, so a stock write can create the warehouse and product its body points at), and `foreignBodies` (an item may add `createForeign` when its key holds the ID of a different kind of row, for example a user ID in the warehouse assignment or a product in a stock body). For each entry it then runs, from organization A's session against organization B's data:

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

## Member and invitation rules: what proves each one (BL05 to BL07)

The audit of E7-10 (step 1). Files are under `server/__tests__/`. A row marked "Was missing" names the test file that now closes it. The plan member limit on accept is proven in E8-02 (`planLimits.enforce.test.js`), not here.

| Rule | Proof |
| --- | --- |
| BL05 token is random, stored as a hash, valid 7 days, created by the Owner | `invitations.test.js` ("stores only the hash of the token, and expires in 7 days"); `invitations.test.js` ("gives every invitation its own token") |
| BL05 link shown once (never in a list) | `invitations.test.js` ("never shows the token or the hash in GET") |
| BL05 single-use | `invitations.accept.test.js` ("a token cannot be used a second time"); simultaneous: "of one token: exactly one 200" |
| BL05 409: active user (same organization, other case, other organization), inactive user of another organization, Platform admin email, pending invitation of the same organization | `invitations.test.js`, "every 409" |
| BL05 an inactive member of the same organization, an expired and an accepted invitation do not block a new one | `invitations.test.js`, "what is allowed again" |
| BL05 the Owner can cancel (pending, expired); other IDs are one identical 404 | `invitations.test.js`, "DELETE /api/invitations/:id" |
| BL05 only the Owner invites | `invitations.test.js`, "the role matrix"; every entry of the registry (`roleMatrix.test.js`, `crossTenant.test.js`) |
| BL06 token validated; expired, used, cancelled, unknown and malformed tokens are one identical 404 | `invitations.accept.test.js` (GET and POST) |
| BL06 user, assignments and `acceptedAt` in one transaction | `invitations.accept.test.js`, "one transaction" |
| BL06 organization comes from the invitation, never the request | `invitations.accept.test.js` ("gives the member the organization of the INVITATION") |
| BL06 an email that now belongs to a user is 409 | `invitations.accept.test.js`, "the email already exists" |
| BL06 an inactive member is reactivated with the new password, role and assignment | `invitations.accept.test.js`, "an inactive member comes back" |
| BL06 a cancel and an acceptance cannot both win (invitation row lock, apart from the organization lock) | `e7.tokenGaps.test.js` (added by this audit) |
| BL07 role change only to Warehouse Admin or Viewer; the Owner role cannot be granted | `members.update.test.js` ("400 for the role OWNER"); `invitations.test.js` ("400 for the role OWNER") |
| BL07 the Owner cannot be deactivated or demoted | `members.update.test.js`, "the Owner is protected" |
| BL07 every organization keeps exactly one active Owner after any series of operations | Was missing. Closed by `ownerInvariant.test.js` |
| BL07 deactivation cuts access at once (token 401, login 401) and a role change applies at once | `members.update.test.js`, "the change applies at once" |
| BL07 reset link: hash only, valid 1 day, one link per member (a new one cancels the old) | `members.reset.test.js` |
| BL07 reset link only for active members | `members.reset.test.js` ("an inactive member is 409") |
| BL07 reset link is single-use; simultaneous uses give one 204 | `members.reset.test.js`, "concurrency" |
| BL07 reset changes the password and revokes old sessions | `members.reset.test.js` ("a session token issued before the reset gets 401") |
| BL07 an expired link, and the link of a deactivated member, are refused on POST too | **Was missing** (only GET was proven). `e7.tokenGaps.test.js` (added by this audit) |
| Sign-up creates the organization with one Owner; duplicate email or slug gives 409, also simultaneously | `auth.registerOrganization.test.js` |
| Role and 401 for every E7 endpoint with an ID or a list (`/members`, `/members/:id`, `/members/:id/reset-link`, `/invitations`, `/invitations/:id`) | Registry entries, run by `roleMatrix.test.js` and `crossTenant.test.js`. Foreign IDs and foreign `warehouseIds` are checked there too |
| `GET /organization` and `PATCH /organization` for every role | Only partly: `organization.isolation.test.js` has Platform admin 403, no token 401 and the Warehouse Admin and Viewer 403 on PATCH. Was missing: one table-driven test from the permission table. Closed by `e7.roleMatrix.test.js` |
| Foreign IDs on `invitations/:id` and `members/:id`, foreign `warehouseIds`, lists without rows of another organization | Covered entry by entry by the harness. Was missing: one explicit test over all E7 entries. Closed by `e7.tenant.test.js` |
| The E7 concurrency tests are stable | Run 20 times in a row (`auth.registerOrganization`, `invitations.accept`, `members.reset`, `e7.tokenGaps`, `members.update.concurrency`, one Jest process each time, `--runInBand`) on 2026-11-10: 20 of 20 runs green, 70 tests each, no flaky run |
