const { pool } = require("../../../db/pool");

async function findByUserId(userId, client = pool) {
  const { rows } = await client.query(
    `SELECT * FROM mp_customers WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function insertMpCustomer({ user_id, mp_customer_id, email, raw_mp }, client = pool) {
  console.log("Inserting mp_customer for user_id:", user_id);
  const { rows } = await client.query(
    `INSERT INTO mp_customers (user_id, mp_customer_id, email, raw_mp)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [user_id, mp_customer_id, email, raw_mp || null]
  );
  return rows[0];
}

module.exports = { findByUserId, insertMpCustomer };
