import { Router } from 'express';
const logsController = require('./controllers/logs.controller');

const router = Router();

// Endpoint: POST /api/system/logs
router.post('/frontend', logsController.receiveFrontendLog);

module.exports = router;