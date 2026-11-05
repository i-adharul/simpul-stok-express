const express = require("express");
const productController = require("../controllers/productController");
const authentication = require("../middlewares/authentication");
const { requireCan } = require("../middlewares/authorization");
const noStore = require("../middlewares/noStore");
const subscriptionGuard = require("../middlewares/subscriptionGuard");
const validate = require("../middlewares/validate");
const { createProductSchema, productListQuerySchema, updateProductSchema } = require("../schemas/product.schema");

const router = express.Router();

router.use("/products", noStore);

// Order on every route: authentication, the role (before the input is read, rule 2), the
// subscription check on writes (rule 17), validate, then the controller.
router.get(
  "/products",
  authentication,
  requireCan("product.read"),
  validate({ query: productListQuerySchema }),
  productController.list,
);

// No schema for the ID: a malformed ID must be 404, not 400 (rule 2).
router.get("/products/:id", authentication, requireCan("product.read"), productController.show);

router.post(
  "/products",
  authentication,
  requireCan("product.manage"),
  subscriptionGuard,
  validate({ body: createProductSchema }),
  productController.create,
);

router.patch(
  "/products/:id",
  authentication,
  requireCan("product.manage"),
  subscriptionGuard,
  validate({ body: updateProductSchema }),
  productController.update,
);

module.exports = router;
