const axios = require('axios');

/**
 * Fetch road geometries from OpenStreetMap (Overpass API)
 * for a specific bounding box (lat, lng range).
 */
exports.getRoadsInBounds = async (south, west, north, east) => {
  const overpassUrl = 'https://overpass-api.de/api/interpreter';
  const query = `
    [out:json][timeout:25];
    (
      way["highway"](${south},${west},${north},${east});
    );
    out body;
    >;
    out skel qt;
  `;

  try {
    const response = await axios.get(overpassUrl, { params: { data: query } });
    
    // Convert OSM JSON to GeoJSON for easier mapping
    const osmToGeoJSON = (osmData) => {
      const nodes = {};
      osmData.elements.filter(e => e.type === 'node').forEach(n => {
        nodes[n.id] = [n.lon, n.lat];
      });

      const features = osmData.elements.filter(e => e.type === 'way').map(w => ({
        type: 'Feature',
        id: w.id,
        geometry: {
          type: 'LineString',
          coordinates: w.nodes.map(nodeId => nodes[nodeId])
        },
        properties: {
          highway: w.tags.highway,
          name: w.tags.name,
          lanes: w.tags.lanes || '2',
          maxspeed: w.tags.maxspeed || '50'
        }
      }));

      return { type: 'FeatureCollection', features };
    };

    return osmToGeoJSON(response.data);
  } catch (error) {
    console.error('MapData fetch error:', error);
    throw new Error('Could not retrieve road data for intelligence engine.');
  }
};
