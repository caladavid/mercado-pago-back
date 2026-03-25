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

        res.status(200).json({ ok: true, count: plans.length, data: plans });
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

module.exports = { createPlan, listPlans, cancelPlan, getPlan };