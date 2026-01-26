const repo = require("../repos/webhookEvents.repo");

function coalesceDataId(payload) {
  return (
    payload?.data?.id ||
    payload?.data?.payment_id ||
    payload?.data?.merchant_order ||
    null
  );
}

function normalizeReceivedAt(payload) {
  return payload?.date_created || new Date().toISOString();
}

async function receiveMercadoPagoWebhook(req, res, next) {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ error: "Invalid webhook payload" });
    }

    const dataId = coalesceDataId(payload);
    const row = await repo.insertWebhookEvent({
      provider: "mercadopago",
      topic: payload?.type || null,
      action: payload?.action || null,
      dataId,
      mpEventId: dataId,
      receivedAt: normalizeReceivedAt(payload),
      payload,
      processingStatus: "pending",
    });

    if (!row?.id) {
      return res.status(200).json({ ok: true, duplicate: true });
    }
    return res.status(200).json({ ok: true, id: row.id });
  } catch (e) {
    next(e);
  }
}

module.exports = { receiveMercadoPagoWebhook };
