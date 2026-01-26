const { pool } = require("../../../db/pool");

const { withTransaction } = require("../../../shared/db/withTransaction");
const repo = require("../repos/checkout.repo");

exports.createCheckout = async (req, res, next) => {
  try {
    // Por seguridad, el slug debe venir del token validado por merchantAuth
    const merchantSlug = req.merchant?.slug;
    if (!merchantSlug) return res.status(401).json({ error: "merchant not authenticated" });

    const { buyer, item } = req.body || {};

    if (!buyer?.email) return res.status(400).json({ error: "buyer.email required" });
    if (!item?.sku || !item?.title) return res.status(400).json({ error: "item.sku and item.title required" });
    if (item?.amount == null || Number(item.amount) <= 0) return res.status(400).json({ error: "item.amount must be > 0" });
    if (!item?.currency) return res.status(400).json({ error: "item.currency required (e.g. UYU)" });

    const result = await withTransaction(async (client) => {
      const user = await repo.upsertUser(client, {
        email: buyer.email,
        fullName: buyer.full_name,
        docType: buyer.doc_type,
        docNumber: buyer.doc_number,
      });

      const product = await repo.upsertProduct(client, {
        sku: item.sku,
        name: item.title,
        price: Number(item.amount),
        currency: item.currency,
      });

      const order = await repo.createOrder(client, {
        userId: user.id,
        totalAmount: Number(item.amount),
        currency: item.currency,
        merchantSlug,
      });

      await repo.createOrderItem(client, {
        orderId: order.id,
        productId: product.id,
        qty: 1,
        unitPrice: Number(item.amount),
      });

      return { user, order };
    });

    const base = process.env.PUBLIC_CHECKOUT_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const checkoutUrl = `${base}/checkout/${encodeURIComponent(result.order.external_reference)}`;

    return res.status(201).json({
      order_id: result.order.id,
      external_reference: result.order.external_reference,
      status: result.order.status,
      checkout_url: checkoutUrl,
    });
  } catch (e) {
    next(e);
  }
};
