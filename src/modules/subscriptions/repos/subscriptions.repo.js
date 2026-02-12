const { withTransaction } = require("../../../shared/db/withTransaction");

/**
 * Crea una suscripción, registra su evento inicial y opcionalmente redime un cupón.
 * Todo dentro de una transacción atómica.
 */
async function createSubscription({ 
    userId, 
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
        console.log("   👉 Plan ID:", planId); // ¿Es null o tiene numero?
        console.log("   👉 Status:", "pending"); // Asumo que es pending
        console.log("--------------------------------------------------");
        
        // A) Insertar Subscription
        const insertSubQ = `
            INSERT INTO subscriptions 
            (
                user_id, 
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
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
            RETURNING id, init_point
        `;

        const subValues = [
            userId,
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

module.exports = { createSubscription };