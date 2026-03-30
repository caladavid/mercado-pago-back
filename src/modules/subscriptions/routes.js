const express = require("express");

const mw = require("../../middlewares/merchantAuth.js");
const controller = require("../subscriptions/controllers/subscriptions.controller.js");
const merchantAuth = mw.merchantAuth;

const router = express.Router();

router.get("/", merchantAuth, controller.listSubscriptions);
router.get("/:id", merchantAuth, controller.getSubscriptionById);
// Opción A: Flexible, calculada al vuelo (La que usarás el 90% del tiempo si hay descuentos)
router.post("/ad-hoc", controller.createAdHocSubscription);

// Opción B: Rígida, basada en plan pre-creado en MP
router.post("/plan", merchantAuth, controller.createSubscriptionFromPlan);

router.put("/:id/cancel", merchantAuth, controller.cancelSubscription);
router.put("/cancel-by-plan", merchantAuth, controller.cancelSubscriptionByPlan);

module.exports = router;
