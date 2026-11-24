const express = require('express');
const router = express.Router();
const authorize = require('../middleware/authorize');
const { createSession, getSessions, updateSessionStatus } = require('../controllers/sessionsController');

router.post('/', authorize('session:create'), createSession);
router.get('/', getSessions);
router.put('/:id/status', authorize('session:update'), updateSessionStatus);

module.exports = router;
