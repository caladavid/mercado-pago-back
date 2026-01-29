const { getPaymentFromMP } = require("../../../integrations/mercadopago/mpClient");
const { hashToken } = require("../../../utils/merchantKeys");
const crypto = require("crypto");
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
    /* console.log("🎯 Webhook received:", req.body); */  
  try {

    const signature = req.headers["x-signature"];
    if (!signature){
      return res.status(400).json({ error: "Missing signature" });  
    }
    
    const requestId = req.headers["x-request-id"];
    if (!requestId){
      return res.status(400).json({ error: "Missing request id" });  
    }

    const payload = req.body;
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ error: "Invalid webhook payload" });
    }

    const ts = signature.split(',')[0].split('=')[1];
    const v1 = signature.split(',')[1].split('=')[1];

    if (!ts || !v1) {  
      return res.status(401).json({ error: "Invalid signature format" });  
    }

    const manifest = `id:${payload.data.id};request-id:${requestId};ts:${ts};`;
    
    const cyphedSignature = crypto
        .createHmac('sha256', process.env.MP_WEBHOOK_SECRET) 
        .update(manifest)
        .digest('hex');

    if(cyphedSignature !== v1){
      return res.status(401).json({ error: "Invalid signature" }); 
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

    if (payload?.type === "payment") {
      await processApprovedPayment(payload)
    }

    if (!row?.id) {
      return res.status(200).json({ ok: true, duplicate: true });
    }
    return res.status(200).json({ ok: true, id: row.id });
  } catch (e) {
    next(e);
  }
}

async function processApprovedPayment(payload) {
  
  try {
    /* console.log("data id:", payload.data.id); */
    const mpPayment = await getPaymentFromMP(payload.data.id);
    const paymentId = mpPayment.id;
    const status = mpPayment.status;
    const externalReference = mpPayment.external_reference
    /* console.log("mpPayment", mpPayment); */


    if (mpPayment.status === "approved"){
      /* const orderId = mpPayment.external_reference */
      /* console.log("mpPayment", mpPayment); */
      /* console.log(`[DEBUG] Buscando en DB la orden con external_reference: "${externalReference}"`); */

      const result = await repo.updateOrderStatusByPaymentId(externalReference, status, paymentId)
  
        if (result) {
            console.log(`✅ Orden ${externalReference} actualizada a ${status}`);
        } else {
          console.error("⚠️ No se encontró la orden:", externalReference);
        }

    } else {
      console.log(`ℹ️ El pago ${mpPayment.id} sigue en estado: ${mpPayment.status}. Esperando actualización...`);
    }
  } catch (error) {
    console.error("💥 Error in processApprovedPayment:", error);
  }

}

module.exports = { receiveMercadoPagoWebhook };
