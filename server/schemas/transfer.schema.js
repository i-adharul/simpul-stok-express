const { z } = require("zod");
const { id, note } = require("./stock.schema");

// POST /api/stock/transfers (BL13). validate() makes the top level strict (`organizationId` and any
// other unknown key is a 400); the item object is made strict here, so a key inside an item is
// refused too. Messages are Indonesian (docs/04). The service repeats the same shape rules.
const MAX_ITEMS = 50;

const itemSchema = z.strictObject({
  productId: id,
  quantity: z.int().min(1).max(1000000),
});

// Rules that look at more than one field are checked in superRefine, each on the path of the field
// to blame: the destination for "same as source", the repeated item for "product twice".
const transferSchema = z
  .object({
    fromWarehouseId: id,
    toWarehouseId: id,
    items: z.array(itemSchema).min(1).max(MAX_ITEMS),
    note: note.optional(),
  })
  .superRefine((body, ctx) => {
    if (body.fromWarehouseId === body.toWarehouseId) {
      ctx.addIssue({ code: "custom", path: ["toWarehouseId"], message: "Gudang tujuan harus berbeda dari gudang asal." });
    }
    const seen = new Set();
    body.items.forEach((item, index) => {
      if (seen.has(item.productId)) {
        ctx.addIssue({ code: "custom", path: ["items", index, "productId"], message: "Produk tidak boleh muncul dua kali." });
      }
      seen.add(item.productId);
    });
  });

// GET /api/stock/transfers/destinations takes no query at all: validate() makes the object strict,
// so any parameter is a 400.
const destinationsQuerySchema = z.object({});

module.exports = { transferSchema, destinationsQuerySchema, MAX_ITEMS };
