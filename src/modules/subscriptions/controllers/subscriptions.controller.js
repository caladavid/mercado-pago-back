const mpClient = require("../../../integrations/mercadopago/mpClient");
const { pool } = require("../../../db/pool");
const repo = require("../repos/subscriptions.repo");
const config = require("../../../config/env");

async function processSubscriptionLogic(data) {
    const { 
        preapproval_plan_id, 
        email, 
        card_token_id, 
        user_id, 
        external_reference,
        back_url,
        merchant_id
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
        external_reference: external_reference,
    };

    console.log("[processSubscriptionLogic] Creando suscripción en MP:", JSON.stringify(mpPayload, null, 2));

    // 3. Llamada a Mercado Pago
    const mpSubscription = await mpClient.createPreApproval(mpPayload);

    // 4. Guardar en Base de Datos Local
    const savedSub = await repo.createSubscription({
        userId: user_id,
        merchantId: merchant_id,
        planId: localPlan.id,
        mpSubscription: mpSubscription,
        reason: localPlan.name,
        amount: localPlan.amount,
        frequency: localPlan.interval_count,
        frequencyType: localPlan.interval_unit,
        currency: config.isDev ? "UYU" : "CLP",
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
                currency_id: config.isDev ? "UYU" : "CLP"
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
            currency: config.isDev ? "UYU" : "CLP",
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
            merchant_id: req.merchant.id,
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

async function cancelSubscription(req, res, next) {
    try {
        const { id } = req.params; // Este debe ser el ID de MP (ej. 2c9380...) o el ID interno de tu DB, según cómo armes la ruta
        const authenticatedMerchantId = req.merchant?.id;
        console.log("subscription", id);
        // 1. Validar autenticación del Merchant
        if (!authenticatedMerchantId) {
            return res.status(401).json({ ok: false, error: "No autorizado." });
        }

        console.log(`📍 [CancelSub IN] Merchant ${authenticatedMerchantId} intentando cancelar Sub ID: ${id}`);

        // 2. Buscar la suscripción en la DB (Tu función espera el ID de MP)
        const subscription = await repo.getSubscriptionById(id);

        if (!subscription) {
            return res.status(404).json({ ok: false, error: "Suscripción no encontrada en la base de datos." });
        }

        const mpPreapprovalId = subscription.mp_preapproval_id;
        
        if (!mpPreapprovalId) {
             return res.status(400).json({ ok: false, error: "La suscripción no tiene un ID de Mercado Pago válido asociado." });
        }

        // 3. Validar que la suscripción pertenezca a este Merchant
        if (subscription.merchant_id !== authenticatedMerchantId) {
            return res.status(403).json({ ok: false, error: "Acceso denegado. No tienes permiso para cancelar esta suscripción." });
        }

        // 4. Cancelar en Mercado Pago
        console.log(`📡 [CancelSub MP] Llamando a Mercado Pago para cancelar...`);
        const mpResult = await mpClient.cancelPreApproval(mpPreapprovalId).catch(err => {
            // Manejamos si ya estaba cancelada en MP
            if (err.status === 400 && err.payload?.message?.includes("cancelled")) {
                console.log(`⚠️ [CancelSub MP] La suscripción ya estaba cancelada en Mercado Pago.`);
                return { alreadyCancelled: true }; 
            }
            throw err; 
        });

        // 5. Actualizar la Base de Datos
        const rawPayload = mpResult.alreadyCancelled ? null : mpResult;
        await repo.updateStatus(mpPreapprovalId, "cancelled", rawPayload);

        const message = mpResult.alreadyCancelled 
            ? "La suscripción ya estaba cancelada en MP." 
            : "Suscripción cancelada exitosamente.";

        console.log(`✅ [CancelSub OUT] ${message}`);
        return res.json({ ok: true, message });

    } catch (error) {
        console.error("❌ Error en cancelSubscription:", error);
        next(error);
    }
}

async function listSubscriptions(req, res, next) {
    try {
        const merchantId = req.merchant?.id;

        if (!merchantId) {
            return res.status(401).json({ ok: false, error: "No autorizado" });
        }

        // Llamamos al repo para traer las suscripciones de este merchant
        const data = await repo.getSubscriptionsByMerchant(merchantId);

        console.log(`📍 [Subscriptions OUT] Encontradas:`, data.length);

        // Devolvemos el array directamente para que el frontend lo lea fácil
        res.json(data);
    } catch (error) {
        console.error("❌ Error en listSubscriptions:", error);
        res.status(500).json({ ok: false, error: error.message });
    }
}

async function getSubscriptionById(req, res, next) {
    try {
        const merchantId = req.merchant?.id;
        const { id } = req.params; // Puede ser tu ID local o el de MP

        if (!merchantId) {
            return res.status(401).json({ ok: false, error: "No autorizado" });
        }

        console.log(`🔍 [Subs Controller] Buscando suscripción: ${id}`);

        // Aquí asumo que tu repo tiene una función para buscar por ID
        // Si usas el ID de Mercado Pago, usa getSubscriptionByMPId
        const subscription = await repo.getSubscriptionById(id);

        if (!subscription || subscription.merchant_id !== merchantId) {
            return res.status(404).json({ ok: false, error: "Suscripción no encontrada" });
        }

        res.json(subscription);

    } catch (error) {
        console.error("❌ Error en getSubscriptionById:", error);
        res.status(500).json({ ok: false, error: error.message });
    }
}

module.exports = { createAdHocSubscription, createSubscriptionFromPlan, processSubscriptionLogic, cancelSubscription, listSubscriptions, 
    getSubscriptionById, };