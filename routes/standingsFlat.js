const express = require('express');
const router = express.Router();
const { getStandings } = require('../controllers/statisticsFlatController');

// Public — no auth required
router.get('/', getStandings);

module.exports = router;
