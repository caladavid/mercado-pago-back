const { pool } = require("../../../db/pool");

async function getCheckoutByExternalReference(externalReference) {
  const orderQ = `
    SELECT
      o.id,
      o.status,
      o.total_amount,
      o.currency,
      o.external_reference,
      o.created_at,
      u.email,
      u.full_name,
      u.doc_type,
      u.doc_number
    FROM orders o
    JOIN users u ON u.id = o.user_id
    WHERE o.external_reference = $1
    LIMIT 1
  `;
  const orderRes = await pool.query(orderQ, [externalReference]);
  const order = orderRes.rows[0];
  if (!order) return null;

  const itemsQ = `
    SELECT
      oi.id,
      oi.qty,
      oi.unit_price,
      oi.line_total,
      p.sku,
      p.name
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = $1
    ORDER BY oi.id ASC
  `;
  const itemsRes = await pool.query(itemsQ, [order.id]);

  return { order, items: itemsRes.rows };
}

module.exports = { getCheckoutByExternalReference };
