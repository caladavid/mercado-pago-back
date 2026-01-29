// src/shared/db/withTransaction.js
const { pool } = require("../../db/pool");

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    try {
      client.release();
    } catch (error) {
      console.error("Error releasing client:", error);  
    }
  }
}

module.exports = { withTransaction };
