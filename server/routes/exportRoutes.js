const express = require('express');
const router = express.Router();
const multer = require('multer');
const exportController = require('../controllers/exportController');
const { checkJwt } = require('../middleware/auth');
const { syncUser } = require('../middleware/userSync');

// Set up multer for memory storage with security limits
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF is allowed.'), false);
    }
  }
});

// Protect all export routes
router.use(checkJwt);
router.use(syncUser);

/**
 * @route POST /api/exports/upload
 * @desc  Upload a PDF plan to S3
 */
router.post('/upload', upload.single('pdf'), exportController.createExport);

/**
 * @route GET /api/exports/project/:projectId
 * @desc  Get all exports for a project
 */
router.get('/project/:projectId', exportController.getProjectExports);

module.exports = router;
