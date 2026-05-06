import * as turf from '@turf/turf';

/**
 * Fetches road geometries from Overpass API within a given radius.
 * @param {number} lat 
 * @param {number} lon 
 * @param {number} radius - Search radius in meters
 * @returns {Promise<Object>} GeoJSON FeatureCollection of roads
 */
export const fetchRoadVectors = async (lat, lon, radius = 800) => {
  const query = `
    [out:json][timeout:25];
    (
      way["highway"](around:${radius},${lat},${lon});
      way["building"](around:${radius},${lat},${lon});
      relation["building"](around:${radius},${lat},${lon});
      node["natural"="tree"](around:${radius},${lat},${lon});
      way["barrier"](around:${radius},${lat},${lon});
    );
    out geom;
  `;
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url);
    if (response.status === 429) return null;
    if (!response.ok) throw new Error('Overpass API error');
    const data = await response.json();
    
    const features = data.elements
      .filter(el => 
        (el.type === 'way' && el.geometry) || 
        (el.type === 'relation' && el.bounds) ||
        (el.type === 'node' && el.lat && el.lon)
      )
      .map(way => {
        const isBuilding = !!(way.tags && way.tags.building);
        const isObstacle = !!(way.tags && (way.tags.barrier || way.tags.natural === 'tree'));
        
        if (way.type === 'node') {
          return turf.point([way.lon, way.lat], { id: way.id, ...way.tags, isObstacle, isBuilding: false });
        }

        let coords;
        if (way.type === 'relation' && way.bounds) {
          coords = [
            [way.bounds.minlon, way.bounds.minlat],
            [way.bounds.maxlon, way.bounds.minlat],
            [way.bounds.maxlon, way.bounds.maxlat],
            [way.bounds.minlon, way.bounds.maxlat],
            [way.bounds.minlon, way.bounds.minlat]
          ];
        } else {
          coords = way.geometry.map(p => [p.lon, p.lat]);
        }
        
        if (isBuilding) {
          if (coords[0][0] !== coords[coords.length-1][0] || coords[0][1] !== coords[coords.length-1][1]) {
            coords.push(coords[0]);
          }
          if (coords.length < 4) return null;
          return turf.polygon([coords], { id: way.id, ...way.tags, isBuilding, isObstacle });
        }
        return turf.lineString(coords, { id: way.id, ...way.tags, isBuilding: false, isObstacle });
      })
      .filter(f => f !== null);

    return turf.featureCollection(features);
  } catch (error) {
    console.error('Failed to fetch map vectors:', error);
    return null;
  }
};

/**
 * Calculates the orientation (bearing) of a road at a specific point.
 * @param {Array<number>} point - [lat, lon]
 * @param {Object} roadFeature - GeoJSON LineString feature
 * @returns {number} Bearing in degrees
 */
export const getRoadOrientation = (point, roadFeature) => {
  if (!roadFeature || (roadFeature.geometry.type !== 'LineString' && roadFeature.geometry.type !== 'MultiLineString')) {
    return 0;
  }

  try {
    const turfPoint = turf.point([point[1], point[0]]);
    const snapped = turf.nearestPointOnLine(roadFeature, turfPoint);
    const line = roadFeature.geometry.type === 'MultiLineString' 
      ? turf.flatten(roadFeature).features[0] // Simplify for now
      : roadFeature;

    const lineCoords = line.geometry.coordinates;
    const snappedCoords = snapped.geometry.coordinates;
    
    // Find segment
    let bestSegmentIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < lineCoords.length - 1; i++) {
      const seg = turf.lineString([lineCoords[i], lineCoords[i+1]]);
      const d = turf.pointToLineDistance(snapped, seg, { units: 'meters' });
      if (d < minDist) {
        minDist = d;
        bestSegmentIdx = i;
      }
    }

    const p1 = turf.point(lineCoords[bestSegmentIdx]);
    const p2 = turf.point(lineCoords[bestSegmentIdx + 1]);
    return turf.bearing(p1, p2);
  } catch (e) {
    console.warn('Orientation calculation failed', e);
    return 0;
  }
};

/**
 * Snaps a given coordinate to the nearest road in the provided road collection.
 * @param {Array<number>} point - [lat, lon]
 * @param {Object} roadCollection - GeoJSON FeatureCollection of roads
 * @param {number} maxDistanceMeters - Max distance to allow snapping
 * @returns {Array<number>|null} Snapped [lat, lon] or null if no snap
 */
export const snapToRoads = (point, roadCollection, maxDistanceMeters = 20) => {
  if (!roadCollection || roadCollection.features.length === 0) return null;

  const turfPoint = turf.point([point[1], point[0]]); // [lon, lat]
  let closestPoint = null;
  let minDistance = Infinity;

  roadCollection.features.forEach(feature => {
    // Only snap to line highways, ignore buildings, obstacles, or point features (trees)
    if (feature.properties.isBuilding || feature.properties.isObstacle) return;
    if (feature.geometry.type !== 'LineString' && feature.geometry.type !== 'MultiLineString') return;

    const snapped = turf.nearestPointOnLine(feature, turfPoint, { units: 'meters' });
    const distance = snapped.properties.dist;

    if (distance < minDistance && distance <= maxDistanceMeters) {
      minDistance = distance;
      closestPoint = [snapped.geometry.coordinates[1], snapped.geometry.coordinates[0]]; // [lat, lon]
    }
  });

  return closestPoint;
};
