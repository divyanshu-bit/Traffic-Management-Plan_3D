const turf = require('@turf/turf');
const { IRC_PARAMS, SNAP_THRESHOLDS } = require('../config/constants');

/**
 * Smart Asset Generation - Uses road data to snap assets precisely
 */
const generateSmartAssets = (zone, roadCollection) => {
  if (!zone.coords || zone.coords.length < 2) return [];
  if (!roadCollection || !roadCollection.features.length) return [];

  const assets = [];
  const speed = Number(zone.speedLimit || 50);
  const params = IRC_PARAMS[String(speed)] || IRC_PARAMS['50'];
  const startPoint = zone.coords[0];
  
  const generateId = () => `smart-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  // 1. Find the closest road feature
  const pt = turf.point([startPoint.lng, startPoint.lat]);
  let closestRoad = null;
  let minDist = Infinity;

  roadCollection.features.forEach(feature => {
    const d = turf.pointToLineDistance(pt, feature, { units: 'meters' });
    if (d < minDist && d < SNAP_THRESHOLDS.ROAD_SNAP) {
      minDist = d;
      closestRoad = feature;
    }
  });

  if (!closestRoad) return [];

  // 2. Snap to road and calculate positions
  const snappedStart = turf.nearestPointOnLine(closestRoad, pt, { units: 'meters' });
  const startDistOnLine = snappedStart.properties.location;
  
  // 3. ADVANCED INTELLIGENCE: Progressive Warning Sequence
  
  // A. Advance Warning (e.g., 100m - 200m before)
  if (startDistOnLine >= params.advWarn) {
    const advPoint = turf.along(closestRoad, startDistOnLine - params.advWarn, { units: 'meters' });
    assets.push({
      id: generateId(),
      type: 'sign-roadwork',
      source: 'smart',
      lat: advPoint.geometry.coordinates[1],
      lng: advPoint.geometry.coordinates[0],
      rotation: 0,
      metadata: { label: 'Advance Warning (IRC)' }
    });
  }

  // B. High Speed Reductions (e.g., SLOW sign 50m after first warning)
  if (speed >= 80 && startDistOnLine >= (params.advWarn - 50)) {
    const slowPoint = turf.along(closestRoad, startDistOnLine - (params.advWarn - 50), { units: 'meters' });
    assets.push({
      id: generateId(),
      type: 'sign-slow',
      source: 'smart',
      lat: slowPoint.geometry.coordinates[1],
      lng: slowPoint.geometry.coordinates[0],
      rotation: 0,
      metadata: { label: 'Speed Reduction' }
    });
  }

  // C. Local Context: Men at Work sign (near the taper)
  if (startDistOnLine >= 20) {
    const menPoint = turf.along(closestRoad, startDistOnLine - 20, { units: 'meters' });
    assets.push({
      id: generateId(),
      type: 'sign-menwork',
      source: 'smart',
      lat: menPoint.geometry.coordinates[1],
      lng: menPoint.geometry.coordinates[0],
      rotation: 0,
      metadata: { label: 'Worker Protection' }
    });
  }

  // 4. Place Taper Cones
  const taperCount = 8; // Increased for better visual density
  for (let i = 0; i < taperCount; i++) {
    const dist = startDistOnLine - (params.taperLen / taperCount) * i;
    if (dist >= 0) {
      const conePos = turf.along(closestRoad, dist, { units: 'meters' });
      assets.push({
        id: generateId(),
        type: 'cone',
        source: 'smart',
        lat: conePos.geometry.coordinates[1],
        lng: conePos.geometry.coordinates[0],
        rotation: 0,
        metadata: { label: 'Taper Delineation' }
      });
    }
  }

  // 5. END OF ZONE LOGIC: Place "End Road Work" sign
  // We estimate the end point by looking at the last coordinate of the zone
  const endPointRaw = zone.coords[zone.coords.length - 1];
  const endPt = turf.point([endPointRaw.lng, endPointRaw.lat]);
  const snappedEnd = turf.nearestPointOnLine(closestRoad, endPt, { units: 'meters' });
  const endDistOnLine = snappedEnd.properties.location;

  if (endDistOnLine > startDistOnLine) {
    const exitPoint = turf.along(closestRoad, endDistOnLine + 10, { units: 'meters' }); // 10m past the work zone
    assets.push({
      id: generateId(),
      type: 'sign-endwork',
      source: 'smart',
      lat: exitPoint.geometry.coordinates[1],
      lng: exitPoint.geometry.coordinates[0],
      rotation: 0,
      metadata: { label: 'End of Work' }
    });
  }

  return assets;
};

/**
 * Validates a single zone against IRC standards using Turf.js.
 */
const validateZone = (zone) => {
  const speed = String(zone.speedLimit || '50');
  const params = IRC_PARAMS[speed] || IRC_PARAMS['50'];
  const errors = [];
  const warnings = [];

  const coords = zone.coords || [];
  const isPath = zone.shapeType === 'polyline';
  const minPts = isPath ? 2 : 3;
  
  let perim = 0;
  if (coords.length < minPts) {
    errors.push(`Zone needs at least ${minPts} points.`);
  } else {
    // Use Turf for precise perimeter/length
    const line = isPath 
      ? turf.lineString(coords.map(c => [c.lng, c.lat]))
      : turf.polygon([ [...coords, coords[0]].map(c => [c.lng, c.lat]) ]);
    
    perim = turf.length(line, { units: 'meters' });

    if (perim < params.advWarn) {
      warnings.push(`Zone perimeter (${Math.round(perim)}m) is less than IRC mandated Advance Warning distance (${params.advWarn}m).`);
    }
  }

  const assets = zone.placedAssets || [];
  const cones = assets.filter(a => a.type === 'cone');
  
  if (cones.length > 0 && perim > 0) {
    const actualSpacing = perim / cones.length;
    if (actualSpacing > params.coneSpacing * 1.2) {
      warnings.push(`Cone spacing (${Math.round(actualSpacing)}m) exceeds IRC mandated ${params.coneSpacing}m for ${speed}km/h.`);
    }
  }

  if (!assets.some(a => a.type === 'sign-roadwork')) {
    errors.push('IRC SP 55 requires at least one "Road Work Ahead" sign for this zone.');
  }

  return {
    isValid: errors.length === 0,
    complianceStatus: errors.length === 0 ? 'COMPLIANT' : 'NON-COMPLIANT',
    riskLevel: params.riskLevel,
    standard: params.standard,
    errors,
    warnings,
    metadata: {
      perimeter: Math.round(perim),
      mandatedTaper: params.taperLen,
      mandatedAdvWarn: params.advWarn
    }
  };
};

module.exports = {
  generateSmartAssets,
  validateZone
};
