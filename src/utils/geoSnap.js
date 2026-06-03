import * as turf from '@turf/turf';

/**
 * Fetches road geometries (and nearby spatial features) from Overpass API
 * within a given radius.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {number} radius - Search radius in metres
 * @returns {Promise<Object|null>} GeoJSON FeatureCollection, or null on failure
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
    if (response.status === 429) {
      console.warn('[geoSnap] Overpass rate-limited (429). Returning null.');
      return null;
    }
    if (!response.ok) throw new Error(`Overpass API error: ${response.status}`);
    const data = await response.json();

    const features = data.elements
      .filter(el =>
        (el.type === 'way' && el.geometry) ||
        (el.type === 'relation' && el.bounds) ||
        (el.type === 'node' && el.lat && el.lon)
      )
      .map(el => {
        const isBuilding = !!(el.tags?.building);
        const isObstacle = !!(el.tags?.barrier || el.tags?.natural === 'tree');

        if (el.type === 'node') {
          return turf.point([el.lon, el.lat], { id: el.id, ...el.tags, isObstacle, isBuilding: false });
        }

        let coords;
        if (el.type === 'relation' && el.bounds) {
          coords = [
            [el.bounds.minlon, el.bounds.minlat],
            [el.bounds.maxlon, el.bounds.minlat],
            [el.bounds.maxlon, el.bounds.maxlat],
            [el.bounds.minlon, el.bounds.maxlat],
            [el.bounds.minlon, el.bounds.minlat],
          ];
        } else {
          coords = el.geometry.map(p => [p.lon, p.lat]);
        }

        if (isBuilding) {
          // Ensure the ring is closed
          if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
            coords.push(coords[0]);
          }
          if (coords.length < 4) return null;
          return turf.polygon([coords], { id: el.id, ...el.tags, isBuilding, isObstacle });
        }

        // FIX #1: Guard against degenerate line strings. turf.lineString requires
        // at least 2 coordinate pairs; a single-node way from Overpass would
        // throw and crash the entire fetch. Filter them out instead.
        if (coords.length < 2) return null;

        return turf.lineString(coords, { id: el.id, ...el.tags, isBuilding: false, isObstacle });
      })
      .filter(f => f !== null);

    return turf.featureCollection(features);
  } catch (error) {
    console.error('[geoSnap] Failed to fetch road vectors:', error);
    return null;
  }
};

/**
 * Calculates the orientation (bearing in degrees) of a road at the point
 * nearest to the given coordinate.
 *
 * @param {Array<number>} point - [lat, lon]
 * @param {Object} roadFeature  - GeoJSON LineString or MultiLineString feature
 * @returns {number} Bearing in degrees (0–360), or 0 on failure
 */
export const getRoadOrientation = (point, roadFeature) => {
  if (
    !roadFeature ||
    (roadFeature.geometry.type !== 'LineString' && roadFeature.geometry.type !== 'MultiLineString')
  ) {
    return 0;
  }

  try {
    const turfPoint = turf.point([point[1], point[0]]); // [lon, lat]

    // FIX #2: For MultiLineString, iterate all sub-lines and pick the one
    // whose nearest point is closest, rather than always using features[0].
    // This gives the correct segment at junctions and complex intersections.
    let line;
    if (roadFeature.geometry.type === 'MultiLineString') {
      const subLines = turf.flatten(roadFeature).features;
      let minDist = Infinity;
      subLines.forEach(sub => {
        const nearest = turf.nearestPointOnLine(sub, turfPoint, { units: 'meters' });
        if (nearest.properties.dist < minDist) {
          minDist = nearest.properties.dist;
          line = sub;
        }
      });
    } else {
      line = roadFeature;
    }

    if (!line) return 0;

    const lineCoords = line.geometry.coordinates;
    const snapped = turf.nearestPointOnLine(line, turfPoint);

    // Find the segment the snapped point sits on
    let bestSegmentIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < lineCoords.length - 1; i++) {
      const seg = turf.lineString([lineCoords[i], lineCoords[i + 1]]);
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
    console.warn('[geoSnap] Orientation calculation failed:', e);
    return 0;
  }
};

/**
 * Snaps a coordinate to the nearest road in the provided FeatureCollection.
 *
 * @param {Array<number>} point           - [lat, lon]
 * @param {Object}        roadCollection  - GeoJSON FeatureCollection
 * @param {number}        maxDistanceMeters
 * @returns {Object|null} { point: [lat, lon], road: Object } or null if nothing is close enough
 */
export const snapToRoads = (point, roadCollection, maxDistanceMeters = 20) => {
  if (!roadCollection || roadCollection.features.length === 0) return null;

  const turfPoint = turf.point([point[1], point[0]]); // [lon, lat]
  let closestResult = null;
  let minDistance = Infinity;

  roadCollection.features.forEach(feature => {
    // Only snap to road lines; skip buildings, obstacles, and point features
    if (feature.properties.isBuilding || feature.properties.isObstacle) return;
    if (feature.geometry.type !== 'LineString' && feature.geometry.type !== 'MultiLineString') return;

    // FIX #3: turf.nearestPointOnLine does not support MultiLineString directly
    // in all turf versions. Flatten first to guarantee we always pass a
    // LineString, avoiding a silent NaN distance that could make minDistance
    // never update and return null even when a road is right underneath.
    const lines =
      feature.geometry.type === 'MultiLineString'
        ? turf.flatten(feature).features
        : [feature];

    lines.forEach(line => {
      try {
        const snapped = turf.nearestPointOnLine(line, turfPoint, { units: 'meters' });
        const distance = snapped.properties.dist;
        if (distance < minDistance && distance <= maxDistanceMeters) {
          minDistance = distance;
          closestResult = {
            point: [snapped.geometry.coordinates[1], snapped.geometry.coordinates[0]],
            road: feature
          };
        }
      } catch {
        // A malformed segment should not crash the entire snap pass
      }
    });
  });

  return closestResult;
};