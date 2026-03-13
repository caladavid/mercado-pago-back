const express = require("express");
const { receiveMercadoPagoWebhook } = require("./controllers/mercadoPagoWebhook.controller");

const router = express.Router();

router.post("/mercadopago", receiveMercadoPagoWebhook);

module.exports = router;
