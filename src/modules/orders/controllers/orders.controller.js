const ordersRepo = require("../repo/orders.repo");

async function getPaymentStatus(req, res, next) {
    try {
        const { order_id } = req.params;

        let cleanId = order_id;
        if (order_id && order_id.includes(':')) {
            cleanId = order_id.split(':')[1];
        }

        const order = await ordersRepo.getOrderById(cleanId);

        if (!order) {
            return res.status(404).json({
                ok: false,
                message: "No existe la orden con ID: " + cleanId
            })
        }

        res.json({
            status: order.status,
            type: order.type,
            amount: order.total_amount,
            currency: order.currency,
            ref: order.external_reference 
        });
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
}

module.exports = { getPaymentStatus };
