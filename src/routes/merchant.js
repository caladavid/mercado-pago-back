const express = require("express");
const rateLimit = require("express-rate-limit");
const { merchantAuth } = require("../middlewares/merchantAuth");

const router = express.Router();

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(limiter);

// Ejemplo: POST /api/ping (merchant)
router.post("/ping", merchantAuth, (req, res) => {
  return res.json({
    ok: true,
    merchant: req.merchant,
    message: "Authenticated merchant request",
  });
});

module.exports = router;
