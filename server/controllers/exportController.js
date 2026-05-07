const { Export, Project } = require('../models');
const { uploadPlan, getDownloadLink } = require('../services/s3Service');

/**
 * Save a newly generated PDF to S3 and record it in the DB
 */
exports.createExport = async (req, res) => {
  try {
    const { projectId } = req.body;
    const pdfFile = req.file;

    if (!pdfFile) return res.status(400).json({ error: 'No PDF file uploaded' });

    // Look up the actual project ID (UUID) using the incoming reportId string
    const project = await Project.findOne({ where: { reportId: projectId } });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (project.userId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden: You do not have permission to upload to this project.' });
    }

    // 1. Upload to S3 Warehouse
    const fileName = `TMP_PLAN_${project.reportId}_${Date.now()}.pdf`;
    const s3Result = await uploadPlan(fileName, pdfFile.buffer);

    // 2. Save record in database using the real UUID
    const exportRecord = await Export.create({
      projectId: project.id,
      fileName,
      s3Key: s3Result.key,
      s3Url: s3Result.s3Url,
      status: 'COMPLETED'
    });

    res.json({ success: true, exportId: exportRecord.id, url: s3Result.s3Url });
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Failed to process export to cloud.' });
  }
};

/**
 * Get a list of all PDFs generated for a specific project
 */
exports.getProjectExports = async (req, res) => {
  try {
    const { projectId } = req.params; // This is actually the reportId string
    
    const project = await Project.findOne({ where: { reportId: projectId } });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    
    if (project.userId !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden: Cannot view these exports.' });
    }

    const exports = await Export.findAll({ where: { projectId: project.id } });
    res.json(exports);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve exports' });
  }
};
