const express = require('express');
const router = express.Router();
const wazeService = require('../services/wazeService');
const { checkJwt } = require('../middleware/auth');

// Protect the sync trigger
router.use(checkJwt);

/**
 * @route POST /api/waze/sync
 * @desc  Manually trigger a sync of all active projects with Waze
 */
router.post('/sync', async (req, res) => {
  try {
    const result = await wazeService.syncWithWaze();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
