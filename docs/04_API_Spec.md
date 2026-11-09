# API Specification: Simpul Stok

|          |                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Version  | 2.2-express (3 Nov 2026)                                                                                                                                                        |
| Purpose  | The list of REST endpoints, who may call them, and the general conventions                                                                                               |
| Audience | People who build endpoints, clients, and API tests                                                                                                                       |
| Related  | The rules for each endpoint are in `02_Functional_Spec.md` (BL); the error format is in BL29; the documentation is run through one `.http` file per resource in the repo |

## REST endpoint list (53)

REST through Express is the only path between the client and the server. Every action, read or write, uses these endpoints. All endpoints follow BL02, BL03, and BL29, are validated with Zod, and return JSON.

| Resource                        | Endpoints                                                                                                                                                                                                                               | Role                                                                                                                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth (7)                        | `POST /api/auth/login`, `POST /api/auth/register-organization`, `POST /api/auth/accept-invite`, `POST /api/auth/reset-password`, `POST /api/auth/logout`, `GET /api/me`, `PATCH /api/me/password`                                       | The first four are public (accept-invite and reset-password use a token); the rest are for any logged-in user                                                                            |
| Organization (2)                | `GET /api/organization`, `PATCH /api/organization`                                                                                                                                                                                      | Read: every tenant user; update: Owner                                                                                                                                                   |
| Members and invitations (7)     | `GET /api/members`, `PATCH /api/members/:id`, `POST /api/members/:id/reset-link`, `GET /api/invitations`, `POST /api/invitations`, `DELETE /api/invitations/:id`, `GET /api/invitations/:token`                                         | Owner; the last one is public with a token                                                                                                                                               |
| Warehouses (6)                  | `GET /api/warehouses`, `POST /api/warehouses`, `GET /api/warehouses/:id`, `PATCH /api/warehouses/:id`, `GET /api/warehouses/:id/members`, `PUT /api/warehouses/:id/members`                                                             | Read according to assigned warehouses; write: Owner                                                                                                                                      |
| Products (4)                    | `GET /api/products`, `POST /api/products`, `GET /api/products/:id`, `PATCH /api/products/:id`                                                                                                                                           | Read: every tenant user; write: Owner                                                                                                                                                    |
| Stock (8)                       | `GET /api/stock`, `POST /api/stock/receive`, `POST /api/stock/adjust`, `POST /api/stock/transfers`, `GET /api/stock/transfers/destinations`, `GET /api/stock/transfers/:id`, `GET /api/stock/movements`, `GET /api/stock/movements/:id` | Read according to assigned warehouses; write: Owner and Warehouse Admin according to warehouse                                                                                           |
| Import and export (4)           | `POST /api/imports`, `POST /api/imports/:id/commit`, `GET /api/exports/stock`, `GET /api/exports/movements`                                                                                                                             | Import: Owner and Warehouse Admin; export according to warehouse. `exports/stock` also serves S07 and accepts `format` csv, xlsx, or pdf; `exports/movements` supports only csv and xlsx |
| Dashboard and notifications (3) | `GET /api/dashboard`, `GET /api/notifications`, `PATCH /api/notifications/:id/read`                                                                                                                                                     | Every tenant user                                                                                                                                                                        |
| Billing (6)                     | `GET /api/billing`, `POST /api/billing/invoices`, `GET /api/billing/invoices`, `GET /api/billing/invoices/:id`, `POST /api/billing/invoices/:id/cancel`, `POST /api/webhooks/xendit`                                                    | Owner; the webhook is public with token verification                                                                                                                                     |
| Audit (1)                       | `GET /api/audit-logs`                                                                                                                                                                                                                   | Owner                                                                                                                                                                                    |
| Platform (3)                    | `GET /api/platform/organizations`, `GET /api/platform/organizations/:id`, `PATCH /api/platform/organizations/:id/status`                                                                                                                | Platform admin                                                                                                                                                                           |
| System (2)                      | `GET /api/cron/daily`, `GET /api/health`                                                                                                                                                                                                | Cron with a secret; health is public                                                                                                                                                     |

Endpoints that exist in the code have their own section below, headed `METHOD /path`; the others in this list are planned for M2 and M3.

Endpoints that change stock (`receive`, `adjust`, `transfers`, `imports/:id/commit`) accept an `Idempotency-Key` header (BL14). The history (`GET /api/stock/movements`) uses cursor pagination (BL16); other list endpoints use `page` and `pageSize` and return a total. Archiving and restoring a warehouse or product goes through `PATCH` (`archived: true` or `false`). Every write is also checked by BL23.

## Idempotency (BL14)

**Request header `Idempotency-Key`.** Required on every write that changes stock (`POST /api/stock/receive`, `POST /api/stock/adjust`, `POST /api/stock/transfers`, `POST /api/imports/:id/commit`). The value must be a UUID (the client creates a new one each time a form is opened). A missing or malformed header returns `400 { "code": "VALIDATION_ERROR", "message": "...", "details": [{ "source": "header", "path": "Idempotency-Key", "message": "..." }] }`. The check runs after authentication and the role check and before the body is validated. Keys are compared in lower case.

**Scope.** A key is unique per organization and endpoint. The same key on another endpoint, or in another organization, is a different key.

