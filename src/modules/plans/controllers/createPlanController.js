const mpClient = require("../../../integrations/mercadopago/mpClient");
const repo = require("../repos/plan.repo");

async function createPlan(req, res, next) {
    try {
        const { reason, amount, frequency, frequency_type, back_url } = req.body;

        if (!reason) {
            return res.status(400).json({ error: "Falta el reason." });
        }

        if (!amount) {
            return res.status(400).json({ error: "Falta el amount." });
        }

        if (!frequency) {
            return res.status(400).json({ error: "Falta el frequency." });
        }

        if (!frequency_type) {
            return res.status(400).json({ error: "Falta el frequency_type." });
        }

        if (!back_url) {
            return res.status(400).json({ error: "Falta el back_url." });
        }

        const mpPayload = {
            reason,
            auto_recurring: {
                frequency: parseInt(frequency),
                frequency_type,
                transaction_amount: parseFloat(amount),
                currency_id: "UYU"
            },
            back_url,
            status: "active"
        }

        const mpPlan = await mpClient.createPreApprovalPlan(mpPayload);

        const savedPlan = await repo.createPlan({
            name: mpPlan.reason,
            amount: mpPlan.auto_recurring.transaction_amount,
            currency: mpPlan.auto_recurring.currency_id,
            interval_count: mpPlan.auto_recurring.frequency,
            interval_unit: mpPlan.auto_recurring.frequency_type,
            mp_preapproval_plan_id: mpPlan.id,
            status: mpPlan.status,
            raw_mp: mpPlan
        });

        res.status(201).json({
            ok: true,
            message: "Plan sincronizado exitosamente",
            plan: savedPlan
        });
        
    } catch (error) {
        console.error("❌ Error:", error);
        res.status(400).json({
            ok: false,
            error: error.message || "Error al crear plan"
        });
    }
}

module.exports = { createPlan }