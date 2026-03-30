const { pool } = require("../../../db/pool");
const { withTransaction } = require("../../../shared/db/withTransaction");

/**
 * Crea una suscripción, registra su evento inicial y opcionalmente redime un cupón.
 * Todo dentro de una transacción atómica.
 */
async function createSubscription({ 
    userId, 
    merchantId,
    planId, 
    mpSubscription, 
    reason, 
    amount,          
    frequency,       
    frequencyType,   
    currency, 
    couponId = null,      // Opcional
    discountAmount = 0    // Opcional
}) {
    return await withTransaction(async (tx) => {

        console.log("--------------------------------------------------");
        console.log("🕵️‍♂️ DEBUG REPO - Intentando Insertar Suscripción:");
        console.log("   👉 User ID:", userId);
        console.log("   👉 Merchant ID:", merchantId);
        console.log("   👉 Plan ID:", planId); // ¿Es null o tiene numero?
        console.log("--------------------------------------------------");
        
        // A) Insertar Subscription
        const insertSubQ = `
            INSERT INTO subscriptions 
            (
                user_id, 
                merchant_id,
                plan_id, 
                mp_preapproval_id, 
                status, 
                reason, 
                frequency,           
                frequency_type,      
                transaction_amount, 
                currency, 
                init_point, 
                next_billing_at, 
                raw_mp,
                created_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
            RETURNING id, init_point
        `;

        const subValues = [
            userId,
            merchantId,
            planId,
            mpSubscription.id,
            mpSubscription.status,
            reason,
            frequency,           // Ej: 1
            frequencyType,       // Ej: 'months'
            amount,
            currency,
            mpSubscription.init_point,
            mpSubscription.next_payment_date,
            mpSubscription
        ];

        const { rows: newSubs } = await tx.query(insertSubQ, subValues);
        const savedSub = newSubs[0];

        // B) Insertar Evento (Auditoría)
        const insertEventQ = `
            INSERT INTO subscription_events 
            (
                subscription_id, 
                event_type, 
                old_status,    
                new_status, 
                payload,       
                occurred_at
            )
            VALUES ($1, $2, NULL, $3, $4, NOW())
        `;
        
        await tx.query(insertEventQ, [
            savedSub.id, 
            'created',
            mpSubscription.status, 
            mpSubscription
        ]);

        // C) Insertar Redención de Cupón (Si aplica)
        if (couponId) {
            const insertCouponQ = `
               INSERT INTO coupon_redemptions 
                (
                    coupon_id, 
                    user_id, 
                    subscription_id,   
                    discount_amount, 
                    redeemed_at
                )
                VALUES ($1, $2, $3, $4, NOW())
            `;
            
            await tx.query(insertCouponQ, [
                couponId, 
                userId, 
                savedSub.id, 
                discountAmount
            ]);
        }

        // Retornamos la suscripción creada para que el controlador la use
        return savedSub;
    });
}

/**
 * Busca una suscripción por su ID de Mercado Pago para validar propiedad.
 */
async function getSubscriptionByMPId(subscriptionId) {
    const query = `
        SELECT 
            id, 
            user_id, 
            merchant_id, 
            status, 
            mp_preapproval_id, 
            reason, 
            transaction_amount AS amount, 
            currency, 
            next_billing_at AS next_payment_date, 
            created_at,
            updated_at
        FROM subscriptions 
        WHERE mp_preapproval_id = $1 
        LIMIT 1
    `;
    const { rows } = await pool.query(query, [subscriptionId]);
    return rows[0] || null;
}

/**
 * Actualiza el estado de una suscripción y registra el evento del cambio.
 */
