const mpClient = require("../../../integrations/mercadopago/mpClient");
const repo = require("../repos/plan.repo");
const config = require("../../../config/env");

async function createPlan(req, res, next) {
    try {
        const merchantId = req.merchant?.id;
        if (!merchantId) {
            return res.status(401).json({ error: "No autorizado" });
        }

        const { reason, amount, frequency, frequency_type, back_url } = req.body;

        if (!reason || !amount || !frequency || !frequency_type || !back_url) {
            return res.status(400).json({ error: "Faltan parámetros requeridos." });
        }

        const mpPayload = {
            reason,
            auto_recurring: {
                frequency: parseInt(frequency),
                frequency_type,
                transaction_amount: parseFloat(amount),
                currency_id: config.isDev ? "UYU" : "CLP"
            },
            back_url,
            status: "active"
        }

        const mpPlan = await mpClient.createPreApprovalPlan(mpPayload);

        const savedPlan = await repo.createPlan({
            merchant_id: merchantId,
            name: mpPlan.reason,
            amount: mpPlan.auto_recurring.transaction_amount,
            currency: mpPlan.auto_recurring.currency_id,
            interval_count: mpPlan.auto_recurring.frequency,
            interval_unit: mpPlan.auto_recurring.frequency_type,
            mp_preapproval_plan_id: mpPlan.id,
            status: mpPlan.status,
            raw_mp: mpPlan
        });

        res.status(200).json(savedPlan);
    } catch (error) {
        console.error("❌ Error en createPlan:", error);
        res.status(400).json({ ok: false, error: error.message });
    }
}

async function listPlans(req, res, next) {
    try {
        const merchantId = req.merchant?.id;
        if (!merchantId) {
            return res.status(401).json({ error: "No autorizado" });
        }

        const plans = await repo.getPlansByMerchant(merchantId);

        res.status(200).json(plans);
    } catch (error) {
        console.error("❌ Error en listPlans:", error);
        res.status(500).json({ ok: false, error: error.message });
    }
}

async function getPlan(req, res, next) {
    try {
        const merchantId = req.merchant?.id;
        const { id } = req.params;

        if (!merchantId) {
            return res.status(401).json({ error: "No autorizado" });
        }

        // Usamos la función de seguridad doble que ya habíamos creado en el repo
        const plan = await repo.getPlanByIdAndMerchant(id, merchantId);

        if (!plan) {
            return res.status(404).json({ ok: false, error: "Plan no encontrado o no tienes permisos." });
        }

        res.status(200).json(plan);
    } catch (error) {
        console.error("❌ Error en getPlan:", error);
        res.status(500).json({ ok: false, error: error.message });
    }
}

async function getSubscriptionsByPlan(req, res, next) {
    try {
        const merchantId = req.merchant?.id;
        const { id } = req.params;

        if (!merchantId) {
            return res.status(401).json({ error: "No autorizado" });
        }

        // Usamos la función de seguridad doble que ya habíamos creado en el repo
        const subscriptions = await repo.getSubscriptionsByPlan(id, merchantId);

        if (!subscriptions) {
            return res.status(404).json({ ok: false, error: "Suscripciones no encontrada o no tienes permisos." });
        }

        res.status(200).json(subscriptions);
    } catch (error) {
        console.error("❌ Error en getPlan:", error);
        res.status(500).json({ ok: false, error: error.message });
    }
}

async function cancelPlan(req, res, next) {
    try {
        const merchantId = req.merchant?.id; 
        const { id } = req.params; 

        if (!merchantId) {
            return res.status(401).json({ error: "No autorizado" });
        }

        const plan = await repo.getPlanByIdAndMerchant(id, merchantId);
        if (!plan) {
            return res.status(404).json({ ok: false, error: "Plan no encontrado o acceso denegado." });
        }

        await mpClient.updatePreApprovalPlan(plan.mp_preapproval_plan_id, { status: "cancelled" });

        const cancelledPlan = await repo.updatePlanStatus(id, merchantId, "cancelled"); 

        res.status(200).json({
            ok: true,
            message: "Plan cancelado exitosamente",
            plan: cancelledPlan
        });
    } catch (error) {
        console.error("❌ Error en cancelPlan:", error);
        res.status(400).json({ ok: false, error: error.message });
    }
}

async function updatePlan(req, res, next) {
    try {
        const { id } = req.params; // ¡AQUÍ ESTÁ EL CAMBIO! Ahora recibes tu UUID interno.
        const { reason, amount, frequency, frequency_type, status } = req.body;
        const merchantId = req.merchant?.id;

        // 1. Buscar el Plan en TU base de datos primero
        const localPlan = await repo.getPlanById(id, merchantId);
        console.log("localPlan", localPlan);
        
        if (!localPlan) {
            return res.status(404).json({ ok: false, error: "Plan local no encontrado o no pertenece a este comercio." });
        }

        const mpPlanId = localPlan.mp_preapproval_plan_id; // Extraemos el ID real de MP
        console.log("mpClient", mpClient);
        // 2. Armar Payload para Mercado Pago
        const mpPayload = {};
        if (reason) mpPayload.reason = reason;
        if (status) mpPayload.status = status;

        if (amount || frequency || frequency_type) {
            mpPayload.auto_recurring = {
                ...(amount && { transaction_amount: parseFloat(amount) }),
                ...(frequency && { frequency: parseInt(frequency) }),
                ...(frequency_type && { frequency_type: frequency_type })
            };
        }

        // 3. Llamada a Mercado Pago (usando el ID extraído)
        let mpResult = localPlan.raw_mp; // Por defecto mantenemos el JSON viejo
        
        if (Object.keys(mpPayload).length > 0) {
            mpResult = await mpClient.updatePreApprovalPlan(mpPlanId, mpPayload);
        }

        // 4. Actualizar BD Local usando TU UUID interno
        const updatedPlan = await repo.updatePlanById(id, merchantId, {
            reason,
            amount,
            frequency,
            frequency_type,
            status,
            rawMp: mpResult 
        });

        res.json({ updatedPlan });
    } catch (error) {
        console.error("❌ Error en updatePlan:", error);
        res.status(400).json({ ok: false, error: error.message, details: error.payload });
    }
}


module.exports = { createPlan, listPlans, cancelPlan, getPlan, getSubscriptionsByPlan , updatePlan};