// src/repos/payments.repo.js (o donde manejes tus queries de base de datos)
const { pool } = require("../../../db/pool");

/**
 * Inserta un nuevo movimiento de pago o lo actualiza si ya existe (Upsert).
 * Ideal para el historial de transacciones y recobros de suscripciones.
 */
async function upsertPaymentRecord(paymentData) {
    const {
        userId, 
        orderId, 
        subscriptionId,
        merchantId,
        mpPaymentId, 
        status, 
        statusDetail, 
        amount, 
        currency, 
        paymentTypeId, 
        externalReference, 
        rawPayload
    } = paymentData;

    const query = `
        INSERT INTO payments 
        (user_id, order_id, subscription_id, merchant_id, mp_payment_id, status, status_detail, amount, currency, payment_type_id, external_reference, response_payload)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (mp_payment_id) 
        DO UPDATE SET 
            status = EXCLUDED.status, 
            status_detail = EXCLUDED.status_detail,
            order_id = EXCLUDED.order_id, 
            subscription_id = EXCLUDED.subscription_id,
            merchant_id = EXCLUDED.merchant_id,
            updated_at = NOW()
        RETURNING id, subscription_id, merchant_id;
    `;

    const values = [
        userId, 
        orderId, 
        subscriptionId || null,
        merchantId || null,
        String(mpPaymentId), 
        status, 
        statusDetail, 
        amount, 
        currency, 
        paymentTypeId, 
        externalReference, 
        rawPayload
    ];

    try {
        const { rows } = await pool.query(query, values);
        return rows[0];
    } catch (error) {
        console.error("[upsertPaymentRecord] Error en upsertPaymentRecord:", error.message);
        throw error; 
    }
}

module.exports = { upsertPaymentRecord };