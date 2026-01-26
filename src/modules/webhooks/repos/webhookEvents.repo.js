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

module.exports = { insertWebhookEvent };
