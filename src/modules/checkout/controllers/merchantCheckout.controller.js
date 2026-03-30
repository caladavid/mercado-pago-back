const { pool } = require("../../../db/pool");

const { withTransaction } = require("../../../shared/db/withTransaction");
const repo = require("../repos/checkout.repo");
const mpRepo = require("../repos/mpCustomers.repo");

const appendQueryParam = (url, key, value) => {
  if (!url) return url;

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${key}=${value}`;
}

exports.createCheckout = async (req, res, next) => {
  console.log(`[createCheckout] Iniciando orden para: ${req.body?.buyer?.email} | SKU: ${req.body?.item?.sku}`);
  try {
    // Por seguridad, el slug debe venir del token validado por merchantAuth
    const merchantSlug = req.merchant?.slug;
    const merchantId = req.merchant?.id;
    if (!merchantSlug || !merchantId) return res.status(401).json({ error: "merchant not authenticated" });
    console.log("merchantSlug", merchantSlug);
    console.log("merchantId", merchantId);

    const { buyer, type, preapproval_plan_id, back_url, success_url, error_url, txnId } = req.body || {};
    let { item } = req.body || {};

    if (!buyer?.email) return res.status(400).json({ error: "buyer.email required" });
    
    if (type !== "subscription") {
      if (!item?.sku || !item?.title) return res.status(400).json({ error: "item.sku and item.title required" });
      if (item?.amount == null || Number(item.amount) <= 0) return res.status(400).json({ error: "item.amount must be > 0" });
      if (!item?.currency) return res.status(400).json({ error: "item.currency required (e.g. UYU)" });
    } else {
      if (!preapproval_plan_id) return res.status(400).json({ error: "preapproval_plan_id required for subscriptions" });
    }

    let finalBackUrl = back_url;
    let finalSuccessUrl = success_url;

    

    const result = await withTransaction(async (client) => {
      let localPlanId = null;

      if (type === 'subscription') {
        const planQuery = `SELECT id, name, amount, currency FROM plans WHERE mp_preapproval_plan_id = $1`;
        const { rows } = await client.query(planQuery, [preapproval_plan_id]);

        if (rows.length === 0) {
            const err = new Error("El plan especificado no existe en la base de datos");
            err.status = 404;
            throw err;
        }

        if (rows.length > 0) {
        }
        const planDb = rows[0];
        localPlanId = planDb.id; 
        console.log("✅ Plan Local Encontrado (UUID):", localPlanId);

        item = {
            sku: `PLAN-${preapproval_plan_id.substring(0, 8)}`, // Generamos un SKU automático
            title: planDb.name,
            amount: planDb.amount,
            currency: planDb.currency,
            description: `Renovación automática - ${planDb.name}`
        };
      }

      if (merchantSlug.includes("comerciante-contenido") && txnId) {
        console.log(`[Merchant Contenido] Inyectando txn_id (${txnId}) en las URLs de retorno.`);
        
        finalBackUrl = appendQueryParam(finalBackUrl, 'txn_id', txnId);
        finalSuccessUrl = appendQueryParam(finalSuccessUrl, 'txn_id', txnId);
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
        description: item.description,
      });

      console.log("👉 [CreateCheckout] Plan ID capturado:", preapproval_plan_id);

      const order = await repo.createOrder(client, {
        userId: user.id,
        merchantId,
        totalAmount: Number(item.amount),
        currency: item.currency,
        merchantSlug,
        type,
        planId: localPlanId,
        back_url: finalBackUrl,
        success_url: finalSuccessUrl,
        error_url
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

    console.log(`[createCheckout] Orden generada: ${result.order.external_reference}`);

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
