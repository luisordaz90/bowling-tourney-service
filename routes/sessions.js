const express = require('express');
const router = express.Router();
const { updateSessionStatus } = require('../controllers/scheduleController');

router.put('/:id/status', updateSessionStatus);

module.exports = router;
