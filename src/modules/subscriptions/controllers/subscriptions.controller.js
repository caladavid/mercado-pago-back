const mpClient = require("../../../integrations/mercadopago/mpClient");
const { pool } = require("../../../db/pool");
const repo = require("../repos/subscriptions.repo");

async function processSubscriptionLogic(data) {
    const { 
        preapproval_plan_id, 
        email, 
        card_token_id, 
        user_id, 
        external_reference,
        back_url 
    } = data;

    if (!preapproval_plan_id) throw new Error("Falta el preapproval_plan_id.");

    // 1. Buscar Plan Local
    const planQuery = "SELECT * FROM plans WHERE mp_preapproval_plan_id = $1"; 
    const { rows } = await pool.query(planQuery, [preapproval_plan_id]);

    if (!rows.length) throw new Error("Plan local no encontrado");
    const localPlan = rows[0]; 

    // 2. Preparar Payload para MP
    const mpPayload = {
        preapproval_plan_id: preapproval_plan_id,
        payer_email: email,
        card_token_id: card_token_id,
        back_url: back_url,
        status: "pending", // Intentamos que nazca activa
        external_reference: external_reference,
        user_id: user_id,
    };

    console.log("📦 [Logic] Creando suscripción en MP...", JSON.stringify(mpPayload, null, 2));

console.log("🔑 Token Default (.env):", process.env.MP_ACCESS_TOKEN ? process.env.MP_ACCESS_TOKEN.substring(0, 10) + "..." : "UNDEFINED");
    console.log("🔑 Token Suscripciones (.env):", process.env.MP_ACCESS_TOKEN2 ? process.env.MP_ACCESS_TOKEN2.substring(0, 10) + "..." : "UNDEFINED");

    console.log("📦 [Logic] Creando suscripción en MP...", JSON.stringify(mpPayload, null, 2));

    // 3. Llamada a Mercado Pago
    const mpSubscription = await mpClient.createPreApproval(mpPayload);

    // 4. Guardar en Base de Datos Local
    const savedSub = await repo.createSubscription({
        userId: user_id,
        planId: localPlan.id,
        mpSubscription: mpSubscription,
        reason: localPlan.name,
        amount: localPlan.amount,
        frequency: localPlan.interval_count,
        frequencyType: localPlan.interval_unit,
        currency: "UYU",
        discountAmount: 0 // Simplificado para este ejemplo
    });

    return { mpSubscription, savedSub, localPlan };
}

async function createAdHocSubscription(req, res, next) {
    try {
        const {  email, transaction_amount, frequency, frequency_type, reason, discount_code, back_url, user_id, plan_id_internal } = req.body;

        let originalAmount = parseFloat(transaction_amount);
        let finalAmount = originalAmount;
        let reasonText = reason;
        let couponData = null;


        if (discount_code) {

            const couponQuery = `
                SELECT * FROM coupons
                WHERE code = $1
                AND active = true
                AND (valid_from IS NULL OR valid_from <= NOW())
                AND (valid_to IS NULL OR valid_to >= NOW())
            `;
            
            const { rows: coupons } = await pool.query(couponQuery, [discount_code]);

            if (coupons.length > 0) {
                couponData = coupons[0];

                // Calcular descuento
                if (couponData.coupon_type === 'percent') {
                    const discount = finalAmount * (couponData.value / 100);
                    finalAmount = finalAmount - discount;
                } else if (couponData.coupon_type === 'fixed') {
                    finalAmount = finalAmount - couponData.value;
                }

                // Evitar negativos
                if (finalAmount < 0) finalAmount = 0;

                reasonText += ` (Cupón: ${discount_code})`;
            }
        }

        const mpPayload = {
            payer_email: email,
            back_url: back_url,
            reason: reasonText,
            external_reference: user_id ? user_id.toString() : "SIN_ID",
            metadata: {
                user_id: user_id,
                plan_id: plan_id_internal
            },
            auto_recurring: {
                frequency: parseInt(frequency),           
                frequency_type: frequency_type,           
                transaction_amount: finalAmount,
                currency_id: "UYU"
            },
            status: "pending"
        }

        const mpSubscription = await mpClient.createPreApproval(mpPayload);
        console.dir(mpSubscription, { depth: null, colors: true });

        const savedSub = await repo.createSubscription({
            userId: user_id,
            planId: null,
            mpSubscription: mpSubscription,
            reason: reasonText,
            amount: finalAmount,
            frequency: parseInt(frequency),
            frequencyType: frequency_type,
            currency: "UYU",
            couponId: couponData?.id,
            discountAmount: couponData ? (originalAmount - finalAmount) : 0
        })

       res.status(200).json({ 
            ok: true, 
            subscription_id: savedSub.id,
            checkout_url: mpSubscription.init_point 
        });

    } catch (error) {
        console.error("Error al procesar pago:", error);
        res.status(400).json({
            ok: false,
            error: error.message || "Error desconocido en MP",
            details: error.cause || error
        });
    }
}