async function updateStatus(mpPreapprovalId, newStatus, rawPayload = null) {
    return await withTransaction(async (tx) => {
        // 1. Obtenemos el estado actual antes de cambiarlo (para el historial)
        const findQ = `SELECT id, status FROM subscriptions WHERE mp_preapproval_id = $1`;
        const { rows } = await tx.query(findQ, [mpPreapprovalId]);
        
        if (rows.length === 0) return null; // No existe la suscripción
        
        const sub = rows[0];
        const oldStatus = sub.status;

        // 2. Actualizamos la suscripción
        const updateQ = `
            UPDATE subscriptions 
            SET status = $1, updated_at = NOW(), raw_mp = COALESCE($2, raw_mp)
            WHERE mp_preapproval_id = $3
            RETURNING id
        `;
        await tx.query(updateQ, [newStatus, rawPayload, mpPreapprovalId]);

        // 3. Insertamos el evento de auditoría
        const eventQ = `
            INSERT INTO subscription_events 
            (subscription_id, event_type, old_status, new_status, payload, occurred_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
        `;
        await tx.query(eventQ, [
            sub.id, 
            'status_change', 
            oldStatus, 
            newStatus, 
            rawPayload
        ]);

        return { id: sub.id, oldStatus, newStatus };
    });
}

/**
 * Actualiza la fecha del próximo cobro de una suscripción.
 * Esto empuja el "vencimiento" hacia el futuro tras un pago exitoso.
 */
async function updateNextBillingDate(mpPreapprovalId, nextPaymentDate) {
    const query = `
        UPDATE subscriptions 
        SET 
            next_billing_at = $1,
            updated_at = NOW()
        WHERE mp_preapproval_id = $2
        RETURNING id;
    `;

    const values = [nextPaymentDate, String(mpPreapprovalId)];

    try {
        const { rows } = await pool.query(query, values);
        return rows[0]; // Retorna el ID si se actualizó correctamente
    } catch (error) {
        console.error("💥 [Repo] Error actualizando next_billing_date:", error.message);
        throw error;
    }
}

/**
 * Obtiene todas las suscripciones asociadas a un Merchant específico.
 * Se usa para llenar la tabla del Dashboard de Administración (Subscriptions.tsx).
 */
async function getSubscriptionsByMerchant(merchantId) {
    const query = `
        SELECT 
            id, 
            mp_preapproval_id, 
            user_id, 
            plan_id, 
            status, 
            reason, 
            transaction_amount AS amount, 
            currency, 
            next_billing_at AS next_payment_date, 
            created_at
        FROM subscriptions 
        WHERE merchant_id = $1
        ORDER BY created_at DESC
    `;

    try {
        const { rows } = await pool.query(query, [merchantId]);
        return rows;
    } catch (error) {
        console.error("💥 [Repo] Error obteniendo suscripciones por merchant:", error.message);
        throw error;
    }
}

async function getSubscriptionById(id) {
    const query = `
         SELECT 
            id, 
            merchant_id,
            mp_preapproval_id, 
            user_id, 
            plan_id, 
            status, 
            reason, 
            transaction_amount AS amount, 
            currency, 
            next_billing_at AS next_payment_date, 
            created_at
        FROM subscriptions 
        WHERE id = $1
        ORDER BY created_at DESC    
        
    `;
    const { rows } = await pool.query(query, [id]);
    return rows[0]; 
}

// En tu archivo checkout.repo.js
async function getActiveSubscriptionByEmailAndPlan(email, mpPreapprovalPlanId, merchantId) {
    const query = `
        SELECT 
            s.id AS subscription_id,           
            s.plan_id AS internal_plan_id,    
            s.mp_preapproval_id,              
            s.reason AS subscription_name, 
            u.id AS user_id, 
            u.full_name AS user_name,           
            u.email AS user_email
        FROM subscriptions s
        JOIN users u ON s.user_id = u.id
        JOIN plans p ON s.plan_id = p.id      
        WHERE u.email = $1 
          AND p.mp_preapproval_plan_id = $2   
          AND s.merchant_id = $3
          AND s.status = 'authorized'
        ORDER BY s.created_at DESC
        LIMIT 1;
    `;
    
    // Le pasamos los parámetros exactos: email, el ID de MP del plan, y el merchantId
    const { rows } = await pool.query(query, [email, mpPreapprovalPlanId, merchantId]);
    return rows[0]; 
}

module.exports = { createSubscription, getSubscriptionByMPId, updateStatus, updateNextBillingDate, 
    getSubscriptionsByMerchant, getSubscriptionById, getActiveSubscriptionByEmailAndPlan
 };