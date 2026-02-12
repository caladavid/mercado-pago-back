const { Router } = require('express');
const { createPlan } = require('./controllers/createPlanController');

const router = Router();

// POST http://localhost:3000/api/plans
router.post('/', createPlan);

module.exports = router;