/**
 * Crea una suscripción basada en un PLAN existente.
 */
async function createSubscriptionFromPlan(req, res, next) {
    try {
        // Adaptamos req.body al formato que espera la lógica
        const result = await processSubscriptionLogic({
            ...req.body,
            external_reference: req.body.user_id ? req.body.user_id.toString() : "SIN_ID"
        });

        res.status(201).json({
            ok: true,
            message: "Suscripción guardada",
            subscription_id: result.savedSub.id,
            mp_id: result.mpSubscription.id,
            checkout_url: result.mpSubscription.init_point
        });
    } catch (error) {
        console.error("Error creating subscription:", error);
        res.status(400).json({ ok: false, error: error.message });
    }
}

/* async function createSubscriptionFromPlan(req, res, next) {
    try {
        const { preapproval_plan_id, email, discount_code, card_token_id, back_url, user_id, plan_id_internal } = req.body;

        const payload = req.body;
        console.dir(payload, { depth: null });

        if (!preapproval_plan_id) {
            return res.status(400).json({ error: "Falta el preapproval_plan_id." });
        }


        const planQuery = "SELECT * FROM plans WHERE mp_preapproval_plan_id = $1"; 
        const { rows } = await pool.query(planQuery, [preapproval_plan_id]);

        if (!rows.length) {
            return res.status(404).json({ error: "Plan local no encontrado" })
        }
        
        const localPlan = rows[0]; 
        
        // If has coupons active, redirect to another plan TODO
        if (discount_code) {
            payload.transaction_amount = parseFloat(localPlan.amount);
            payload.frequency = localPlan.interval_count;
            payload.frequency_type = localPlan.interval_unit;
            payload.reason = localPlan.name;
            payload.plan_id_internal = localPlan.id;
            

            return createAdHocSubscription(req, res, next);
        }

        
        if (card_token_id) {
        
            const mpPayload = {
                preapproval_plan_id: preapproval_plan_id,
                payer_email: email || "test_user_3973871619842264462@testuser.com",
                metadata: {
                    user_id: user_id,
                    plan_id: plan_id_internal
                },
                card_token_id: card_token_id,
                back_url: back_url,
                status: "pending"
            }
    
            console.log("--- 2. Payload a enviar a Mercado Pago ---");
            console.dir(mpPayload, { depth: null, colors: true });
    
            // Crear suscripción en Mercado Pago
            const mpSubscription = await mpClient.createPreApproval(mpPayload);

            console.dir(mpSubscription, { depth: null, colors: true });
    
            const savedSub = await repo.createSubscription({
                userId: user_id,               // ID del usuario
                planId: localPlan.id,          // ID interno del plan (Integer)
                mpSubscription: mpSubscription,// Objeto completo de MP
                reason: localPlan.name,
                amount: localPlan.amount,      // Precio full
                frequency: localPlan.interval_count,          
                frequencyType: localPlan.interval_unit,
                currency: "UYU",
                couponId: null,                // Sin cupón
                discountAmount: 0
            });
    
            console.log("Respuesta MP ID:", mpSubscription.id);
    
            res.status(201).json({
                ok: true,
                message: "Suscripción guardada",
                subscription_id: savedSub.id,      
                mp_id: mpSubscription.id,          
                checkout_url: mpSubscription.init_point
            });

        } else {
            console.log("🔗 Sin tarjeta. Generando Link basado en el Plan Local...");

            payload.transaction_amount = localPlan.amount;
            payload.frequency = localPlan.interval_count;
            payload.frequency_type = localPlan.interval_unit;
            payload.reason = localPlan.name;

            payload.plan_id_internal = localPlan.id;

            delete payload.preapproval_plan_id;

            return createAdHocSubscription(req, res, next);
        }


    } catch (error) {
        console.error("Error al procesar pago:", error);
        res.status(400).json({
            ok: false,
            error: error.message || "Error desconocido en MP",
            details: error.cause || error
        });
    }
} */

module.exports = { createAdHocSubscription, createSubscriptionFromPlan, processSubscriptionLogic };