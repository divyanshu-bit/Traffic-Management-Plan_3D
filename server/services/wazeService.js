const axios = require('axios');
const { Project, Zone } = require('../models');

/**
 * Formats Marg Rakshak project data into Waze CIF (Cloud Ingest Format)
 */
const formatForWaze = (project) => {
  return {
    incidents: project.zones.map(zone => {
      // Waze expects [lon, lat] pairs for geometries
      const coordinates = zone.geometry.coordinates;
      
      return {
        id: `SS-${project.id}-${zone.id}`,
        type: "CONSTRUCTION",
        subtype: zone.closureType === 'Full' ? "ROAD_CLOSED" : "HEAVY_TRAFFIC",
        location: {
          polyline: coordinates.map(c => `${c[1]} ${c[0]}`).join(' '), // Waze polyline format
        },
        starttime: project.startDate ? new Date(project.startDate).toISOString() : new Date().toISOString(),
        endtime: project.endDate ? new Date(project.endDate).toISOString() : null,
        description: `${project.name} - ${zone.name}. Managed by Marg Rakshak.`,
        road_name: zone.name,
      };
    })
  };
};

/**
 * Broadcasts all "Waze Sync Enabled" projects to the Waze API
 */
exports.syncWithWaze = async () => {
  try {
    const activeProjects = await Project.findAll({
      where: { isWazeSync: true },
      include: [{ model: Zone, as: 'zones' }]
    });

    if (activeProjects.length === 0) return { message: "No projects flagged for Waze sync." };

    const wazeData = {
      incidents: activeProjects.flatMap(p => formatForWaze(p).incidents)
    };

    // In a real production environment, you would POST this to Waze's partner endpoint
    // Using process.env.WAZE_API_KEY
    console.log(`[WAZE SYNC] Broadcasting ${wazeData.incidents.length} incidents to Waze...`);
    
    // Example call (Commented out until real API key is provided):
    /*
    await axios.post('https://www.waze.com/partnerhub-api/wz-feed', wazeData, {
      headers: { 'Authorization': `Bearer ${process.env.WAZE_API_KEY}` }
    });
    */

    return { success: true, count: wazeData.incidents.length };
  } catch (error) {
    console.error('Waze Sync Error:', error);
    throw new Error('Failed to broadcast data to Waze.');
  }
};
