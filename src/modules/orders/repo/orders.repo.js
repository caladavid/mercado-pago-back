const { pool } = require("../../../db/pool");

async function getOrderById(orderReference) {
    const query = `
        SELECT
            o.id,
            o.user_id,
            o.status, 
            o.user_id, 
            o.total_amount,
            o.currency,
            o.type,           
            o.external_reference, 
            o.plan_id,
            o.merchant_id,
            o.mp_payment_id,
            u.full_name,
            u.email,
            success_url,
            back_url
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.id
        LEFT JOIN users u ON u.id = o.user_id
        WHERE o.id::text = $1 
           OR o.external_reference = $1 
           OR o.external_reference LIKE '%' || $1
        LIMIT 1
    `;

    const result = await pool.query(query, [orderReference]);
    return result.rows[0]
}

async function getOrderBySubscriptionId(mpSubscriptionId) {
    const query = `
        SELECT
            o.id,
            o.user_id,
            o.status, 
            o.total_amount,
            o.currency,
            o.type,           
            o.external_reference, 
            o.plan_id,
            o.merchant_id,
            o.mp_payment_id,
            u.full_name,
            u.email
        FROM orders o
        LEFT JOIN users u ON u.id = o.user_id
        WHERE o.mp_payment_id = $1
           OR o.mp_payment_id = REPLACE($1, '-', '') -- Busca con o sin guiones
        LIMIT 1
    `;

    try {
        const result = await pool.query(query, [mpSubscriptionId]);
        return result.rows[0];
    } catch (error) {
        console.error("[getOrderBySubscriptionId] Error buscando por suscripción:", error.message);
        throw error;
    }
}

module.exports = { getOrderById, getOrderBySubscriptionId };