const { Router } = require('express');
const { transactionController } = require('./controllers/transactions.controller');
const { customerController } = require('./controllers/customer.controller');
const { merchantAuth } = require("../../middlewares/merchantAuth");

const router = Router();

router.use(merchantAuth);

// Historial general de pagos (Únicos y Suscripciones)
router.get('/transactions', transactionController.getHistory);

// Detalle de una transacción específica
router.get('/transactions/:id', transactionController.getTransactionDetail);

// Listado de clientes del Merchant
router.get('/customers', customerController.getCustomers);

// Historial de pagos de un cliente específico
router.get('/customers/:userId/transactions', customerController.getCustomerHistory);

module.exports = router;