const express = require("express");
const rateLimit = require("express-rate-limit");
const { merchantAuth } = require("../middlewares/merchantAuth");
const subscriptionRoutes = require("../modules/subscriptions/routes");
const planRoutes = require("../modules/plans/routes");
const orderRoutes = require("../modules/orders/routes");
const tenantRoutes = require("../modules/tenant/routes");


const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(limiter);

router.use("/subscriptions", subscriptionRoutes);
router.use('/plans', planRoutes);
router.use('/orders', orderRoutes);
router.use('/tenant', tenantRoutes);

// Ejemplo: POST /api/ping (merchant)
router.post("/ping", merchantAuth, (req, res) => {
  return res.json({
    ok: true,
    merchant: req.merchant,
    message: "Authenticated merchant request",
  });
});

module.exports = router;
