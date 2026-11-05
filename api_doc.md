# API documentation

A short, runnable guide to the endpoints that exist. The contract (every field, status and error
code) is `docs/04_API_Spec.md`; each resource also has a `.http` file in `http/` to try it from
VS Code. Local server: `cd server && npm run dev` (port 3000).

All tenant endpoints need `Authorization: Bearer <token>` from `POST /api/auth/login`. Errors are
always `{ "code", "message", "details" }`. A role without the right gets `403` before the input is
read; an ID that is missing, malformed or belongs to another organization gets `404`.

## Warehouses (`http/warehouses.http`)

| Method and path | Who | What |
| --- | --- | --- |
| `GET /api/warehouses` | every tenant role | Paged list. Query `page` (default 1), `pageSize` (default 20, at most 100), `includeArchived` (`true` or `false`, Owner only). Owner: all active warehouses; Warehouse Admin and Viewer: the assigned ones. Ordered by `code`, then `id`. |
| `GET /api/warehouses/:id` | every tenant role | The warehouse plus `assignedUsers` (`id`, `name`, `role`; no email). `403` for a Warehouse Admin or Viewer who is not assigned; an archived warehouse is visible to the Owner only. |
| `POST /api/warehouses` | Owner | Body `code` (1 to 20 characters, stored uppercase, unique per organization), `name` (1 to 100), optional `address` (at most 255, empty is stored as null). `409` "Kode gudang sudah dipakai." when the code exists. |
| `PATCH /api/warehouses/:id` | Owner | Body with at least one of `code`, `name`, `address` (same rules as `POST`) and `archived` (`true` archives, `false` restores). Archiving is refused with `409` "Gudang masih memiliki stok. Kosongkan stok sebelum mengarsipkan." while any stock row is above 0. An archived warehouse is found only when restoring; otherwise `404`. |

Example:

```bash
curl -X POST http://localhost:3000/api/warehouses \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"code":"gd-sudirman","name":"Gudang Sudirman"}'
# 201 {"id":"...","organizationId":"...","code":"GD-SUDIRMAN","name":"Gudang Sudirman","address":null,...}
```

## Products (`http/products.http`)

| Method and path | Who | What |
| --- | --- | --- |
| `GET /api/products` | every tenant role | Paged list. Query `page` (default 1), `pageSize` (default 20, at most 100), `includeArchived` (`true` or `false`, Owner only). Ordered by `sku`, then `id`. There is no search parameter. |
| `GET /api/products/:id` | every tenant role | One product. `404` for a malformed, missing or foreign ID, and for an archived product unless the caller is the Owner. |
| `POST /api/products` | Owner | Body `sku` (all whitespace removed, stored uppercase, 1 to 50, unique per organization), `name` (1 to 100), `unit` (`bks`, `ktk`, `pcs`, `btl`, `jrg`, `pak`), optional `minStock` (whole number 0 to 1,000,000,000, default 0). `409` "SKU sudah dipakai." when the SKU exists. |
| `PATCH /api/products/:id` | Owner | Body with at least one of `sku`, `name`, `unit`, `minStock` (same rules as `POST`) and `archived` (`true` archives, `false` restores). A product may be archived while it still has stock. An archived product is found only when restoring; otherwise `404`. |

Example:

```bash
curl -X POST http://localhost:3000/api/products \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"sku":"teh-botol-450","name":"Teh Botol 450 ml","unit":"btl","minStock":24}'
# 201 {"id":"...","sku":"TEH-BOTOL-450","unit":"btl","minStock":24,...}
```

## Warehouse assignment (`http/warehouses.http`)

| Method and path | Who | What |
| --- | --- | --- |
| `GET /api/warehouses/:id/members` | Owner | `{ "candidates": [{ "id", "name", "email", "role", "assigned" }] }`: active Warehouse Admins and Viewers, sorted by name. `404` for a missing, malformed, foreign or archived warehouse. |
| `PUT /api/warehouses/:id/members` | Owner | Body `{ "userIds": [...] }` (UUIDs, no duplicates, at most 200) replaces the whole assignment in one transaction; an empty list removes everyone. `200` has the shape of the `GET`. `400` for a wrong shape or a user who is inactive or not a Warehouse Admin or Viewer; `404` for a missing or foreign warehouse or user. |
