const express = require('express');
const router = express.Router();
const projectController = require('../controllers/projectController');
const { checkJwt } = require('../middleware/auth');
const { syncUser } = require('../middleware/userSync');

// Apply auth middleware
router.use(checkJwt);
router.use(syncUser);

router.post('/save', projectController.saveProject);
router.post('/validate', projectController.validateProject);
router.get('/:reportId', projectController.getProjectByReportId);

module.exports = router;
