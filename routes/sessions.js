const express = require('express');
const router = express.Router();
const {
    updateSessionStatus
} = require('../controllers/sessionsController');

router.put('/:id/status', updateSessionStatus);

module.exports = router;