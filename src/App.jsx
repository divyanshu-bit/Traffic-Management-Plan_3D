import React, { useState, useRef, useCallback, useEffect, Component } from 'react';
import * as turf from '@turf/turf';

import './App.css';
import useStore from './store/useStore';

import MapArea from './components/Maparea';
import Sidebar from './components/Sidebar';
import FloatingDock from './components/FloatingDock';

const MemoizedMapArea = React.memo(MapArea);
const MemoizedSidebar = React.memo(Sidebar);
const MemoizedFloatingDock = React.memo(FloatingDock);
import OnboardingOverlay from './components/OnboardingOverlay';
import { snapToRoads, fetchRoadVectors } from './utils/geoSnap';

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

export const generatePerimeterAssets = (coords, shapeType = 'polygon', approachIndices = [0], spacingMeters = 18, speedLimit = 50, roadCollection = null) => {
  const minPts = shapeType === 'polyline' ? 2 : 3;
  if (!coords || coords.length < minPts) return [];
  const assets = [];
  const tsBase = Date.now();
  const lerp = (s, e, t) => ({ lat: s.lat + (e.lat - s.lat) * t, lng: s.lng + (e.lng - s.lng) * t });
  const isPath = shapeType === 'polyline';
  const loopLimit = isPath ? coords.length - 1 : coords.length;

  const trySnap = (lat, lng, radius = 12) => {
    if (!roadCollection || !roadCollection.features?.length) return { lat, lng };
    const snapped = snapToRoads([lat, lng], roadCollection, radius);
    return snapped ? { lat: snapped[0], lng: snapped[1] } : { lat, lng };
  };

  const offsetRoadRight = (snappedLat, snappedLng, roadCollection) => {
    if (!roadCollection?.features?.length) return { lat: snappedLat, lng: snappedLng };
    const point = turf.point([snappedLng, snappedLat]);
    let bestRoad = null, minDist = Infinity;
    
    roadCollection.features.forEach(road => {
      if (road.properties.isBuilding || road.properties.isObstacle) return;
      if (road.geometry.type !== 'LineString' && road.geometry.type !== 'MultiLineString') return;
      
      const snappedOnRoad = turf.nearestPointOnLine(road, point);
      if (snappedOnRoad.properties.dist < minDist) {
        minDist = snappedOnRoad.properties.dist;
        bestRoad = road;
      }
    });

    if (!bestRoad) return { lat: snappedLat, lng: snappedLng };

    try {
      const snappedOnBest = turf.nearestPointOnLine(bestRoad, point);
      const startLoc = snappedOnBest.properties.location || 0;
      const lineLen = turf.length(bestRoad, { units: 'meters' });
      
      const aheadDist = Math.min(lineLen, startLoc + 1);
      const aheadPoint = turf.along(bestRoad, aheadDist, { units: 'meters' });
      const refPoint = (aheadDist <= startLoc) 
        ? turf.along(bestRoad, Math.max(0, startLoc - 1), { units: 'meters' })
        : snappedOnBest;
      const targetPoint = (aheadDist <= startLoc) ? snappedOnBest : aheadPoint;
      
      let bearing = turf.bearing(refPoint, targetPoint);
      if (isNaN(bearing) || (refPoint.geometry.coordinates[0] === targetPoint.geometry.coordinates[0] && refPoint.geometry.coordinates[1] === targetPoint.geometry.coordinates[1])) {
        bearing = 0;
      }
      const offsetPos = turf.destination(snappedOnBest, 3.5, bearing - 90, { units: 'meters' });
      return { lat: offsetPos.geometry.coordinates[1], lng: offsetPos.geometry.coordinates[0] };
    } catch (e) {
      console.warn("Offset calculation failed, using raw snapped position", e);
      return { lat: snappedLat, lng: snappedLng };
    }
  };

  const checkCollision = (lng, lat) => {
    if (!roadCollection?.features?.length) return false;
    const pt = turf.point([lng, lat]);
    const hitbox = turf.buffer(pt, 1, { units: 'meters' });
    return roadCollection.features.some(f => {
      if (f.properties.isBuilding || f.properties.isObstacle) {
        try {
          return turf.booleanIntersects(hitbox, f);
        } catch(e) { return false; }
      }
      return false;
    });
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

  for (let i = 0; i < loopLimit; i++) {
    if (approachIndices.includes(i)) continue;
    const start = coords[i], end = coords[(i + 1) % coords.length];
    const dist = haversineDist(start, end);
    const count = Math.max(1, Math.ceil(dist / spacingMeters));
    for (let j = 0; j < count; j++) {
      const t = j / count;
      let finalPos = findClearPosLine(start, end, t, 3);
      if (!finalPos) continue;
      try {
        if (roadCollection?.features?.length) {
          const snapped = snapToRoads([finalPos.lat, finalPos.lng], roadCollection, 5); 
          if (snapped && !checkCollision(snapped[1], snapped[0])) {
            finalPos = { lat: snapped[0], lng: snapped[1] };
          }
        }
      } catch (err) {}
      assets.push({ 
        id: `auto-${tsBase}-${i}-${j}`, 
        type: 'cone', source: 'auto', 
        lat: finalPos.lat, lng: finalPos.lng 
      });
    }
  }

  const zoneCentroid = coords.reduce((acc, c) => ({ lat: acc.lat + c.lat/coords.length, lng: acc.lng + c.lng/coords.length }), {lat:0, lng:0});
  const MAX_PLAN_RADIUS = 500;

  approachIndices.forEach((approachIdx, idx) => {
    const safeIdx = Math.min(Math.max(0, approachIdx), loopLimit - 1);
    const startPoint = coords[safeIdx];
    const endPoint   = coords[(safeIdx + 1) % coords.length];
    const params = { '30': { taper: 15, adv: 50 }, '50': { taper: 40, adv: 100 }, '80': { taper: 107, adv: 200 } };
    const sp = params[String(speedLimit)] || params['50'];

    let followRoad = null;
    if (roadCollection?.features?.length) {
      const p = turf.point([startPoint.lng, startPoint.lat]);
      let minDist = Infinity;
      roadCollection.features.forEach(f => {
        if (f.properties.isBuilding || f.properties.isObstacle) return;
        const d = turf.pointToLineDistance(p, f, { units: 'meters' });
        if (d < minDist && d < 45) { minDist = d; followRoad = f; }
      });
    }

    if (followRoad) {
      const roadLine = followRoad;
      const snappedStart = turf.nearestPointOnLine(roadLine, turf.point([startPoint.lng, startPoint.lat]), { units: 'meters' });
      const startLoc = snappedStart.properties.location;
      const snappedEnd = turf.nearestPointOnLine(roadLine, turf.point([endPoint.lng, endPoint.lat]), { units: 'meters' });
      const endLoc = snappedEnd.properties.location;
      const upstreamDir = startLoc > endLoc ? 1 : -1;
      const lineLen = turf.length(roadLine, { units: 'meters' });

      const placeAlong = (distMeters, type, idSuffix, crossOffset = 0) => {
        const originalTarget = startLoc + (upstreamDir * distMeters);
        const getOffsetPoint = (d) => {
          let pt = turf.along(roadLine, d, { units: 'meters' });
          if (crossOffset === 0) return { pt, b: 0 };
          let pAhead = (d + 1 <= lineLen) ? turf.along(roadLine, d + 1, { units: 'meters' }) : pt;
          let b = turf.bearing(pt, pAhead);
          if (isNaN(b)) b = 0;
          let finalPt = turf.destination(turf.along(roadLine, d, { units: 'meters' }), crossOffset, b - 90, { units: 'meters' });
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
        const assetPos = { lat: point.geometry.coordinates[1], lng: point.geometry.coordinates[0] };
        if (haversineDist(assetPos, zoneCentroid) > MAX_PLAN_RADIUS) return;
        assets.push({ id: `auto-${tsBase}-${idSuffix}-${idx}`, type, source: 'auto', lat: assetPos.lat, lng: assetPos.lng });
      };

      const taperCount = Math.max(3, Math.floor(sp.taper / spacingMeters));
      for (let i = 1; i <= taperCount; i++) {
        const tDist = (sp.taper / taperCount) * i;
        const laneOffset = (3.5 / taperCount) * i;
        placeAlong(tDist, 'cone', `taper-${i}`, laneOffset);
      }
      placeAlong(sp.adv, 'sign-roadwork', 'adv', 3.5);
      placeAlong(15, 'truck', 'tma', 2.0);
    } else {
      const mToDegLat = 1 / 111320;
      const mToDegLng = 1 / (111320 * Math.cos(startPoint.lat * Math.PI / 180));
      const dy = (startPoint.lat - endPoint.lat) / mToDegLat;
      const dx = (startPoint.lng - endPoint.lng) / mToDegLng;
      const mag = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / mag, uy = dy / mag;
      const px = -uy, py = ux;

      const taperCount = Math.max(3, Math.floor(sp.taper / spacingMeters));
      for (let i = 1; i <= taperCount; i++) {
        const tDist = (sp.taper / taperCount) * i;
        const offset = (3.5 / taperCount) * i;
        const rawLat = startPoint.lat + (uy * tDist + py * offset) * mToDegLat;
        const rawLng = startPoint.lng + (ux * tDist + px * offset) * mToDegLng;
        const snappedPos = trySnap(rawLat, rawLng, 15);
        const finalPos = offsetRoadRight(snappedPos.lat, snappedPos.lng, roadCollection);
        assets.push({ id: `auto-${tsBase}-taper-fb-${idx}-${i}`, type: 'cone', source: 'auto', lat: finalPos.lat, lng: finalPos.lng });
      }
      const advLat = startPoint.lat + (uy * sp.adv) * mToDegLat;
      const advLng = startPoint.lng + (ux * sp.adv) * mToDegLng;
      const advSnapped = trySnap(advLat, advLng, 15);
      const advFinal = offsetRoadRight(advSnapped.lat, advSnapped.lng, roadCollection);
      assets.push({ id: `auto-${tsBase}-adv-fb-${idx}`, type: 'sign-roadwork', source: 'auto', lat: advFinal.lat, lng: advFinal.lng });
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

let _zoneSeq = 1;
export const makeZone = (index = 0) => ({
  id: `zone-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  name: `Zone ${_zoneSeq++}`,
  color: ZONE_COLORS[index % ZONE_COLORS.length],
  coords: [], shapeType: 'polygon', approachEdgeIndices: [0], placedAssets: [], hasGenerated: false,
  speedLimit: '50', workZoneSpeed: '30', laneCount: '2', laneWidth: '3.5',
  surfaceType: 'Asphalt', gradient: '0–3%', closureType: 'Lane', roadLevel: 'Level 2',
});

const App = () => {
  const {
    isAuthenticated, setIsAuthenticated, isLoading, setIsLoading,
    projectName, permitNumber, contractorName, clientName,
    startDate, endDate, superintendent, safetyOfficer, emergencyContact,
    setProjectField,
    zones, setZones, activeZoneId, setActiveZoneId, getActiveZone,
    updateActiveZone, addZone, deleteZone, renameZone,
    isWazeSync, setIsWazeSync, incidents, setIncidents,
    isGenerating, setIsGenerating, genProgress, setGenProgress,
    saveStatus, setSaveStatus,
    activeTool, setActiveTool, isSnapEnabled, setIsSnapEnabled,
    roadCollection, setRoadCollection,
    drawPointCount, setDrawPointCount,
    history, redoStack, pushUndo, undo, redo,
    isSidebarOpen, setIsSidebarOpen,
    showOnboarding, setShowOnboarding
  } = useStore();

  const loginWithRedirect = () => { setIsLoading(true); setTimeout(() => { setIsAuthenticated(true); setIsLoading(false); }, 1000); };
  const logout = () => { setIsAuthenticated(false); };

  const [toast, setToast] = useState(null);
  const showToast = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(null), 3000); }, []);

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

  const handleAddZoneClick = useCallback(() => { pushUndo(); addZone(); setActiveTool(null); showToast(`New zone added`); }, [addZone, pushUndo, setActiveTool, showToast]);
  const handleDeleteZoneClick = useCallback((id) => { if (zones.length === 1) return showToast('At least one zone is required'); pushUndo(); deleteZone(id); showToast('Zone deleted'); }, [zones.length, deleteZone, pushUndo, showToast]);

  useEffect(() => {
    const saved = localStorage.getItem('marg_rakshak_v2');
    if (saved) {
      try {
        const d = JSON.parse(saved);
        if (d.zones?.length) { setZones(d.zones); if (d.activeZoneId) setActiveZoneId(d.activeZoneId); }
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
  const handleAssetRemove = useCallback((id) => { updateActiveZone({ placedAssets: activeZone.placedAssets.filter(a => a.id !== id) }); }, [activeZone?.placedAssets, updateActiveZone]);

  const handleGenerate = useCallback(async () => {
    if (!activeZone?.coords?.length) return showToast('Draw a boundary first');
    const compliance = checkZoneCompliance(activeZone.coords, activeZone.shapeType, activeZone.speedLimit, roadCollection);
    if (!compliance.isValid) return showToast(compliance.msg);
    setIsGenerating(true);
    setGenProgress({ state: 'Analyzing boundary...', percent: 20 });
    let genRoads = roadCollection;
    if (!genRoads || genRoads.features?.length < 5) {
      const centroid = activeZone.coords.reduce((acc, c) => ({ lat: acc.lat + c.lat / activeZone.coords.length, lng: acc.lng + c.lng / activeZone.coords.length }), { lat: 0, lng: 0 });
      genRoads = await fetchRoadVectors(centroid.lat, centroid.lng, 2000);
    }
    setGenProgress({ state: 'Placing assets...', percent: 70 });
    const autoCones = generatePerimeterAssets(activeZone.coords, activeZone.shapeType, activeZone.approachEdgeIndices || [0], CONE_SPACING[activeZone.speedLimit] || 18, activeZone.speedLimit, genRoads);
    setTimeout(() => {
      pushUndo();
      updateActiveZone({ placedAssets: [...activeZone.placedAssets.filter(a => a.source !== 'auto'), ...autoCones], hasGenerated: true });
      const isRoadAligned = genRoads?.features?.length > 10;
      showToast(isRoadAligned ? `Road-aligned plan generated` : `Geometric fallback plan generated`);
      setIsGenerating(false);
      setGenProgress({ state: '', percent: 0 });
    }, 800);
  }, [activeZone, pushUndo, updateActiveZone, showToast, roadCollection, setIsGenerating, setGenProgress]);

  const handleShapeDrawn = useCallback((coords, type) => {
    const shapeType = ({ polyline: 'polyline', polygon: 'polygon', rectangle: 'rectangle' })[type] || 'polygon';
    updateActiveZone({ coords, shapeType });
    setActiveTool(null); setDrawPointCount(0);
    showToast(`${activeZone?.name || 'Zone'} boundary set`);
  }, [activeZone?.name, updateActiveZone, setActiveTool, setDrawPointCount, showToast]);

  const handleSetPlacedAssets = useCallback((updater) => {
    const currentAssets = activeZone.placedAssets;
    const nextAssets = typeof updater === 'function' ? updater(currentAssets) : updater;
    updateActiveZone({ placedAssets: nextAssets });
  }, [activeZone.placedAssets, updateActiveZone]);

  const handleUpdatePointCount = useCallback((count) => setDrawPointCount(count), [setDrawPointCount]);

  if (isLoading) return <div className="login-screen"><div className="technical-grid" /><div className="loading-container">INITIALIZING...</div></div>;

  if (!isAuthenticated) return (
    <div className="login-screen">
      <div className="technical-grid" />
      <div className="login-container">
        <div className="login-card">
          <h1>Marg <span style={{color: '#0ea5e9'}}>Rakshak</span></h1>
          <p>Traffic Management & Disaster Response</p>
          <button className="technical-btn" onClick={loginWithRedirect} style={{marginTop: 40, width: '100%', padding: 15, background: '#0ea5e9', border: 'none', borderRadius: 8, color: '#000', fontWeight: 800, cursor: 'pointer'}}>
            Log In
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="app-container">
      <div className="toast-container">
        {planRestoredMsg && <div className="toast">{planRestoredMsg}</div>}
        {toast && <div className="toast">{toast}</div>}
      </div>
      <MemoizedSidebar
        isOpen={isSidebarOpen} onToggle={() => setIsSidebarOpen(v => !v)}
        reportId={reportId.current} onGenerate={handleGenerate}
      />
      <div className={`map-fullscreen ${activeTool?.startsWith('draw-') ? 'cursor-crosshair' : activeTool ? 'map-asset-pointer' : 'map-grab'}`}>
        <ErrorBoundary>
          <MemoizedMapArea
            activeTool={activeTool} drawSessionKey={drawSessionKey}
            zones={zones} activeZoneId={activeZoneId}
            isSnapEnabled={isSnapEnabled}
            roadCollection={roadCollection} setRoadCollection={setRoadCollection}
            onSelectZone={setActiveZoneId}
            updateActiveZone={updateActiveZone}
            setPlacedAssets={handleSetPlacedAssets}
            onAssetRemove={handleAssetRemove}
            onShapeDrawn={handleShapeDrawn}
            onUpdatePointCount={handleUpdatePointCount}
            liveIncidents={incidents}
            showToast={showToast}
          />
        </ErrorBoundary>
      </div>
      <MemoizedFloatingDock
        onClear={handleClear}
        showToast={showToast}
      />
      {showOnboarding && <OnboardingOverlay onDismiss={() => setShowOnboarding(false)} />}
    </div>
  );
};

export default App;
