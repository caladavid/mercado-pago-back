const express = require("express");

const mw = require("../../middlewares/merchantAuth.js");
const merchantAuth = mw.merchantAuth;

const merchantCtrl = require("./controllers/merchantCheckout.controller.js");
const publicCtrl = require("./controllers/publicCheckout.controller");
const publicCardsCtrl = require("./controllers/publicCards.controller");
const publicPaymentCtrl = require("./controllers/publicPayment.controller");

const router = express.Router();

router.post("/merchant/checkouts", merchantAuth, merchantCtrl.createCheckout);

router.get("/checkout/:external_reference", publicCtrl.getCheckout);

// Listar tarjetas
router.get("/checkout/:external_reference/cards", publicCardsCtrl.listCards);

// Guardar tarjeta
router.post("/checkout/:external_reference/add_cards", publicCardsCtrl.saveCard);

// Pagar con tarjeta nueva
router.post("/checkout/:external_reference/pay", publicPaymentCtrl.payCheckout);

// Eliminar tarjeta
router.delete("/checkout/:external_reference/cards/:card_id", publicCardsCtrl.deleteCard);

module.exports = router;