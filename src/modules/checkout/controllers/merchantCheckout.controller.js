const { pool } = require("../../../db/pool");

const { withTransaction } = require("../../../shared/db/withTransaction");
const repo = require("../repos/checkout.repo");
const mpRepo = require("../repos/mpCustomers.repo");

exports.createCheckout = async (req, res, next) => {
  try {
    // Por seguridad, el slug debe venir del token validado por merchantAuth
    const merchantSlug = req.merchant?.slug;
    if (!merchantSlug) return res.status(401).json({ error: "merchant not authenticated" });

    const { buyer, item, type, preapproval_plan_id, back_url } = req.body || {};

    if (!buyer?.email) return res.status(400).json({ error: "buyer.email required" });
    if (!item?.sku || !item?.title) return res.status(400).json({ error: "item.sku and item.title required" });
    if (item?.amount == null || Number(item.amount) <= 0) return res.status(400).json({ error: "item.amount must be > 0" });
    if (!item?.currency) return res.status(400).json({ error: "item.currency required (e.g. UYU)" });

    const result = await withTransaction(async (client) => {
      let localPlanId = null;

      if (type === 'subscription' && preapproval_plan_id) {
        // ... (tu lógica de búsqueda actual) ...
        const planQuery = `SELECT id FROM plans WHERE mp_preapproval_plan_id = $1`;
        const { rows } = await client.query(planQuery, [preapproval_plan_id]);

        if (rows.length > 0) {
          localPlanId = rows[0].id; // <--- GUARDAMOS EL UUID ENCONTRADO (bb06...)
          console.log("✅ Plan Local Encontrado (UUID):", localPlanId);
        } else {
           // Manejo de error si no existe
        }
      }

      const user = await repo.upsertUser(client, {
        email: buyer.email,
        fullName: buyer.full_name,
        docType: buyer.doc_type,
        docNumber: buyer.doc_number,
      });


      let mpCustomer = await mpRepo.findByUserId(user.id, client)

      if (!mpCustomer && buyer.email) {
          console.log(`🔎 [CreateCheckout] ID no encontrado. Buscando por email: ${buyer.email}`);
          mpCustomer = await mpRepo.findByEmail(buyer.email, client);
      }

      const product = await repo.upsertProduct(client, {
        sku: item.sku,
        name: item.title,
        price: Number(item.amount),
        currency: item.currency,
      });

      console.log("👉 [CreateCheckout] Plan ID capturado:", preapproval_plan_id);

      const order = await repo.createOrder(client, {
        userId: user.id,
        totalAmount: Number(item.amount),
        currency: item.currency,
        merchantSlug,
        type,
        planId: localPlanId,
        back_url
      });

      await repo.createOrderItem(client, {
        orderId: order.id,
        productId: product.id,
        qty: 1,
        unitPrice: Number(item.amount),
      });

      return { user, order, mpCustomer };
    });

    const base = process.env.PUBLIC_CHECKOUT_BASE_URL || `${req.protocol}://${req.get("host")}`;
    const checkoutUrl = `${base}/checkout/${encodeURIComponent(result.order.external_reference)}`;

    return res.status(201).json({
      order_id: result.order.id,
      external_reference: result.order.external_reference,
      status: result.order.status,
      checkout_url: checkoutUrl,
      mp_customer_id: result.mpCustomer ? result.mpCustomer.mp_customer_id : null
    });
  } catch (e) {
    next(e);
  }
};
