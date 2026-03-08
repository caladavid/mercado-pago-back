const { pool } = require("../../../db/pool");

async function getOrderById(orderReference) {
    const query = `
        SELECT
            o.id,
            o.status, 
            o.user_id, 
            o.total_amount,
            o.currency,
            o.type,           
            o.external_reference, 
            o.plan_id 
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        WHERE o.id::text = $1 
           OR o.external_reference = $1 
           OR o.external_reference = 'comerciante-contenido:' || $1
        LIMIT 1
    `;

    const result = await pool.query(query, [orderReference]);
    return result.rows[0]
}

module.exports = { getOrderById };