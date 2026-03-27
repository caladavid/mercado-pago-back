const { Router } = require('express');
const { createPlan, listPlans, cancelPlan, getPlan, getSubscriptionsByPlan, updatePlan } = require('./controllers/createPlanController');
const { merchantAuth } = require("../../middlewares/merchantAuth");

const router = Router();

router.use(merchantAuth);

router.get('/', listPlans);

router.post('/', createPlan);

router.get('/:id', getPlan);

router.put('/:id', updatePlan);

router.get('/:id/subscriptions', getSubscriptionsByPlan);

router.put('/:id/cancel', cancelPlan);

module.exports = router;