**Replay.** If a request with the same key already succeeded, the server does not act again. It answers with the same status and body shape as the first response, built from the stored resource, and adds the response header `Idempotency-Replayed: true`. The body of the repeated request is not compared. Two requests with the same key at the same time produce one effect; one of them is answered as a replay.

**A replay is authorized again.** If the caller may not see the stored resource (for example a Warehouse Admin of another warehouse), the answer is `404 NOT_FOUND`, identical to a resource that does not exist. A caller who may not perform the action gets `403` even when the key exists.

**Failures.** A request that fails (4xx or 5xx) stores no key, so the same key can be sent again. Keys older than 24 hours are removed by the daily cron; after that the same key counts as new.

`POST /api/billing/invoices` determines `kind` from the organization's condition (INITIAL for a trial, PLAN_CHANGE if subscribed and the plan differs, RENEWAL if the plan is the same) and accepts `planId` (BL21). `POST /api/billing/invoices/:id/cancel` is only for PENDING PLAN_CHANGE invoices and sets them to EXPIRED. `GET /api/billing` returns the effective limits (BL20).

## Auth endpoints: request and response

Every error body is `{ code, message, details }` (BL29). All responses below carry `Cache-Control: no-store`. Error `message` texts are shown to users, so they are in Indonesian.

**Authentication.** Protected endpoints require `Authorization: Bearer <token>`. The token is a JWT signed with `JWT_SECRET`, valid for 8 hours with no extension, and holds only `sub` (the user ID), `iat` and `exp`. The role and the organization are never read from the token: the user is loaded from the database on every request. A token is refused when the user is inactive, or when it was issued before the last password change (compared in whole seconds, so a token issued in the same second as the change is still accepted).

**No CSRF check.** The browser does not attach the token by itself, so a request from another site cannot carry it. Cross-origin access is limited by CORS to the origins listed in `CORS_ORIGIN`, and `helmet` sets the security headers. The price of this choice is that a token kept in `localStorage` can be stolen by an XSS flaw; see the decision record on bearer tokens.

### `POST /api/auth/login`

Public. Body: `{ "email": string (1-254), "password": string (1-128) }`. Only the shape is validated; the email is matched in lowercase.

| Status | Body |
| ------ | ---- |
| 200 | `{ "token", "user": { "id", "name", "email", "role" }, "redirectTo": "/dashboard" }`, or `"/platform"` for `PLATFORM_ADMIN` |
| 400 | `VALIDATION_ERROR` (missing field, wrong shape, or body is not JSON) |
| 401 | `{ "code": "INVALID_CREDENTIALS", "message": "Email atau password salah.", "details": null }` (unknown email, wrong password, inactive user, or password over 72 bytes: one identical answer) |

### `POST /api/auth/register-organization`

Public, and not subject to the subscription check (no organization exists yet). Body, all fields required and unknown keys rejected: `{ "organizationName": string (1-100), "slug": string (3-30 lowercase letters and digits), "name": string (1-100), "email": string (valid email, trimmed, stored lowercase), "password": string }`. The password rules of BL01 apply, and the password may not equal the email or the part before the `@`.

One transaction creates the Organization (status `TRIAL`), the Owner and a Subscription to the Starter plan (`currentPeriodStart` now, `currentPeriodEnd` now + 30 days, `graceUntil` period end + 3 days, `billingDay` empty). A failure leaves no row behind.

| Status | Body |
| ------ | ---- |
| 201 | `{ "token", "user": { "id", "name", "email", "role": "OWNER" }, "organization": { "id", "name", "slug", "status": "TRIAL" }, "redirectTo": "/dashboard" }`; the token is the same kind as at login (8 hours) |
| 400 | `VALIDATION_ERROR` (invalid field, unknown key, or a refused password with its reason in `message`) |
| 409 | `CONFLICT` with `details: [{ "source": "body", "path": "email" \| "slug", "message" }]`: the email or slug is taken. The unique constraint decides, so two simultaneous sign-ups cannot both succeed |

### `POST /api/auth/accept-invite`

Public (the token in the body is the proof) and not subject to the subscription check. Body, all required and unknown keys rejected: `{ "token": string, "name": string (1-100), "password": string }`. The password rules of BL01 apply, and the password may not equal the invited email or the part before the `@`.

In one transaction that locks the invitation row (`SELECT ... FOR UPDATE`) and judges it again, the server creates the user, replaces the warehouse assignment (only warehouses that are still active) and marks the invitation used. The email of an **inactive member of the same organization** reactivates that user with the new name, password, role and assignment; every token that user held earlier stops working. Of two simultaneous acceptances of one token exactly one succeeds.

| Status | Body |
| ------ | ---- |
| 200 | `{ "token", "user": { "id", "name", "email", "role" }, "redirectTo": "/dashboard" }` |
| 400 | `VALIDATION_ERROR` (shape, or the reason the password is refused in `message` with `details: [{ "source": "body", "path": "password", "message" }]`) |
| 403 | `PLAN_LIMIT_REACHED` (BL20): the member limit is checked again inside the transaction, under the organization lock, for a new member and for a reactivated one; the invitation stays usable. `details: { "resource": "MEMBER", "limit", "used" }`; nothing is written |
| 404 | `NOT_FOUND`, identical to `GET /api/invitations/:token`: the token is malformed, unknown, expired or already used |
| 409 | `CONFLICT`: the email now belongs to an active user, to a user of another organization, or to an Owner |

