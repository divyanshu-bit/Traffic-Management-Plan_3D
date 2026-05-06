const { Project, Zone, Asset } = require('../models');
const { sequelize } = require('../config/database');
const { validateZone } = require('../services/rulesEngine');

/**
 * Converts React {lat, lng} array to PostGIS WKT string.
 */
const coordsToWKT = (coords, shapeType) => {
  if (!coords || coords.length === 0) return null;
  const pts = coords.map(c => `${c.lng} ${c.lat}`);
  
  if (shapeType === 'polygon' || shapeType === 'rectangle') {
    if (pts[0] !== pts[pts.length - 1]) pts.push(pts[0]);
    return `POLYGON((${pts.join(', ')}))`;
  }
  return `LINESTRING(${pts.join(', ')})`;
};

exports.validateProject = async (req, res) => {
  try {
    const { zones } = req.body;
    if (!zones || !Array.isArray(zones)) {
      return res.status(400).json({ error: 'Invalid zones data' });
    }

    const validationResults = zones.map(z => ({
      zoneName: z.name,
      zoneId: z.id,
      ...validateZone(z)
    }));

    const allValid = validationResults.every(r => r.isValid);

    res.json({
      overallCompliance: allValid ? 'COMPLIANT' : 'NON-COMPLIANT',
      results: validationResults
    });
  } catch (error) {
    console.error('Validation error:', error);
    res.status(500).json({ error: 'Failed to validate project' });
  }
};

exports.saveProject = async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { 
      reportId, zones, 
      projectName, permitNumber, contractorName, clientName,
      startDate, endDate, workingHours, nightWork,
      superintendent, safetyOfficer, emergencyContact, isWazeSync
    } = req.body;

    // 1. Create or Update Project metadata (with IDOR protection)
    let project = await Project.findOne({ where: { reportId }, transaction: t });

    if (project) {
      if (project.userId !== req.user.id) {
        if (t) await t.rollback();
        return res.status(403).json({ error: 'Forbidden: You do not have permission to modify this project.' });
      }
      // Update existing project
      await project.update({
        name: projectName || 'Untitled Plan',
        permitNumber, contractorName, clientName,
        startDate: startDate || null, 
        endDate: endDate || null,
        workingHours, nightWork,
        superintendent, safetyOfficer, emergencyContact,
        isWazeSync: isWazeSync || false
      }, { transaction: t });
    } else {
      // Create new project
      project = await Project.create({
        reportId,
        userId: req.user.id,
        name: projectName || 'Untitled Plan',
        permitNumber, contractorName, clientName,
        startDate: startDate || null, 
        endDate: endDate || null,
        workingHours, nightWork,
        superintendent, safetyOfficer, emergencyContact,
        isWazeSync: isWazeSync || false,
        schemaVersion: 2
      }, { transaction: t });
    }

    // 2. Identify incoming Zone IDs (UUIDs from DB)
    const incomingZoneIds = zones
      .filter(z => z.id && z.id.length === 36) // Simple UUID length check
      .map(z => z.id);

    // 3. Remove zones no longer present in the project
    await Zone.destroy({ 
      where: { 
        projectId: project.id,
        id: { [require('sequelize').Op.notIn]: incomingZoneIds }
      }, 
      transaction: t 
    });

    // 4. Update or Create Zones
    for (const z of zones) {
      const zoneData = {
        projectId: project.id,
        name: z.name,
        color: z.color,
        shapeType: z.shapeType,
        geometry: sequelize.fn('ST_GeomFromText', coordsToWKT(z.coords, z.shapeType), 4326),
        approachEdgeIndices: z.approachEdgeIndices,
        speedLimit: z.speedLimit,
        workZoneSpeed: z.workZoneSpeed,
        laneCount: z.laneCount,
        laneWidth: z.laneWidth,
        surfaceType: z.surfaceType,
        gradient: z.gradient,
        closureType: z.closureType,
        roadLevel: z.roadLevel,
        hasGenerated: z.hasGenerated,
      };

      let savedZone;
      if (z.id && z.id.length === 36) {
        await Zone.update(zoneData, { where: { id: z.id }, transaction: t });
        savedZone = { id: z.id };
      } else {
        savedZone = await Zone.create(zoneData, { transaction: t });
      }

      // 5. Update Assets for this zone (Clear and Bulk Create is acceptable for assets within a zone)
      await Asset.destroy({ where: { zoneId: savedZone.id }, transaction: t });
      if (z.placedAssets && z.placedAssets.length > 0) {
        const assetsToSave = z.placedAssets.map(a => ({
          zoneId: savedZone.id,
          type: a.type,
          source: a.source,
          location: sequelize.fn('ST_GeomFromText', `POINT(${a.lng} ${a.lat})`, 4326),
          metadata: { originalId: a.id }
        }));
        await Asset.bulkCreate(assetsToSave, { transaction: t });
      }
    }

    await t.commit();
    res.json({ success: true, message: 'Project saved successfully' });
  } catch (error) {
    if (t) await t.rollback();
    console.error('Save error:', error);
    res.status(500).json({ error: 'Failed to save project' });
  }
};

exports.getProjectByReportId = async (req, res) => {
  try {
    const project = await Project.findOne({
      where: { 
        reportId: req.params.reportId,
        userId: req.user.id // Ensure user owns the project
      },
      include: [{
        model: Zone,
        as: 'zones',
        include: [{ model: Asset, as: 'assets' }]
      }]
    });

    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Transform PostGIS geometry back to React {lat, lng} format
    const formattedZones = project.zones.map(z => {
      // Sequelize provides geometry as GeoJSON by default
      const coords = z.geometry.type === 'Polygon' 
        ? z.geometry.coordinates[0].map(c => ({ lng: c[0], lat: c[1] })).slice(0, -1) // remove closing pt
        : z.geometry.coordinates.map(c => ({ lng: c[0], lat: c[1] }));

      return {
        id: z.id,
        name: z.name,
        color: z.color,
        shapeType: z.shapeType,
        coords,
        approachEdgeIndices: z.approachEdgeIndices,
        speedLimit: z.speedLimit,
        workZoneSpeed: z.workZoneSpeed,
        laneCount: z.laneCount,
        laneWidth: z.laneWidth,
        surfaceType: z.surfaceType,
        gradient: z.gradient,
        closureType: z.closureType,
        roadLevel: z.roadLevel,
        hasGenerated: z.hasGenerated,
        placedAssets: z.assets.map(a => ({
          id: a.metadata.originalId || a.id,
          type: a.type,
          source: a.source,
          lat: a.location.coordinates[1],
          lng: a.location.coordinates[0]
        }))
      };
    });

    res.json({ ...project.toJSON(), zones: formattedZones });
  } catch (error) {
    console.error('Load error:', error);
    res.status(500).json({ error: 'Failed to load project' });
  }
};
