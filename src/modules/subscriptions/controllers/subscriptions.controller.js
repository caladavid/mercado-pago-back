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
        const { subscriptionId } = req.params;
        const authenticatedMerchantId = req.merchant?.id;

        const subscription = await repo.getSubscriptionByMPId(subscriptionId);

        if (!subscription) {
            return res.status(404).json({ ok: false, error: "Suscripción no encontrada en la base de datos." });
        }

        if (subscription.merchant_id !== authenticatedMerchantId) {
            return res.status(403).json({ ok: false, error: "Acceso denegado. No tienes permiso para cancelar esta suscripción." });
        }

        const mpResult = await mpClient.cancelPreApproval(subscriptionId).catch(err => {
        if (err.status === 400 && err.payload?.message?.includes("cancelled")) {
            // Retornamos un objeto bandera si ya estaba cancelada, para no romper el flujo
            return { alreadyCancelled: true }; 
        }
        throw err; // Si es un error real (ej. 500, o token inválido), lo lanzamos al catch principal
        });

        const rawPayload = mpResult.alreadyCancelled ? null : mpResult;
        await repo.updateStatus(subscriptionId, "cancelled", rawPayload);

        const message = mpResult.alreadyCancelled 
            ? "La suscripción ya estaba cancelada en MP." 
            : "Suscripción cancelada exitosamente.";

        return res.json({ ok: true, message });

    } catch (error) {
        next(error);
    }
}

/* async function cancelSubscription(req, res, next) {
    try {
    const { subscriptionId } = req.params;

    try {
      // 1. Llamamos a Mercado Pago
      const mpResult = await mpClient.cancelPreApproval(subscriptionId);
      
      // 2. Si MP dice ok, actualizamos nuestra DB usando la nueva función
      await repo.updateStatus(subscriptionId, "cancelled", mpResult);
      
      return res.json({ ok: true, message: "Suscripción cancelada." });

    } catch (error) {
      // Manejo del error 400 (ya estaba cancelada en MP)
      if (error.status === 400 && error.payload?.message?.includes("cancelled")) {
          // Sincronizamos aunque MP falle, porque ya está cancelada allá
          await repo.updateStatus(subscriptionId, "cancelled");
          return res.json({ ok: true, message: "Ya estaba cancelada, DB sincronizada." });
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
} */

module.exports = { createAdHocSubscription, createSubscriptionFromPlan, processSubscriptionLogic, cancelSubscription };