### `POST /api/auth/logout`

Any caller, with or without a token; no body. Always `204` with no body. The server keeps no session, so nothing is revoked on the server: the client deletes its token. A token stays valid until it expires or until the password changes.

### `GET /api/me`

Any logged-in user.

| Status | Body |
| ------ | ---- |
| 200 | `{ "user": { "id", "name", "email", "role" }, "organization": { "id", "name", "slug", "status" } \| null }` (`organization` is `null` for a platform admin) |
| 401 | `{ "code": "UNAUTHENTICATED", "message": "Sesi tidak valid. Silakan masuk lagi.", "details": null }` (no header, malformed, bad or expired token, inactive or missing user, or a token issued before the last password change) |

### `PATCH /api/me/password`

Any logged-in user, in every subscription state (BL23). Body: `{ "currentPassword": string (1-128), "newPassword": string (1-128) }`. The password rules apply to `newPassword` only, and only after `currentPassword` is verified.

| Status | Body |
| ------ | ---- |
| 200 | `{ "token" }`: a new token for this device. Tokens issued earlier (including on other devices) get `401` afterwards. |
| 400 | `{ "code": "INVALID_CURRENT_PASSWORD", "message": "Password saat ini salah.", "details": null }` |
| 400 | `VALIDATION_ERROR` (missing field, wrong shape, or body is not JSON) |
| 400 | `VALIDATION_ERROR` with the reason the new password is refused in `message`, and `details: [{ "source": "body", "path": "newPassword", "message" }]` |
| 401 | `UNAUTHENTICATED`, as for `GET /api/me` |

## Error codes

Every error body is `{ code, message, details }` (BL29), with no stack trace. `message` is Indonesian. The codes below are the complete set the code can return (`helpers/errors.js`, plus the ones set where a check happens).

