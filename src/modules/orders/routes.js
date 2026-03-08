const express = require("express");

const orderCtrl = require("./controllers/orders.controller.js");;

const router = express.Router();

router.get("/:order_id/status", orderCtrl.getPaymentStatus);

module.exports = router;