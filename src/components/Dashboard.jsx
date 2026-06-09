import React, { useState, useRef, useCallback, useEffect, Component } from 'react';
import * as turf from '@turf/turf';

import './Dashboard.css';
import useStore from '../store/useStore';

import MapArea from './Maparea';
import Sidebar from './Sidebar';
import FloatingDock from './FloatingDock';

const MemoizedMapArea = React.memo(MapArea);
const MemoizedSidebar = React.memo(Sidebar);
const MemoizedFloatingDock = React.memo(FloatingDock);
import OnboardingOverlay from './OnboardingOverlay';
import HelpModal from './HelpModal';
import { snapToRoads, fetchRoadVectors } from '../utils/geoSnap';

import LoginScreen from './login/LoginScreen';
import { useMRAuth } from '../hooks/useMRAuth';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', background: '#ef4444', color: 'white', zIndex: 9999, position: 'absolute', inset: 0 }}>
          <h2>Something went wrong in MapArea.</h2>
          <pre>{this.state.error?.toString()}</pre>
          <pre>{this.state.error?.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const CONE_SPACING = { '30': 12, '50': 18, '80': 24 };

export const ZONE_COLORS = [
  '#0ea5e9', '#10b981', '#f59e0b', '#a78bfa',
  '#f43f5e', '#06b6d4', '#fb923c', '#84cc16',
];

export const haversineDist = (p1, p2) => {
  const R = 6371e3;
  const φ1 = (p1.lat * Math.PI) / 180, φ2 = (p2.lat * Math.PI) / 180;
  const a = Math.sin(((p2.lat - p1.lat) * Math.PI) / 180 / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(((p2.lng - p1.lng) * Math.PI) / 180 / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const generatePerimeterAssets = (coords, shapeType = 'polygon', approachIndices = [0], spacingMeters = 18, speedLimit = 50, roadCollection = null, approachDirections = {}, laneWidth = 3.5) => {
  const minPts = shapeType === 'polyline' ? 2 : 3;
  if (!coords || coords.length < minPts) return [];

  // Bounding box pre-filtering to optimize road/building collision check performance
  if (roadCollection?.features?.length) {
    try {
      const lats = coords.map(c => c.lat);
      const lngs = coords.map(c => c.lng);
      const pad = 0.0015; // roughly 160m safety margin
      const zoneBbox = [
        Math.min(...lngs) - pad,
        Math.min(...lats) - pad,
        Math.max(...lngs) + pad,
        Math.max(...lats) + pad
      ];
      const filteredFeatures = roadCollection.features.filter(f => {
        try {
          const fBbox = turf.bbox(f);
          return fBbox[0] <= zoneBbox[2] && fBbox[2] >= zoneBbox[0] &&
                 fBbox[1] <= zoneBbox[3] && fBbox[3] >= zoneBbox[1];
        } catch {
          return false;
        }
      });
      roadCollection = { ...roadCollection, features: filteredFeatures };
    } catch (e) {
      console.warn("Bounding box pre-filtering failed, falling back to original collection", e);
    }
  }

  const assets = [];
  const tsBase = Date.now();
  const lerp = (s, e, t) => ({ lat: s.lat + (e.lat - s.lat) * t, lng: s.lng + (e.lng - s.lng) * t });
  const isPath = shapeType === 'polyline';
  const loopLimit = isPath ? coords.length - 1 : coords.length;

  const trySnap = (lat, lng, radius = 12) => {
    if (!roadCollection || !roadCollection.features?.length) return { lat, lng };
    const snapped = snapToRoads([lat, lng], roadCollection, radius);
    return snapped ? { lat: snapped.point[0], lng: snapped.point[1] } : { lat, lng };
  };

  // PERFORMANCE OPTIMIZATION: Pre-filter and pre-compute BBoxes for obstacles
  const obstacles = (roadCollection?.features || [])
    .filter(f => f.properties.isBuilding || f.properties.isObstacle)
    .map(f => ({ ...f, bbox: turf.bbox(f) }));

  const checkCollision = (lng, lat) => {
    if (!obstacles.length) return false;
    const pt = turf.point([lng, lat]);
    const px = lng, py = lat;
    
    return obstacles.some(f => {
      const b = f.bbox;
      // Step 1: O(1) BBox pre-check (Filters 99% of candidates instantly)
      if (px < b[0] || px > b[2] || py < b[1] || py > b[3]) return false;
      
      // Step 2: Expensive Turf check only if inside BBox
      try {
        if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
          return turf.booleanPointInPolygon(pt, f);
        } else if (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString') {
          return turf.pointToLineDistance(pt, f, { units: 'meters' }) < 1;
        }
      } catch (e) { return false; }
      return false;
    });
  };

  const offsetRoadRight = (snappedLat, snappedLng, roads, crossOffset = 3.5) => {
    if (!roads?.features?.length) return { lat: snappedLat, lng: snappedLng };
    const point = turf.point([snappedLng, snappedLat]);
    let bestRoad = null, minDist = Infinity;
    
    roads.features.forEach(road => {
      if (road.properties.isBuilding || road.properties.isObstacle) return;
      if (road.geometry.type !== 'LineString' && road.geometry.type !== 'MultiLineString') return;
      
      const d = turf.pointToLineDistance(point, road, { units: 'meters' });
      if (d < minDist) {
        minDist = d;
        bestRoad = road;
      }
    });

    if (!bestRoad) return { lat: snappedLat, lng: snappedLng };

    try {
      const snappedOnBest = turf.nearestPointOnLine(bestRoad, point);
      const startLoc = snappedOnBest.properties.location || 0;
      const lineLen = turf.length(bestRoad, { units: 'meters' });
      
      // BEARING SMOOTHING: Increased lookahead to 3m for more stable orientation
      const aheadDist = Math.min(lineLen, startLoc + 3);
      const aheadPoint = turf.along(bestRoad, aheadDist, { units: 'meters' });
      const refPoint = (aheadDist <= startLoc + 0.1) 
        ? turf.along(bestRoad, Math.max(0, startLoc - 3), { units: 'meters' })
        : snappedOnBest;
      const targetPoint = (aheadDist <= startLoc + 0.1) ? snappedOnBest : aheadPoint;
      
      let bearing = turf.bearing(refPoint, targetPoint);
      if (isNaN(bearing) || (refPoint.geometry.coordinates[0] === targetPoint.geometry.coordinates[0] && refPoint.geometry.coordinates[1] === targetPoint.geometry.coordinates[1])) {
        bearing = 0;
      }
      const offsetPos = turf.destination(snappedOnBest, crossOffset, bearing - 90, { units: 'meters' });
      return { lat: offsetPos.geometry.coordinates[1], lng: offsetPos.geometry.coordinates[0] };
    } catch (e) {
      console.warn("Offset calculation failed, using raw snapped position", e);
      return { lat: snappedLat, lng: snappedLng };
    }
  };

  const findClearPosLine = (startPt, endPt, tRatio, maxNudgeMeters = 5) => {
    const defaultPos = lerp(startPt, endPt, tRatio);
    if (!checkCollision(defaultPos.lng, defaultPos.lat)) return defaultPos;
    const edgeDist = haversineDist(startPt, endPt);
    if (edgeDist === 0) return null;
    const mToT = 1 / edgeDist;
    for (let step = 1; step <= maxNudgeMeters; step++) {
      let nf = tRatio + (step * mToT);
      if (nf <= 1) {
        let p = lerp(startPt, endPt, nf);
        if (!checkCollision(p.lng, p.lat)) return p;
      }
      let nb = tRatio - (step * mToT);
      if (nb >= 0) {
        let p = lerp(startPt, endPt, nb);
        if (!checkCollision(p.lng, p.lat)) return p;
      }
    }
    return null;
  };

  // Pre-calculate which approach edges have a parallel road-aligned taper.
  // If the taper and edge alignments diverge (or no road is found), we do not skip perimeter cones on that edge.
  const skippedPerimeterEdges = [];
  approachIndices.forEach(approachIdx => {
    const safeIdx = Math.min(Math.max(0, approachIdx), loopLimit - 1);
    const startPoint = coords[safeIdx];
    const endPoint   = coords[(safeIdx + 1) % coords.length];
    
    let followRoad = null;
    const midPoint = lerp(startPoint, endPoint, 0.5);
    if (roadCollection?.features?.length) {
      const p = turf.point([midPoint.lng, midPoint.lat]);
      let minDist = Infinity;
      roadCollection.features.forEach(f => {
        if (f.properties.isBuilding || f.properties.isObstacle) return;
        const d = turf.pointToLineDistance(p, f, { units: 'meters' });
        if (d < minDist && d < 45) { minDist = d; followRoad = f; }
      });
    }

    if (followRoad) {
      try {
        const p = turf.point([midPoint.lng, midPoint.lat]);
        const snappedMid = turf.nearestPointOnLine(followRoad, p);
        const startLoc = snappedMid.properties.location || 0;
        const lineLen = turf.length(followRoad, { units: 'meters' });
        const aheadDist = Math.min(lineLen, startLoc + 1);
        const aheadPoint = turf.along(followRoad, aheadDist, { units: 'meters' });
        const refPoint = (aheadDist <= startLoc)
          ? turf.along(followRoad, Math.max(0, startLoc - 1), { units: 'meters' })
          : snappedMid;
        const targetPoint = (aheadDist <= startLoc) ? snappedMid : aheadPoint;
        let roadBearing = turf.bearing(refPoint, targetPoint);
        if (isNaN(roadBearing)) roadBearing = 0;

        const edgeBearing = turf.bearing(
          turf.point([startPoint.lng, startPoint.lat]),
          turf.point([endPoint.lng, endPoint.lat])
        );

        let angleDiff = Math.abs((edgeBearing - roadBearing) % 180);
        if (angleDiff > 90) angleDiff = 180 - angleDiff;

        if (angleDiff < 35) {
          skippedPerimeterEdges.push(safeIdx);
        }
      } catch (e) {
        skippedPerimeterEdges.push(safeIdx);
      }
    }
  });

  for (let i = 0; i < loopLimit; i++) {
    if (skippedPerimeterEdges.includes(i)) continue;
    const start = coords[i], end = coords[(i + 1) % coords.length];
    const dist = haversineDist(start, end);
    const count = Math.max(1, Math.ceil(dist / spacingMeters));
    for (let j = 0; j < count; j++) {
      const t = j / count;
      let finalPos = findClearPosLine(start, end, t, 3);
      if (!finalPos) continue;
      // Do not snap standard perimeter cones to roads to ensure they align perfectly with the user's drawn boundary.
      assets.push({ 
        id: `auto-${tsBase}-${i}-${j}`, 
        type: 'cone', source: 'auto', 
        lat: finalPos.lat, lng: finalPos.lng 
      });
    }
  }

  const zoneCentroid = coords.reduce((acc, c) => ({ lat: acc.lat + c.lat/coords.length, lng: acc.lng + c.lng/coords.length }), {lat:0, lng:0});
  const MAX_PLAN_RADIUS = 500;

  // IRC:SP:55 Standard Parameters for single lane closures
  const IRC_PARAMS = {
    '30': { taper: 15, signMerge: 30, signMen: 60, signAdv: 90 },
    '50': { taper: 50, signMerge: 50, signMen: 100, signAdv: 150 },
    '80': { taper: 130, signMerge: 100, signMen: 200, signAdv: 300 }
  };

  approachIndices.forEach((approachIdx, idx) => {
    const safeIdx = Math.min(Math.max(0, approachIdx), loopLimit - 1);
    const startPoint = coords[safeIdx];
    const endPoint   = coords[(safeIdx + 1) % coords.length];
    const sp = IRC_PARAMS[String(speedLimit)] || IRC_PARAMS['50'];

    let followRoad = null;
    const midPoint = lerp(startPoint, endPoint, 0.5);
    if (roadCollection?.features?.length) {
      const p = turf.point([midPoint.lng, midPoint.lat]);
      let minDist = Infinity;
      roadCollection.features.forEach(f => {
        if (f.properties.isBuilding || f.properties.isObstacle) return;
        const d = turf.pointToLineDistance(p, f, { units: 'meters' });
        if (d < minDist && d < 45) { minDist = d; followRoad = f; }
      });
    }

    if (followRoad) {
      // Upgrade raw OSM segment to high-fidelity Bezier Spline
      let roadLine = followRoad;
      try {
        const cleanCoords = turf.cleanCoords(followRoad);
        roadLine = turf.bezierSpline(cleanCoords, { resolution: 2000, sharpness: 0.65 });
      } catch (e) {
        console.warn("Spline generation failed, falling back to raw vector", e);
      }

      const snappedStart = turf.nearestPointOnLine(roadLine, turf.point([startPoint.lng, startPoint.lat]), { units: 'meters' });
      const startLoc = snappedStart.properties.location;
      const snappedEnd = turf.nearestPointOnLine(roadLine, turf.point([endPoint.lng, endPoint.lat]), { units: 'meters' });
      const endLoc = snappedEnd.properties.location;
      
      const userMultiplier = approachDirections[approachIdx] === -1 ? -1 : 1;
      const upstreamDir = (startLoc > endLoc ? 1 : -1) * userMultiplier;
      
      const lineLen = turf.length(roadLine, { units: 'meters' });

      const placeAlong = (distMeters, type, idSuffix, crossOffset = 0) => {
        const originalTarget = startLoc + (upstreamDir * distMeters);
        const getOffsetPoint = (d) => {
          let pt = turf.along(roadLine, d, { units: 'meters' });
          // Tangent Bearing logic (2m ahead, 2m behind)
          let distBack = Math.max(0, d - 2);
          let distFwd = Math.min(lineLen, d + 2);
          let pBack = turf.along(roadLine, distBack, { units: 'meters' });
          let pFwd = turf.along(roadLine, distFwd, { units: 'meters' });
          let b = turf.bearing(pBack, pFwd);
          if (isNaN(b)) b = 0;
          
          if (crossOffset === 0) return { pt, b };
          let finalPt = turf.destination(pt, crossOffset, b - 90, { units: 'meters' });
          return { pt: finalPt, b };
        };

        let bestFit = null;
        for (let step = 0; step <= 5; step++) {
          let dFwd = Math.max(0, Math.min(lineLen, originalTarget + (step * upstreamDir)));
          let rFwd = getOffsetPoint(dFwd);
          if (!checkCollision(rFwd.pt.geometry.coordinates[0], rFwd.pt.geometry.coordinates[1])) { bestFit = rFwd; break; }
          if (step === 0) continue;
          let dBack = Math.max(0, Math.min(lineLen, originalTarget - (step * upstreamDir)));
          let rBack = getOffsetPoint(dBack);
          if (!checkCollision(rBack.pt.geometry.coordinates[0], rBack.pt.geometry.coordinates[1])) { bestFit = rBack; break; }
        }
        if (!bestFit) return;
        const point = bestFit.pt;
        const rotation = bestFit.b;
        const assetPos = { lat: point.geometry.coordinates[1], lng: point.geometry.coordinates[0] };
        if (haversineDist(assetPos, zoneCentroid) > MAX_PLAN_RADIUS) return;
        assets.push({ id: `auto-${tsBase}-${idSuffix}-${idx}`, type, source: 'auto', lat: assetPos.lat, lng: assetPos.lng, rotation });
      };

      // IRC SEQUENCING (Upstream from boundary)
      const taperCount = Math.max(3, Math.floor(sp.taper / spacingMeters));
      for (let i = 0; i <= taperCount; i++) {
        const tDist = (sp.taper / taperCount) * i;
        const laneOffset = (3.5 / taperCount) * i;
        placeAlong(tDist, 'cone', `taper-${i}`, laneOffset);
      }
      
      placeAlong(sp.taper + 15, 'truck', 'tma', 1.75);           // Buffer Zone Protection
      placeAlong(sp.taper + sp.signMerge, 'sign-merge', 'merge', 3.5); // Mandatory Merge Sign
      placeAlong(sp.taper + sp.signMen, 'sign-menwork', 'men', 3.5);   // Mandatory Men at Work
      placeAlong(sp.taper + sp.signAdv, 'sign-roadwork', 'adv', 3.5);  // Mandatory Road Work Ahead
      
      if (speedLimit >= 80) {
        placeAlong(sp.taper + sp.signAdv + 100, 'sign-slow', 'slow', 3.5);
      }

      // 5. Exit Logic: End Road Work
      const line = isPath ? turf.lineString(coords.map(c => [c.lng, c.lat])) : turf.polygon([ [...coords, coords[0]].map(c => [c.lng, c.lat]) ]);
      const zoneLen = turf.length(line, { units: 'meters' });
      placeAlong(-(zoneLen + 10), 'sign-endwork', 'end', 3.5);
    } else {
      const mToDegLat = 1 / 111320;
      const mToDegLng = 1 / (111320 * Math.cos(startPoint.lat * Math.PI / 180));
      const dy = (startPoint.lat - endPoint.lat) / mToDegLat;
      const dx = (startPoint.lng - endPoint.lng) / mToDegLng;
      const mag = Math.sqrt(dx * dx + dy * dy) || 1;
      
      const userMultiplier = approachDirections[approachIdx] === -1 ? -1 : 1;
      const ux = (dx / mag) * userMultiplier;
      const uy = (dy / mag) * userMultiplier;
      const px = -uy, py = ux;

      const placeFallbackAsset = (dist, type, idSuffix, offset = 3.5) => {
        const rawLat = startPoint.lat + (uy * dist + py * offset) * mToDegLat;
        const rawLng = startPoint.lng + (ux * dist + px * offset) * mToDegLng;
        const snappedPos = trySnap(rawLat, rawLng, 15);
        const finalPos = offsetRoadRight(snappedPos.lat, snappedPos.lng, roadCollection);
        assets.push({ id: `auto-${tsBase}-${idSuffix}-${idx}`, type, source: 'auto', lat: finalPos.lat, lng: finalPos.lng });
      };

      const fallbackTaperCount = Math.max(3, Math.floor(sp.taper / spacingMeters));
      for (let i = 0; i <= fallbackTaperCount; i++) {
        const tDist = (sp.taper / fallbackTaperCount) * i;
        const laneOffset = (3.5 / fallbackTaperCount) * i;
        placeFallbackAsset(tDist, 'cone', `taper-fb-${i}`, laneOffset);
      }
      
      placeFallbackAsset(sp.taper + 15, 'truck', 'tma-fb', 1.75);
      placeFallbackAsset(sp.taper + sp.signMerge, 'sign-merge', 'merge-fb');
      placeFallbackAsset(sp.taper + sp.signMen, 'sign-menwork', 'men-fb');
      placeFallbackAsset(sp.taper + sp.signAdv, 'sign-roadwork', 'adv-fb');
    }
  });
  return assets;
};

export const checkZoneCompliance = (coords, shapeType, speedLimit, roadCollection = null) => {
  const isPath = shapeType === 'polyline';
  const minPts = isPath ? 2 : 3;
  if (!coords || coords.length < minPts) return { isValid: false, msg: `Zone needs at least ${minPts} points.` };
  const line = isPath ? turf.lineString(coords.map(c => [c.lng, c.lat])) : turf.polygon([ [...coords, coords[0]].map(c => [c.lng, c.lat]) ]);
  const perim = turf.length(line, { units: 'meters' });
  const min = ({ '30': 50, '50': 100, '80': 200 })[speedLimit] || 100;

  if (roadCollection?.features?.length) {
    const overlapsObstacle = roadCollection.features.some(f => {
      if (f.properties.isBuilding || f.properties.isObstacle) {
        try { return turf.booleanIntersects(line, f); } catch(e) { return false; }
      }
      return false;
    });
    if (overlapsObstacle) console.warn('Zone overlaps with an object.');
    const testPoint = turf.pointOnFeature(line);
    const [lon, lat] = testPoint.geometry.coordinates;
    const snapped = snapToRoads([lat, lon], roadCollection, 40);
    if (!snapped) console.warn('Zone is off-road. Using geometric fallback.');
  }
  return { isValid: perim >= min, msg: `${isPath ? 'Path' : 'Perimeter'}: ${Math.round(perim)}m (Min: ${min}m)` };
};

const App = () => {
  const {
    isAuthenticated, isLoading, login, logout
  } = useMRAuth();

  // Granular store selectors to prevent the entire Dashboard from re-rendering
  // on every minor state change (like drawPointCount or metadata updates).
  const projectName = useStore(s => s.projectName);
  const permitNumber = useStore(s => s.permitNumber);
  const contractorName = useStore(s => s.contractorName);
  const clientName = useStore(s => s.clientName);
  const startDate = useStore(s => s.startDate);
  const endDate = useStore(s => s.endDate);
  const superintendent = useStore(s => s.superintendent);
  const safetyOfficer = useStore(s => s.safetyOfficer);
  const emergencyContact = useStore(s => s.emergencyContact);

  const zones = useStore(s => s.zones);
  const activeZoneId = useStore(s => s.activeZoneId);
  const activeTool = useStore(s => s.activeTool);
  const isSnapEnabled = useStore(s => s.isSnapEnabled);
  const roadCollection = useStore(s => s.roadCollection);
  const isSidebarOpen = useStore(s => s.isSidebarOpen);
  const showOnboarding = useStore(s => s.showOnboarding);
  const history = useStore(s => s.history);
  const redoStack = useStore(s => s.redoStack);
  const isWazeSync = useStore(s => s.isWazeSync);
  const incidents = useStore(s => s.incidents);

  // Action selectors (these don't trigger re-renders as they are stable)
  const setProjectField = useStore(s => s.setProjectField);
  const setZones = useStore(s => s.setZones);
  const setActiveZoneId = useStore(s => s.setActiveZoneId);
  const getActiveZone = useStore(s => s.getActiveZone);
  const updateActiveZone = useStore(s => s.updateActiveZone);
  const updateZone = useStore(s => s.updateZone);
  const addZone = useStore(s => s.addZone);
  const deleteZone = useStore(s => s.deleteZone);
  const renameZone = useStore(s => s.renameZone);
  const setIsWazeSync = useStore(s => s.setIsWazeSync);
  const setIncidents = useStore(s => s.setIncidents);
  const setIsGenerating = useStore(s => s.setIsGenerating);
  const setGenProgress = useStore(s => s.setGenProgress);
  const setSaveStatus = useStore(s => s.setSaveStatus);
  const setActiveTool = useStore(s => s.setActiveTool);
  const setIsSnapEnabled = useStore(s => s.setIsSnapEnabled);
  const setRoadCollection = useStore(s => s.setRoadCollection);
  const setDrawPointCount = useStore(s => s.setDrawPointCount);
  const pushUndo = useStore(s => s.pushUndo);
  const undo = useStore(s => s.undo);
  const redo = useStore(s => s.redo);
  const setIsSidebarOpen = useStore(s => s.setIsSidebarOpen);
  const setShowOnboarding = useStore(s => s.setShowOnboarding);

  const [toast, setToast] = useState(null);
  const showToast = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); }, []);

  const [showHelp, setShowHelp] = useState(false);
  const [hasOpenedHelp, setHasOpenedHelp] = useState(false);
  const [tipsShown, setTipsShown] = useState({ asset: false, draw: false });

  const toggleHelp = useCallback(() => {
    setShowHelp(v => !v);
    setHasOpenedHelp(true);
  }, []);

  // Contextual Pro-Tips Logic
  useEffect(() => {
    if (activeTool && !tipsShown.asset && !activeTool.startsWith('draw-')) {
      showToast('Tip: Left-click to place, click an asset to remove!');
      setTipsShown(prev => ({ ...prev, asset: true }));
    }
    if (activeTool?.startsWith('draw-') && !tipsShown.draw) {
      showToast('Tip: Ctrl+Z undoes your last point!');
      setTipsShown(prev => ({ ...prev, draw: true }));
    }
  }, [activeTool, tipsShown, showToast]);

  const reportId = useRef(`TMP-${Math.random().toString(36).substr(2, 9).toUpperCase()}`);
  const [planRestoredMsg, setPlanRestoredMsg] = useState(null);

  useEffect(() => {
    if (!isWazeSync) { setIncidents([]); return; }
    const fetchLiveIncidents = async () => {
      const mockIncidents = [
        { id: 'live-1', type: 'ACCIDENT', lat: 28.6130, lng: 77.2085, msg: 'Vehicle Collision' },
        { id: 'live-2', type: 'HAZARD', lat: 28.6155, lng: 77.2100, msg: 'Large Pothole' },
      ];
      setIncidents(mockIncidents);
      showToast('Live Road Data Synced');
    };
    fetchLiveIncidents();
    const interval = setInterval(fetchLiveIncidents, 30000);
    return () => clearInterval(interval);
  }, [isWazeSync, setIncidents, showToast]);

  const [drawSessionKey, setDrawSessionKey] = useState(0);

  const canUndo = history.length > 0;
  const canRedo = redoStack.length > 0;
  const activeZone = getActiveZone();

  // Auto-regenerate active zone assets when properties affecting layout change (if plan has already been generated)
  // Debounced to avoid heavy calculations during vertex dragging.
  useEffect(() => {
    if (!activeZone?.hasGenerated || !activeZone?.coords?.length) return;

    const timer = setTimeout(() => {
      const lWidth = parseFloat(activeZone.laneWidth) || 3.5;
      const autoCones = generatePerimeterAssets(
        activeZone.coords,
        activeZone.shapeType,
        activeZone.approachEdgeIndices || [0],
        CONE_SPACING[activeZone.speedLimit] || 18,
        activeZone.speedLimit,
        roadCollection,
        activeZone.approachEdgeDirections,
        lWidth
      );

      const currentZone = useStore.getState().getActiveZone();
      if (!currentZone) return;

      const existingNonAuto = currentZone.placedAssets?.filter(a => a.source !== 'auto') || [];
      const newPlacedAssets = [...existingNonAuto, ...autoCones];

      const serializeAssets = (arr) => JSON.stringify(arr.map(a => ({ type: a.type, lat: a.lat, lng: a.lng })));
      
      if (serializeAssets(newPlacedAssets) !== serializeAssets(currentZone.placedAssets || [])) {
        updateActiveZone({ placedAssets: newPlacedAssets });
      }
    }, 300);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeZone?.coords,
    activeZone?.shapeType,
    activeZone?.approachEdgeIndices,
    activeZone?.speedLimit,
    roadCollection,
    updateActiveZone
  ]);

  const handleAddZoneClick = useCallback(() => { pushUndo(); addZone(); setActiveTool(null); showToast(`New zone added`); }, [addZone, pushUndo, setActiveTool, showToast]);
  const handleDeleteZoneClick = useCallback((id) => { if (zones.length === 1) return showToast('At least one zone is required'); pushUndo(); deleteZone(id); showToast('Zone deleted'); }, [zones.length, deleteZone, pushUndo, showToast]);

  useEffect(() => {
    const saved = localStorage.getItem('marg_rakshak_v2');
    if (saved) {
      try {
        const d = JSON.parse(saved);
        if (d.zones?.length) { 
          setZones(d.zones); 
          if (d.activeZoneId) setActiveZoneId(d.activeZoneId); 
          else setActiveZoneId(d.zones[0].id);
        }
        if (d.projectName) setProjectField('projectName', d.projectName);
        if (d.permitNumber) setProjectField('permitNumber', d.permitNumber);
        if (d.contractorName) setProjectField('contractorName', d.contractorName);
        if (d.clientName) setProjectField('clientName', d.clientName);
        if (d.startDate) setProjectField('startDate', d.startDate);
        if (d.endDate) setProjectField('endDate', d.endDate);
        if (d.superintendent) setProjectField('superintendent', d.superintendent);
        if (d.safetyOfficer) setProjectField('safetyOfficer', d.safetyOfficer);
        if (d.emergencyContact) setProjectField('emergencyContact', d.emergencyContact);
      } catch { localStorage.removeItem('marg_rakshak_v2'); }
    }
  }, [setZones, setActiveZoneId, setProjectField]);

  useEffect(() => {
    if (!zones.some(z => z.coords.length || z.placedAssets.length)) return;
    setSaveStatus('saving');
    const t = setTimeout(() => {
      const payload = { reportId: reportId.current, zones, activeZoneId, projectName, permitNumber, contractorName, clientName, startDate, endDate, superintendent, safetyOfficer, emergencyContact, isWazeSync };
      localStorage.setItem('marg_rakshak_v2', JSON.stringify(payload));
      setSaveStatus('saved');
    }, 800);
    return () => clearTimeout(t);
  }, [zones, activeZoneId, projectName, permitNumber, contractorName, clientName, startDate, endDate, superintendent, safetyOfficer, emergencyContact, isWazeSync, setSaveStatus]);

  const handleToolSelect = useCallback((tool) => { setActiveTool(tool); if (tool?.startsWith('draw-')) setDrawSessionKey(k => k + 1); }, [setActiveTool]);
  const handleClear = useCallback(() => { if (!activeZone) return; pushUndo(); updateActiveZone({ coords: [], placedAssets: [], hasGenerated: false }); showToast('Zone cleared'); }, [activeZone, pushUndo, updateActiveZone, showToast]);
  const handleAssetRemove = useCallback((id) => { if (!activeZone) return; updateActiveZone({ placedAssets: (activeZone.placedAssets || []).filter(a => a.id !== id) }); }, [activeZone, updateActiveZone]);

  const handleGenerate = useCallback(async () => {
    if (!activeZone?.coords?.length) return showToast('Draw a boundary first');
    const compliance = checkZoneCompliance(activeZone.coords, activeZone.shapeType, activeZone.speedLimit, roadCollection);
    if (!compliance.isValid) return showToast(compliance.msg);
    setIsGenerating(true);
    setGenProgress({ state: 'Analyzing boundary...', percent: 20 });
    
    try {
      let genRoads = roadCollection;
      if (!genRoads || genRoads.features?.length < 5) {
        const centroid = activeZone.coords.reduce((acc, c) => ({ lat: acc.lat + c.lat / activeZone.coords.length, lng: acc.lng + c.lng / activeZone.coords.length }), { lat: 0, lng: 0 });
        // Reduced from 600 to 300 for 4x faster API response
        genRoads = await fetchRoadVectors(centroid.lat, centroid.lng, 300);
      }
      setGenProgress({ state: 'Placing assets...', percent: 70 });
      const lWidth = parseFloat(activeZone.laneWidth) || 3.5;
      const autoCones = generatePerimeterAssets(activeZone.coords, activeZone.shapeType, activeZone.approachEdgeIndices || [0], CONE_SPACING[activeZone.speedLimit] || 18, activeZone.speedLimit, genRoads, activeZone.approachEdgeDirections, lWidth);
      setTimeout(() => {
        pushUndo();
        updateActiveZone({ placedAssets: [...activeZone.placedAssets.filter(a => a.source !== 'auto'), ...autoCones], hasGenerated: true });
        const isRoadAligned = genRoads?.features?.length > 10;
        showToast(isRoadAligned ? `Road-aligned plan generated` : `Geometric fallback plan generated`);
        setIsGenerating(false);
        setGenProgress({ state: '', percent: 0 });
      }, 800);
    } catch (err) {
      console.error("Plan generation failed:", err);
      setIsGenerating(false);
      setGenProgress({ state: '', percent: 0 });
      showToast("Error generating plan. Please try again or draw a simpler zone.");
    }
  }, [activeZone, pushUndo, updateActiveZone, showToast, roadCollection, setIsGenerating, setGenProgress]);

  const handleShapeDrawn = useCallback((coords, type) => {
    const shapeType = ({ polyline: 'polyline', polygon: 'polygon', rectangle: 'rectangle' })[type] || 'polygon';
    updateActiveZone({ coords, shapeType });
    setActiveTool(null); setDrawPointCount(0);
    showToast(`${activeZone?.name || 'Zone'} boundary set`);
  }, [activeZone?.name, updateActiveZone, setActiveTool, setDrawPointCount, showToast]);

  const handleSetPlacedAssets = useCallback((updater) => {
    if (!activeZone) return;
    const currentAssets = activeZone.placedAssets || [];
    const nextAssets = typeof updater === 'function' ? updater(currentAssets) : updater;
    updateActiveZone({ placedAssets: nextAssets });
  }, [activeZone, updateActiveZone]);

  const handleUpdatePointCount = useCallback((count) => setDrawPointCount(count), [setDrawPointCount]);

  if (isLoading) return (
    <div className="login-screen">
      <div className="technical-grid" />
      <div className="login-container" style={{ textAlign: 'center', color: 'white' }}>
        <h1 style={{ fontSize: '1.8rem', fontWeight: 900, marginBottom: '10px', letterSpacing: '-0.02em' }}>MARG RAKSHAK</h1>
        <div className="status-dot pulsed" style={{ margin: '20px auto' }} />
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem', color: '#94a3b8', letterSpacing: '0.15em' }}>
          INITIALIZING SECURE TERMINAL...
        </p>
        <p style={{ marginTop: '40px', fontSize: '0.7rem', opacity: 0.4 }}>
          If this takes more than 5 seconds, check your connection to the Auth server.
        </p>
      </div>
    </div>
  );

  if (!isAuthenticated) return (
    <ErrorBoundary>
      <LoginScreen onLogin={login} />
    </ErrorBoundary>
  );

  return (
    <ErrorBoundary>
      <div className="app-container">
        <div className="toast-container">
          {planRestoredMsg && <div className="toast">{planRestoredMsg}</div>}
          {toast && <div className="toast">{toast}</div>}
        </div>
        <Sidebar
          isOpen={isSidebarOpen} onToggle={() => setIsSidebarOpen(v => !v)}
          reportId={reportId.current} onGenerate={handleGenerate}
        />
        <div className={`map-fullscreen ${activeTool?.startsWith('draw-') ? 'cursor-crosshair' : activeTool ? 'map-asset-pointer' : 'map-grab'}`}>
          <MapArea
            activeTool={activeTool} drawSessionKey={drawSessionKey}
            zones={zones} activeZoneId={activeZoneId}
            isSnapEnabled={isSnapEnabled}
            roadCollection={roadCollection} setRoadCollection={setRoadCollection}
            onSelectZone={setActiveZoneId}
            setActiveTool={setActiveTool}
            updateActiveZone={updateActiveZone}
            updateZone={updateZone}
            setPlacedAssets={handleSetPlacedAssets}
            onAssetRemove={handleAssetRemove}
            onShapeDrawn={handleShapeDrawn}
            onUpdatePointCount={handleUpdatePointCount}
            liveIncidents={incidents}
            showToast={showToast}
          />
        </div>
        <FloatingDock
          onClear={handleClear}
          showToast={showToast}
          onToggleHelp={toggleHelp}
          showHelp={showHelp}
          hasOpenedHelp={hasOpenedHelp}
        />
        {showOnboarding && <OnboardingOverlay onDismiss={() => setShowOnboarding(false)} />}
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      </div>
    </ErrorBoundary>
  );
};

export default App;
