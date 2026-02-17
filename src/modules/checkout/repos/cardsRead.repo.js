const { pool } = require("../../../db/pool");

async function getUserIdByExternalReference(externalReference) {
  const q = `
    SELECT user_id
    FROM orders
    WHERE external_reference = $1
    LIMIT 1
  `;
  const { rows } = await pool.query(q, [externalReference]);
  return rows[0]?.user_id || null;
}

async function listActiveCardsByUserId(userId) {
  const q = `
    SELECT
      id,
      brand,
      last4,
      exp_month,
      exp_year,
      mp_card_id,
      status,
      created_at
    FROM payment_instruments
    WHERE user_id = $1
      AND instrument_type = 'card'
      AND status = 'active'
    ORDER BY created_at DESC
  `;
  const { rows } = await pool.query(q, [userId]);
  return rows;
}

module.exports = { getUserIdByExternalReference, listActiveCardsByUserId };
