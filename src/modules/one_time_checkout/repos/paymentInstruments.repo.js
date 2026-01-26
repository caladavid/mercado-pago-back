const { pool } = require("../../../db/pool");

async function insertCardInstrument({
  user_id,
  mp_customer_row_id,
  mp_card_id,
  brand,
  last4,
  exp_month,
  exp_year,
  raw_mp,
}, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO payment_instruments
      (user_id, mp_customer_row_id, instrument_type, mp_card_id, brand, last4, exp_month, exp_year, status, raw_mp)
     VALUES
      ($1, $2, 'card', $3, $4, $5, $6, $7, 'active', $8)
     RETURNING *`,
    [user_id, mp_customer_row_id, mp_card_id, brand, last4, exp_month, exp_year, raw_mp || null]
  );
  return rows[0];
}

module.exports = { insertCardInstrument };
