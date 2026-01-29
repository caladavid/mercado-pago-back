const { pool } = require("../../../db/pool");

async function insertWebhookEvent(
  {
    provider,
    topic,
    action,
    dataId,
    mpEventId,
    receivedAt,
    payload,
    processingStatus = "pending",
  },
  client = pool
) {
  const q = `
    INSERT INTO webhook_events
      (provider, topic, action, data_id, mp_event_id, received_at, processing_status, payload)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    ON CONFLICT (mp_event_id) DO NOTHING
    RETURNING id
  `;
  const { rows } = await client.query(q, [
    provider || null,
    topic || null,
    action || null,
    dataId || null,
    mpEventId || null,
    receivedAt || new Date().toISOString(),
    processingStatus,
    payload || {},
  ]);
  return rows[0];
}

async function updateOrderStatusByPaymentId(externalReference, mpStatus, paymentId) {
  const nextOrderStatus = (() => {
      if (mpStatus === "approved") return "paid";
      if (mpStatus === "rejected") return "failed";
      if (mpStatus === "refunded") return "refunded";
      if (mpStatus === "refunded") return "refunded";
      return "pending";
    })();

  const q = `  
    UPDATE orders   
    SET 
      status = $1, 
      mp_payment_id = COALESCE(mp_payment_id, $3),
      updated_at = NOW()  
    WHERE external_reference = $2  
    AND status != 'paid'
    RETURNING id, external_reference, user_id, total_amount, currency  
  `;

  try {
    const { rows } = await pool.query(q, [
      nextOrderStatus, 
      externalReference,
      paymentId ? String(paymentId) : null
  ]); 

    return rows[0];
  } catch (error) {
    throw error;
  }
}

module.exports = { 
  insertWebhookEvent,
  updateOrderStatusByPaymentId
};
