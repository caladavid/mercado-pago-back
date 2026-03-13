const express = require("express");
const { receiveMercadoPagoWebhook } = require("./controllers/mercadoPagoWebhook.controller");
const WebhookTestController = require('./controllers/webhookTest.controller');

const router = express.Router();

router.post("/mercadopago", receiveMercadoPagoWebhook);

router.post('/:merchant/recurring', WebhookTestController.simulateRecurringPayment);

module.exports = router;
