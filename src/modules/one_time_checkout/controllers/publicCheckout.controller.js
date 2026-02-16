const readRepo = require("../repos/checkoutRead.repo");
const mpRepo = require("../repos/mpCustomers.repo");

exports.getCheckout = async (req, res, next) => {
  try {
    const ref = req.params.external_reference;

    const data = await readRepo.getCheckoutByExternalReference(ref);
    if (!data) return res.status(404).json({ error: "checkout not found" });

    const { order, items } = data;

    const mpCustomer = await mpRepo.findByEmail(order.email);

    const isSubscription = order.type === 'subscription' || !!order.preapproval_plan_id;

    const publicKeyToUse = isSubscription 
        ? (process.env.MP_PUBLIC_KEY_SUBSCRIPTIONS || process.env.MP_PUBLIC_KEY) 
        : process.env.MP_PUBLIC_KEY;

        console.log(`🔑 Checkout cargado. Tipo: ${isSubscription ? 'Suscripción' : 'Pago Único'}. Key usada: ${publicKeyToUse}`);

    return res.json({
      mp_public_key: publicKeyToUse,
      mp_locale: process.env.MP_LOCALE || "es-UY",
      mp_customer_id: mpCustomer ? mpCustomer.mp_customer_id : null,
      type: order.type || "one_time",
      preapproval_plan_id: order.preapproval_plan_id,
      frequency: order.frequency,
      frequency_type: order.frequency_type,
      order: {
        id: order.id,
        status: order.status,
        total_amount: order.total_amount,
        currency: order.currency,
        type: order.type,
        external_reference: order.external_reference,
        created_at: order.created_at,
      },
      buyer_prefill: {
        email: order.email,
        full_name: order.full_name,
        doc_type: order.doc_type,
        doc_number: order.doc_number,
      },
      items: items.map((i) => ({
        sku: i.sku,
        title: i.name,
        qty: i.qty,
        unit_price: i.unit_price,
        line_total: i.line_total,
      })),
    });
  } catch (e) {
    next(e);
  }
};
