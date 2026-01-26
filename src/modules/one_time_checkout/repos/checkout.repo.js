const { randomUUID } = require("crypto");

async function upsertUser(client, { email, fullName, docType, docNumber }) {
  const q = `
    INSERT INTO users (email, full_name, doc_type, doc_number)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (email) DO UPDATE SET
      full_name = COALESCE(EXCLUDED.full_name, users.full_name),
      doc_type = COALESCE(EXCLUDED.doc_type, users.doc_type),
      doc_number = COALESCE(EXCLUDED.doc_number, users.doc_number),
      updated_at = now()
    RETURNING *;
  `;
  const { rows } = await client.query(q, [
    email,
    fullName || null,
    docType || null,
    docNumber || null,
  ]);
  return rows[0];
}

async function upsertProduct(client, { sku, name, price, currency }) {
  const q = `
    INSERT INTO products (name, sku, price, currency, active)
    VALUES ($1,$2,$3,$4,true)
    ON CONFLICT (sku) DO UPDATE SET
      name = EXCLUDED.name,
      price = EXCLUDED.price,
      currency = EXCLUDED.currency,
      active = true
    RETURNING *;
  `;
  const { rows } = await client.query(q, [name, sku, price, currency]);
  return rows[0];
}

async function createOrder(client, { userId, totalAmount, currency, merchantSlug }) {
  const externalReference = `${merchantSlug}:${randomUUID()}`;
  const q = `
    INSERT INTO orders (user_id, status, total_amount, currency, external_reference)
    VALUES ($1,'pending',$2,$3,$4)
    RETURNING *;
  `;
  const { rows } = await client.query(q, [userId, totalAmount, currency, externalReference]);
  return rows[0];
}

async function createOrderItem(client, { orderId, productId, qty, unitPrice }) {
  const lineTotal = Number(qty) * Number(unitPrice);
  const q = `
    INSERT INTO order_items (order_id, product_id, qty, unit_price, line_total)
    VALUES ($1,$2,$3,$4,$5)
    RETURNING *;
  `;
  const { rows } = await client.query(q, [orderId, productId, qty, unitPrice, lineTotal]);
  return rows[0];
}

module.exports = {
  upsertUser,
  upsertProduct,
  createOrder,
  createOrderItem,
};
