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

    const length = turf.length(line, { units: 'kilometers' });
    const snapped = turf.nearestPointOnLine(line, turfPoint, { units: 'kilometers' });
    const loc = snapped.properties.location;

    // Take points 2 meters (0.002 km) ahead and 2 meters behind to form a smooth mathematical tangent
    const distBack = Math.max(0, loc - 0.002);
    const distFwd = Math.min(length, loc + 0.002);

    if (distFwd === distBack) return 0;

    const pBack = turf.along(line, distBack, { units: 'kilometers' });
    const pFwd = turf.along(line, distFwd, { units: 'kilometers' });

    return turf.bearing(pBack, pFwd);
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
 * @returns {Object|null} { point: [lat, lon], road: Object, line: Object, location: number } or null if nothing is close enough
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
          
          // Also get location in kilometers for potential path routing
          const snappedKm = turf.nearestPointOnLine(line, turfPoint, { units: 'kilometers' });
          
          closestResult = {
            point: [snapped.geometry.coordinates[1], snapped.geometry.coordinates[0]],
            road: feature,
            line: line,
            location: snappedKm.properties.location
          };
        }
      } catch {
        // A malformed segment should not crash the entire snap pass
      }
    });
  });

  return closestResult;
};

const graphCache = new WeakMap();

/**
 * Builds a local routing graph from the road collection and finds the shortest
 * path between two coordinates, crossing multiple OSM segments if necessary.
 *
 * @param {Array<number>} startCoord      - [lon, lat]
 * @param {Array<number>} endCoord        - [lon, lat]
 * @param {Object}        roadCollection  - GeoJSON FeatureCollection
 * @param {number}        maxSearchDist   - Max routing distance in meters
 * @returns {Array<Array<number>>|null} Array of [lon, lat] points forming the path
 */
export const findPathInNetwork = (startCoord, endCoord, roadCollection, maxSearchDist = 2500) => {
  if (!roadCollection || !roadCollection.features) return null;
  
  let cacheEntry = graphCache.get(roadCollection);
  
  if (!cacheEntry) {
    const graph = {};
    const exactCoords = {}; // Store the exact coordinates for path reconstruction
    
    const addEdge = (pA, pB) => {
      const kA = `${pA[0].toFixed(5)},${pA[1].toFixed(5)}`;
      const kB = `${pB[0].toFixed(5)},${pB[1].toFixed(5)}`;
      if (kA === kB) return;
      
      if (!exactCoords[kA]) exactCoords[kA] = pA;
      if (!exactCoords[kB]) exactCoords[kB] = pB;
      
      const d = turf.distance(pA, pB, { units: 'meters' });
      if (!graph[kA]) graph[kA] = [];
      if (!graph[kB]) graph[kB] = [];
      
      if (!graph[kA].some(e => e.node === kB)) {
        graph[kA].push({ node: kB, dist: d });
        graph[kB].push({ node: kA, dist: d });
      }
    };

    roadCollection.features.forEach(feat => {
      if (feat.properties?.isBuilding || feat.properties?.isObstacle) return;
      if (feat.geometry.type === 'LineString') {
        const coords = feat.geometry.coordinates;
        for (let i = 0; i < coords.length - 1; i++) addEdge(coords[i], coords[i + 1]);
      } else if (feat.geometry.type === 'MultiLineString') {
        feat.geometry.coordinates.forEach(line => {
           for (let i = 0; i < line.length - 1; i++) addEdge(line[i], line[i + 1]);
        });
      }
    });
    
    cacheEntry = { graph, exactCoords };
    graphCache.set(roadCollection, cacheEntry);
  }

  const { graph, exactCoords } = cacheEntry;

  let startNode = null, endNode = null;
  let minStartD = Infinity, minEndD = Infinity;

  Object.keys(graph).forEach(k => {
    const pt = exactCoords[k];
    const ds = turf.distance(startCoord, pt, { units: 'meters' });
    const de = turf.distance(endCoord, pt, { units: 'meters' });
    if (ds < minStartD) { minStartD = ds; startNode = k; }
    if (de < minEndD) { minEndD = de; endNode = k; }
  });

  // Increased abort tolerance to allow routing on long segments (from 80m to 300m)
  if (!startNode || !endNode || minStartD > 300 || minEndD > 300) return null;

  const distances = { [startNode]: 0 };
  const previous = { [startNode]: null };
  const pq = [{ node: startNode, dist: 0 }];
  const visited = new Set();

  while (pq.length > 0) {
    pq.sort((a, b) => a.dist - b.dist);
    const { node: u } = pq.shift();
    
    if (u === endNode) break;
    if (visited.has(u)) continue;
    visited.add(u);

    if (distances[u] > maxSearchDist) continue;

    (graph[u] || []).forEach(neighbor => {
      const v = neighbor.node;
      const alt = distances[u] + neighbor.dist;
      if (distances[v] === undefined || alt < distances[v]) {
        distances[v] = alt;
        previous[v] = u;
        pq.push({ node: v, dist: alt });
      }
    });
  }

  if (previous[endNode] === undefined) return null;

  const path = [];
  let curr = endNode;
  while (curr) {
    path.unshift(exactCoords[curr]);
    curr = previous[curr];
  }

  return path;
};