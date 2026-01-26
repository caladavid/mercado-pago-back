const readRepo = require("../repos/checkoutRead.repo");

exports.getCheckout = async (req, res, next) => {
  try {
    const ref = req.params.external_reference;

    const data = await readRepo.getCheckoutByExternalReference(ref);
    if (!data) return res.status(404).json({ error: "checkout not found" });

    const { order, items } = data;

    return res.json({
      mp_public_key: process.env.MP_PUBLIC_KEY,
      mp_locale: process.env.MP_LOCALE || "es-UY",
      order: {
        id: order.id,
        status: order.status,
        total_amount: order.total_amount,
        currency: order.currency,
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
