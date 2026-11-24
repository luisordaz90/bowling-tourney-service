const express = require('express');
const router = express.Router();
const authorize = require('../middleware/authorize');
const {
  previewSchedule,
  generateSchedule,
  getScheduleSummary,
  deleteSchedule,
  validateSchedule,
} = require('../controllers/scheduleFlatController');

router.get('/preview', previewSchedule);
router.post('/generate', authorize('schedule:generate'), generateSchedule);
router.get('/summary', getScheduleSummary);
router.delete('/', authorize('schedule:delete'), deleteSchedule);
router.get('/validate', validateSchedule);

module.exports = router;