| Code                       | Status | Meaning                                                                                                                                                                       |
| -------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VALIDATION_ERROR`         | 400    | Header, query, path or body failed validation. `details` is `[{ "source": "header" \| "query" \| "params" \| "body", "path", "message" }]`, or `null` for a rule found later. |
| `INVALID_CURRENT_PASSWORD` | 400    | `PATCH /api/me/password` only: the current password is wrong.                                                                                                                 |
| `UNAUTHENTICATED`          | 401    | No valid token.                                                                                                                                                             |
| `INVALID_CREDENTIALS`      | 401    | `POST /api/auth/login` only: wrong email or password.                                                                                                                         |
| `FORBIDDEN`                | 403    | The role may not do this, the warehouse is outside the caller's reach, or the caller is a platform admin on a tenant endpoint.                                                |
| `PLAN_LIMIT_REACHED`       | 403    | Creating or restoring a warehouse or product, inviting a member, or accepting an invitation would exceed the plan limit (BL20). `details: { "resource": "WAREHOUSE" \| "PRODUCT" \| "MEMBER", "limit", "used" }`. |
| `SUBSCRIPTION_READ_ONLY`   | 403    | Defined for a read-only subscription; no endpoint returns it yet (E8).                                                                                                        |
| `NOT_FOUND`                | 404    | Missing, or belongs to another organization (one identical body, rule 2).                                                                                                     |
| `CONFLICT`                 | 409    | The request is valid but the current state refuses it (duplicate code or SKU, archived target, stock still present, quantity limit).                                          |
| `INSUFFICIENT_STOCK`       | 409    | A transfer needs more than the source holds; `details: { "productId" }`.                                                                                                      |
| `INTERNAL_ERROR`           | 500    | Unexpected failure. No cause in the body.                                                                                                                                     |
| `SERVICE_UNAVAILABLE`      | 503    | The server cannot take the request now (the database connection pool is full). Retry later. No cause in the body.                                                             |

Every tenant endpoint below also answers `401 UNAUTHENTICATED`, `403 FORBIDDEN` for a platform admin (a platform admin has no organization), `400 VALIDATION_ERROR` for invalid input and `500 INTERNAL_ERROR`; these are not repeated in each table. A role without the right gets `403` before the query or body is validated.

## Organization (S15)

### `GET /api/organization`

Every tenant role (`organization.read`); a platform admin gets `403`. There is no ID in the URL: the organization is the caller's own, from the request context.

| Status | Body |
| ------ | ---- |
| 200 | `{ "organization": { "id", "name", "slug", "address" (string or null), "status", "createdAt" } }` |

### `PATCH /api/organization`

Owner only (`organization.manage`; other roles get `403` before the body is read). Body (strict, at least one field): `name` (1 to 100) and `address` (up to 255; empty is stored `null`), the same rules as a warehouse. The slug, the time zone and the format are read-only: a body with `slug`, `status`, `id` or `organizationId` is `400`. The organization is always the caller's own.

| Status | Body |
| ------ | ---- |
| 200 | `{ "organization": { ... } }` as in `GET /api/organization` |
| 400 | `VALIDATION_ERROR` |

## Members and invitations (S14, BL05)

An invitation is a copied link (no email is sent). The token is 32 random bytes in base64url, stored only as a SHA-256 hash, valid for 7 days and single-use. Every response under `/api/invitations` carries `Cache-Control: no-store`. Invitation `status` is derived: `PENDING` (usable), `EXPIRED` (past its time) or `ACCEPTED` (never listed).

### `GET /api/members`

Owner only (`member.manage`). Query: `page` (default 1) and `pageSize` (1 to 100, default 20); other keys are `400`. Lists every user of the organization, active and inactive, the Owner first and then by name. A platform admin never appears.

| Status | Body |
| ------ | ---- |
| 200 | `{ "items": [{ "id", "name", "email", "role", "isActive", "lastLoginAt", "allWarehouses", "warehouses": [{ "id", "code" }] }], "total", "page", "pageSize", "usage": { "used", "limit" } }`. `usage` is the member indicator (BL20): active users (the Owner included, inactive members and pending invitations not) against the effective member limit. `warehouses` holds the assigned active warehouses (ordered by code); an Owner has `allWarehouses: true` and an empty list. No password hash and no reset columns |

### `PATCH /api/members/:id`

Owner only (`member.manage`; other roles get `403` before the ID or body is looked at). Body (strict, at least one field): `role` (`WAREHOUSE_ADMIN` or `VIEWER`; `OWNER` is `400`), `isActive` (only `false`; `true` is `400`, reactivation goes through a new invitation) and `warehouseIds` (UUIDs, no duplicates, at most 200: the **whole** new assignment, replaced in one transaction). The member row and every involved warehouse are locked (warehouses in ID order), so a change and an archive at the same moment never leave an assignment on a warehouse archived first.

The change applies on the member's next request, because role and status are read from the database on every request: a deactivated member's existing token gets `401`, and a member whose role changed is judged by the new role.

| Status | Body |
| ------ | ---- |
| 200 | The updated member, in the shape of one row of `GET /api/members` |
| 400 | `VALIDATION_ERROR` |
| 404 | `NOT_FOUND`: the ID is malformed, missing, of another organization or of a platform admin; or a warehouse in `warehouseIds` is missing, archived or of another organization (identical answers) |
| 409 | `CONFLICT`: the target is the Owner (every change to an Owner is refused, so the last Owner can never be deactivated or demoted) |

### `POST /api/members/:id/reset-link`

Owner only (`member.manage`; other roles get `403` before the ID is looked at). No body (an empty object is accepted, any key is `400`). Creates a one-time password reset link for **another active member** of the organization (BL07). The token is 32 random bytes in base64url; only its SHA-256 hash and the expiry (now + 1 day) are stored. The member row is locked, and the new hash overwrites the old one, so creating a new link cancels the previous link at once. The response carries `Cache-Control: no-store`.

| Status | Body |
| ------ | ---- |
| 201 | `{ "token", "expiresAt" }`. This is the only response that ever holds the raw token; no response holds the stored hash. The client builds the link `/reset/<token>` |
| 400 | `VALIDATION_ERROR` (the body has a key) |
| 404 | `NOT_FOUND`: the ID is malformed, missing, of another organization or of a platform admin (one identical answer) |
| 409 | `CONFLICT`: the target is the Owner (the caller) or an inactive member |

### `POST /api/invitations`

Owner only (`member.manage`; other roles get `403` before the body is read). Body (strict): `email` (valid, trimmed, stored lowercase), `role` (`WAREHOUSE_ADMIN` or `VIEWER`; `OWNER` is `400`) and `warehouseIds` (UUIDs, no duplicates, at most 200, may be empty or left out).

| Status | Body |
| ------ | ---- |
| 201 | `{ "invitation": { "id", "email", "role", "warehouseIds", "expiresAt", "status": "PENDING" }, "token" }`. This is the only response that ever holds the raw token; no response holds `tokenHash` |
| 400 | `VALIDATION_ERROR` |
| 403 | `PLAN_LIMIT_REACHED` (BL20): the organization already has as many active users as its plan allows (pending invitations are not counted; the limit is checked again at acceptance). `details: { "resource": "MEMBER", "limit", "used" }`; nothing is written |
| 404 | `NOT_FOUND`: a warehouse that is missing, archived or of another organization (one identical answer) |
| 409 | `CONFLICT` with `details: [{ "source": "body", "path": "email", "message" }]`: the email belongs to an active user, or to a user of another organization, or already has a pending invitation in this organization. The email of an inactive member of the same organization may be invited again. A pending invitation of another organization is not read here; that clash is refused when the invitation is accepted |

### `GET /api/invitations`

Owner only (`member.manage`). Query: `page` (default 1) and `pageSize` (1 to 100, default 20); other keys are `400`. Lists the `PENDING` and `EXPIRED` invitations of the organization, newest first. Accepted invitations are not listed.

| Status | Body |
| ------ | ---- |
| 200 | `{ "items": [{ "id", "email", "role", "warehouseIds", "expiresAt", "status" }], "total", "page", "pageSize" }`; no token and no `tokenHash` |

### `GET /api/invitations/:token`

Public (no token in the header: the token in the URL is the proof). The raw token is hashed and looked up. A malformed, unknown, expired or already used token is one identical answer, so the response never says which.

| Status | Body |
| ------ | ---- |
| 200 | `{ "email", "role", "organizationName", "expiresAt" }` |
| 404 | `{ "code": "NOT_FOUND", "message": "Data tidak ditemukan.", "details": null }` |

### `DELETE /api/invitations/:id`

Owner only (`member.manage`). Cancels a `PENDING` or `EXPIRED` invitation by deleting its row, so its link stops working.

| Status | Body |
| ------ | ---- |
| 204 | no body |
| 404 | `NOT_FOUND`: the ID is malformed, missing, of another organization, or the invitation was already accepted (one identical answer) |

## Warehouses (S05, BL08)

### `GET /api/warehouses`

Every tenant role (`warehouse.read`). Owner: every active warehouse; Warehouse Admin and Viewer: only the assigned ones. Query: `page` (default 1), `pageSize` (default 20, at most 100), `includeArchived` (`true` or `false`, default `false`; honoured for the Owner only). Order: `code`, then `id`.

| Status | Body                                                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | `{ "items": [{ "id", "organizationId", "code", "name", "address", "archivedAt", "createdAt", "updatedAt" }], "total", "page", "pageSize" }` |
| 400    | `VALIDATION_ERROR`: `page` below 1, `pageSize` outside 1 to 100, or `includeArchived` not `true` or `false`                                 |

### `POST /api/warehouses`

Owner only (`warehouse.manage`). Body (unknown fields, including `organizationId`, are rejected): `code` (1 to 20 characters after trimming, stored uppercase, unique per organization), `name` (1 to 100), `address` (optional, at most 255; empty is stored null).

| Status | Body                                                                            |
| ------ | ------------------------------------------------------------------------------- |
| 201    | The created warehouse, same shape as an item of the list above                  |
| 400    | `VALIDATION_ERROR`: wrong shape, a field out of range, or an unknown field      |
| 403    | `FORBIDDEN`: not the Owner                                                      |
| 403    | `PLAN_LIMIT_REACHED` (BL20): the organization already uses all the warehouses of its plan. `details: { "resource": "WAREHOUSE", "limit", "used" }`; nothing is written |
| 409    | `CONFLICT`: "Kode gudang sudah dipakai." (the code exists in this organization) |

### `PATCH /api/warehouses/:id`

Owner only (`warehouse.manage`). Body (strict, at least one field): `code`, `name`, `address` (same rules as `POST`) and `archived` (`true` archives, `false` restores). Archiving locks the warehouse row and refuses while any stock row is above 0 (ADR 0013).

| Status | Body                                                                                                              |
| ------ | ----------------------------------------------------------------------------------------------------------------- |
| 200    | The updated warehouse                                                                                             |
| 400    | `VALIDATION_ERROR`: no field given, wrong shape, or an unknown field                                              |
| 403    | `FORBIDDEN`: not the Owner                                                                                        |
| 403    | `PLAN_LIMIT_REACHED` (BL20): restoring (`archived: false`) an archived warehouse would exceed the plan limit, as a create would. `details: { "resource": "WAREHOUSE", "limit", "used" }`; nothing is written |
| 404    | `NOT_FOUND`: missing or foreign. An archived warehouse is found only when restoring (`archived: false`).          |
| 409    | `CONFLICT`: the code exists, or "Gudang masih memiliki stok. Kosongkan stok sebelum mengarsipkan." when archiving |

## Products (S07, BL09)

### `GET /api/products`

Every tenant role (`product.read`). Query: `page` (default 1), `pageSize` (default 20, at most 100), `includeArchived` (default `false`; honoured for the Owner only). Order: `sku`, then `id`.

| Status | Body                                                                                                                                                |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | `{ "items": [{ "id", "organizationId", "sku", "name", "unit", "minStock", "archivedAt", "createdAt", "updatedAt" }], "total", "page", "pageSize" }` |
| 400    | `VALIDATION_ERROR`: as for `GET /api/warehouses`                                                                                                    |

### `POST /api/products`

Owner only (`product.manage`). Body (strict): `sku` (whitespace removed, stored uppercase, 1 to 50 characters, unique per organization), `name` (1 to 100), `unit` (`bks`, `ktk`, `pcs`, `btl`, `jrg` or `pak`), `minStock` (optional whole number 0 to 1,000,000,000, default 0).

| Status | Body                                                         |
| ------ | ------------------------------------------------------------ |
| 201    | The created product, same shape as an item of the list above |
| 400    | `VALIDATION_ERROR`                                           |
| 403    | `FORBIDDEN`: not the Owner                                   |
| 403    | `PLAN_LIMIT_REACHED` (BL20): the organization already uses all the products of its plan. `details: { "resource": "PRODUCT", "limit", "used" }`; nothing is written |
| 409    | `CONFLICT`: "SKU sudah dipakai."                             |

### `GET /api/products/:id`

Every tenant role (`product.read`). An archived product is visible to the Owner only.

| Status | Body                                                                                     |
| ------ | ---------------------------------------------------------------------------------------- |
| 200    | The product                                                                              |
| 404    | `NOT_FOUND`: missing, malformed id, foreign, or archived and the caller is not the Owner |

### `PATCH /api/products/:id`

Owner only (`product.manage`). Body (strict, at least one field): `sku`, `name`, `unit`, `minStock` (same rules as `POST`) and `archived` (`true` archives, `false` restores). Archiving a product that still has stock is allowed (BL09).

| Status | Body                                                                  |
| ------ | --------------------------------------------------------------------- |
| 200    | The updated product                                                   |
| 400    | `VALIDATION_ERROR`: no field given, wrong shape, or an unknown field  |
| 403    | `FORBIDDEN`: not the Owner                                            |
| 403    | `PLAN_LIMIT_REACHED` (BL20): restoring an archived product would exceed the plan limit. `details: { "resource": "PRODUCT", "limit", "used" }`; nothing is written |
| 404    | `NOT_FOUND`: missing or foreign (an archived one only when restoring) |
| 409    | `CONFLICT`: "SKU sudah dipakai."                                      |

## Warehouse detail (S06)

### `GET /api/warehouses/:id`

Every tenant role that may read the warehouse (`warehouse.read`; Warehouse Admin and Viewer only when assigned, else `403`). The `200` body is the warehouse (`id`, `code`, `name`, `address`, `archivedAt`, ...) plus `"assignedUsers": [{ "id", "name", "role" }]`: the active users assigned to it, sorted by name, without emails (the list is empty when nobody is assigned). `404` when the warehouse is missing or belongs to another organization; an archived warehouse is visible to the Owner only.

## Warehouse assignment (BL10)

### `GET /api/warehouses/:id/members`

Owner only (`member.manage`; other roles get `403` before anything else). Lists the users who can be assigned to the warehouse: active users of the organization whose role is `WAREHOUSE_ADMIN` or `VIEWER` (the Owner and platform admins never appear).

| Status | Body                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 200    | `{ "candidates": [{ "id", "name", "email", "role", "assigned": boolean }] }`, sorted by name; `assigned` is for this warehouse |
| 404    | `NOT_FOUND`: the warehouse is missing, archived, or belongs to another organization                                            |

### `PUT /api/warehouses/:id/members`

Owner only (`member.manage`). Body: `{ "userIds": string[] }`: UUIDs, no duplicates, at most 200. It **replaces** the whole set of assignments of this warehouse in one transaction, so repeating the same request gives the same result. An empty list removes every assignment.

| Status | Body                                                                                                                                                        |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | Same shape as the `GET` above, after the change                                                                                                             |
| 400    | `VALIDATION_ERROR`: wrong shape, duplicate or malformed IDs, more than 200, or a user that is inactive or not a Warehouse Admin or Viewer (generic message) |
| 404    | `NOT_FOUND`: the warehouse is missing, archived or foreign, or any user ID is missing or belongs to another organization (the same body for both)           |

## Stock summary (S09, BL15, BL16)

### `GET /api/stock`

Every role (`stock.read`). Lists one row per (warehouse, product) pair that **has a stock row**; a pair without a row is not returned (the UI draws that strip in S06 and S08). Only warehouses the caller may access are included (Owner: all active warehouses; others: the assigned ones).

| Query         | Rule                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `warehouseId` | optional UUID; authorized first (`403` for a warehouse the caller cannot access, the same body for a foreign and a missing id) |
| `productId`   | optional UUID; a foreign or unknown product simply gives an empty list                                                         |
| `q`           | optional, at most 100 characters; case-insensitive "contains" on the product SKU or name                                       |
| `status`      | optional `OUT`, `LOW` or `OK`                                                                                                  |
| `page`        | default 1                                                                                                                      |
| `pageSize`    | default 20, at most 100                                                                                                        |

Status of a pair uses the minimum of its own product: `OUT` when quantity is 0; `LOW` when quantity is above 0 and below `minStock`; `OK` when quantity is above 0 and at or above `minStock` (so `minStock` 0 or 1 is never `LOW`). Rows of archived products appear only while their quantity is above 0 (`product.archived: true`). Order: product name, warehouse code, then IDs.

| Status | Body                                                                                                                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 200    | `{ "items": [{ "warehouse": { "id", "code", "name" }, "product": { "id", "sku", "name", "unit", "minStock", "archived" }, "quantity", "status", "updatedAt" }], "total", "page", "pageSize", "summary": { "out", "low", "ok" } }`; `summary` counts the same filters except `status` |
| 400    | `VALIDATION_ERROR`: a malformed ID, an unknown `status`, `page` below 1, or `pageSize` outside 1 to 100                                                                                                                                                                              |
| 403    | `FORBIDDEN`: `warehouseId` is not accessible to the caller                                                                                                                                                                                                                           |

## Stock receipt (BL11)

### `POST /api/stock/receive`

Owner and Warehouse Admin (`stock.receive`; a Warehouse Admin only for an assigned warehouse). Header `Idempotency-Key` (UUID) is required, see "Idempotency (BL14)". Body (unknown fields, including `organizationId`, are rejected):

| Field         | Rule                                                                  |
| ------------- | --------------------------------------------------------------------- |
| `warehouseId` | UUID                                                                  |
| `productId`   | UUID                                                                  |
| `quantity`    | whole number from 1 to 1,000,000                                      |
| `note`        | optional, at most 255 characters after trimming; empty is stored null |

One transaction locks the warehouse row, rejects an archived warehouse or product, creates the stock row of the pair when it is missing, adds `quantity` and writes a `RECEIVE` movement (ADR 0013). The response holds only immutable data of that movement, never the current stock, so a replay equals the first answer; read the stock from `GET /api/stock`.

| Status | Body                                                                                                                                                                                                     |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 201    | `{ "id", "warehouseId", "productId", "quantity", "createdAt" }`; a replay of the same key gives the same body plus the header `Idempotency-Replayed: true`                                               |
| 400    | `VALIDATION_ERROR`: missing or malformed `Idempotency-Key`, wrong shape, `quantity` out of range, `note` over 255 characters, or an unknown field                                                        |
| 403    | `FORBIDDEN`: a Viewer, or a warehouse that is not assigned to a Warehouse Admin, is archived, belongs to another organization or does not exist (the same body for all of these)                         |
| 404    | `NOT_FOUND`: a product that belongs to another organization or does not exist (the same body for both)                                                                                                   |
| 409    | `CONFLICT` (Indonesian message): the product is archived; the warehouse was archived while the request was running; or the new quantity would pass the largest value the column can hold (2,147,483,647) |

## Stock adjustment (BL12)

### `POST /api/stock/adjust`

Owner and Warehouse Admin (`stock.adjust`; a Warehouse Admin only for an assigned warehouse). Header `Idempotency-Key` (UUID) is required, see "Idempotency (BL14)". Body (strict):

| Field         | Rule                                                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `warehouseId` | UUID                                                                                                                         |
| `productId`   | UUID                                                                                                                         |
| `mode`        | `SET` (`value` is the new quantity, 0 to 1,000,000) or `DELTA` (`value` is a non-zero whole number, -1,000,000 to 1,000,000) |
| `value`       | whole number, see `mode`                                                                                                     |
| `reason`      | `STOCK_OPNAME`, `DAMAGED`, `LOST` or `CORRECTION`                                                                            |
| `note`        | optional, at most 255 characters after trimming; empty is stored null                                                        |

One transaction locks the warehouse row, reads the current quantity, writes the new one with a conditional update and writes an `ADJUST` movement (ADR 0013). An archived product may be adjusted (so leftover stock can be zeroed); an archived warehouse may not.

| Status | Body                                                                                                                                                                                                 |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 201    | `{ "id", "warehouseId", "productId", "quantity", "createdAt", "reason" }` where `quantity` is the signed change; a replay gives the same body plus `Idempotency-Replayed: true`                      |
| 400    | `VALIDATION_ERROR`: missing or malformed `Idempotency-Key`, wrong shape, unknown field, `value` out of range, or the new quantity equals the current one ("Stok baru sama dengan stok saat ini ...") |
| 403    | `FORBIDDEN`: a Viewer, or a warehouse that is not assigned to a Warehouse Admin, is archived, belongs to another organization or does not exist (the same body for all of these)                     |
| 404    | `NOT_FOUND`: a product that belongs to another organization or does not exist                                                                                                                        |
| 409    | `CONFLICT`: the new quantity would be below 0; the warehouse was archived while the request ran; or the stock changed during the request ("Stok berubah saat disesuaikan. Coba lagi.")               |

## Stock history (S10, BL16)

### `GET /api/stock/movements`

Every tenant role (`history.read`, warehouse-level). Only movements of the caller's warehouses are returned (Owner: all active warehouses). Newest first, cursor pagination, 50 rows per page. Query, all optional:

| Query         | Rule                                                                       |
| ------------- | -------------------------------------------------------------------------- |
| `productId`   | UUID                                                                       |
| `warehouseId` | UUID; a warehouse outside the caller's reach gives an empty list, not 403  |
| `type`        | `RECEIVE`, `ADJUST`, `TRANSFER_OUT`, `TRANSFER_IN` or `IMPORT`             |
| `createdById` | UUID                                                                       |
| `from`, `to`  | ISO 8601 instants with an offset; `from` is inclusive, `to` is exclusive   |
| `cursor`      | the `nextCursor` of the previous page, opaque; any other value gives `400` |

| Status | Body                                                                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 200    | `{ "items": [{ "id", "warehouseId", "productId", "type", "quantityDelta", "reason", "note", "transferId", "createdById", "createdAt" }], "nextCursor": string \| null }` |
| 400    | `VALIDATION_ERROR`: a malformed ID, an unknown `type`, a bad instant or a bad `cursor`                                                                                   |

### `GET /api/stock/movements/:id`

Every tenant role (`history.read`). A malformed ID, a missing one, another organization's and one outside the caller's warehouses all give the same `404 NOT_FOUND`.

| Status | Body                                                                                                                                                                                                                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | An item of the list above plus `"warehouse": { "id", "code", "name" }`, `"product": { "id", "sku", "name", "unit" }`, `"createdBy": { "id", "name", "role" } \| null` and `"transfer": { "id", "code", "fromWarehouse": { "id", "name" }, "toWarehouse": { ... } } \| null`. No email. |
| 404    | `NOT_FOUND`: see above                                                                                                                                                                                                                                                                 |

## Stock transfer (BL13, BL14)

### `POST /api/stock/transfers`

Owner and Warehouse Admin (`stock.transfer`, judged against the SOURCE warehouse; a Warehouse Admin only for an assigned source). The destination may be any active warehouse of the organization. Header `Idempotency-Key` (UUID) is required, see "Idempotency (BL14)". Body (unknown fields, including `organizationId`, are rejected):

| Field               | Rule                                                                  |
| ------------------- | --------------------------------------------------------------------- |
| `fromWarehouseId`   | UUID, the source                                                      |
| `toWarehouseId`     | UUID, must differ from `fromWarehouseId`                              |
| `items`             | 1 to 50 entries, each product at most once                            |
| `items[].productId` | UUID                                                                  |
| `items[].quantity`  | whole number from 1 to 1,000,000                                      |
| `note`              | optional, at most 255 characters after trimming; empty is stored null |

One transaction locks both warehouses in ascending id order, rejects an archived source, destination or product, decrements the source with a conditional update, increments the destination, creates the transfer (`MT-0001`, sequential per organization) and writes a `TRANSFER_OUT` and a `TRANSFER_IN` movement per item (ADR 0013, 0014). The response holds only immutable data, never stock balances, so a replay equals the first answer.

| Status | Body                                                                                                                                                                                                                         |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 201    | `{ "id", "code", "fromWarehouseId", "toWarehouseId", "items": [{ "productId", "quantity" }], "note", "createdAt" }`; a replay of the same key gives the same body plus the header `Idempotency-Replayed: true`               |
| 400    | `VALIDATION_ERROR`: missing or malformed `Idempotency-Key`, wrong shape, 0 or more than 50 items, a duplicate product, `quantity` out of range, source equal to destination, `note` over 255 characters, or an unknown field |
| 403    | `FORBIDDEN`: a Viewer, or a source warehouse that is not assigned to a Warehouse Admin, is archived, belongs to another organization or does not exist (the same body for all of these)                                      |
| 404    | `NOT_FOUND`: a destination warehouse or a product that belongs to another organization or does not exist (the same body for both)                                                                                            |
| 409    | `CONFLICT`: the source, destination or a product is archived; the quantity at the destination would pass 2,147,483,647; or too many concurrent transfers collided ("Terlalu banyak mutasi bersamaan, coba lagi.")            |
| 409    | `INSUFFICIENT_STOCK` with `details: { "productId" }` of the first item (ordered by product id) that the source cannot cover; nothing is written                                                                              |

### `GET /api/stock/transfers/:id`

Any tenant role (`history.read`, warehouse-level). Visible when the caller may see the source OR the destination warehouse (an Owner sees all). A malformed ID, a missing one, another organization's and one outside the caller's warehouses all give the same `404 NOT_FOUND`. Used by S12 and by the link in P13.

| Status | Body                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | `{ "id", "code", "note", "createdAt", "createdBy": { "id", "name", "role" } \| null, "fromWarehouse": { "id", "code", "name", "address" }, "toWarehouse": { ... }, "items": [{ "productId", "sku", "name", "unit", "quantity", "outMovementId", "inMovementId" }] }`; items ordered by product ID; a movement ID is `null` when its warehouse is not one the caller may see (P13 would answer 404). No stock balances, no email |
| 404    | `NOT_FOUND`: see above                                                                                                                                                                                                                                                                                                                                                                                                          |

### `GET /api/stock/transfers/destinations`

Owner and Warehouse Admin (`transfer.destinations`, organization-level); a Viewer gets 403. Returns every active warehouse of the organization, because `GET /api/warehouses` lists only the assigned ones for a Warehouse Admin and the destination of a transfer may be any warehouse (BL13). No query parameters.

| Status | Body                                                                                           |
| ------ | ---------------------------------------------------------------------------------------------- |
| 200    | `{ "items": [{ "id", "code", "name" }] }`, ordered by `code`; archived warehouses are left out |
| 403    | `FORBIDDEN`: a Viewer                                                                          |

## Dashboard (S04, BL16)

### `GET /api/dashboard`

Every tenant role. No query, no cache: each call reads the database. `totalProducts` counts the active products of the whole organization; every other figure covers only the caller's warehouses (an Owner has all active ones). `totalUnits` includes the units of archived products; `lowCount` and `outCount` leave archived products out. "Today" is the WIB calendar day (00:00 to 24:00 WIB). A transfer writes two movements, so it counts twice in `movementsToday` and can show twice in `recentActivity`.

| Status | Body                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 200    | `{ "summary": { "totalProducts", "totalUnits", "lowCount", "outCount", "movementsToday" }, "restock": { "items": [{ "warehouse": { "id", "code", "name" }, "product": { "id", "sku", "name", "unit", "minStock" }, "quantity", "status": "OUT" \| "LOW" }], "total" }, "recentActivity": [{ "id", "type", "quantityDelta", "reason", "createdAt", "warehouse": { "id", "code", "name" }, "product": { "id", "sku", "name", "unit" }, "createdBy": { "id", "name" } \| null, "transfer": { "id", "code" } \| null }] }`. `restock.items` holds at most 5 pairs, the furthest below `minStock` first; `recentActivity` holds the 5 newest movements. |

## System

### `GET /api/health`

Public, no token. The commit comes from the optional `COMMIT_SHA` environment variable (`null` when it is unset). Never cached (`Cache-Control: no-store`). The database check is cached inside the server for 60 seconds when up and 15 seconds when down. The body has no error text, host or database version.

| Status | Body                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------ |
| 200    | `{ "status": "ok", "app": { "commit": string \| null }, "database": { "status": "up", "latencyMs" } }` |
| 503    | `{ "status": "error", "app": { "commit": string \| null }, "database": { "status": "down" } }`         |
