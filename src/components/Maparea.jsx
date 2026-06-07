import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import * as turf from '@turf/turf';
import useStore from '../store/useStore';
import Map, { Layer, Marker, NavigationControl, Source } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Magnet } from 'lucide-react';
import LocationSearch from './LocationSearch';
import { fetchRoadVectors, snapToRoads, getRoadOrientation, findPathInNetwork } from '../utils/geoSnap';
import { createTrafficAssetsLayer, TRAFFIC_THREE_LAYER_ID } from './trafficThreeLayer';

const MAPTILER_KEY = 'cxN8sHcrbJ8xB21xDxDj';
const MAP_STYLES = {
  dark: 'streets-v2-dark',
  satellite: 'satellite',
};

// -- HELPERS --
function lngLat(point) { return [point.lng, point.lat]; }

function rectangleFromPoints(points) {
  if (points.length < 2) return points;
  const p1 = points[0];
  const p2 = points[points.length - 1];
  return [
    p1,
    { lng: p2.lng, lat: p1.lat },
    p2,
    { lng: p1.lng, lat: p2.lat },
    p1
  ];
}

function toolToShapeType(tool) {
  if (tool === 'draw-polygon') return 'polygon';
  if (tool === 'draw-polyline') return 'polyline';
  if (tool === 'draw-rectangle') return 'rectangle';
  return 'polygon';
}

function getLogicalSegments(coords, isPath) {
  const segments = [];
  const numCoords = coords?.length || 0;
  if (numCoords < 2) return segments;

  let currentSubIndices = [];
  let currentPoints = [];

  for (let i = 0; i < numCoords; i++) {
    const pt = coords[i];
    const nextIdx = (i + 1) % numCoords;
    const nextPt = coords[nextIdx];

    if (currentPoints.length === 0) currentPoints.push(pt);
    currentPoints.push(nextPt);
    currentSubIndices.push(i);

    if (!nextPt.isAutoPoint) {
      if (isPath && nextIdx === 0) break;
      segments.push({
        id: currentSubIndices.join(','),
        subIndices: currentSubIndices,
        points: currentPoints
      });
      currentSubIndices = [];
      currentPoints = [];
    }
  }
  return segments;
}

function featureFromCoords(coords, type, cursorPt) {
  const pts = [...coords];
  if (cursorPt) pts.push(cursorPt);
  if (pts.length < 2) return { type: 'FeatureCollection', features: [] };

  if (type === 'polyline') {
    return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map(lngLat) }, properties: {} }] };
  }
  const polyPts = [...pts];
  if (polyPts.length >= 3) polyPts.push(polyPts[0]);
  return { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [polyPts.map(lngLat)] }, properties: {} }] };
}

const MapArea = ({
  onShapeDrawn,
  onUpdatePointCount,
  onSelectZone,
  showToast
}) => {
  const mapRef = useRef(null);
  const trafficLayerRef = useRef(null);
  const trafficDataRef = useRef({ zones: [], activeZoneId: null });
  const requestRef = useRef();

  const zones = useStore(state => state.zones);
  const activeZoneId = useStore(state => state.activeZoneId);
  const activeTool = useStore(state => state.activeTool);
  const setActiveTool = useStore(state => state.setActiveTool);
  const addPlacedAsset = useStore(state => state.addPlacedAsset);
  const pushUndo = useStore(state => state.pushUndo);
  const isSnapEnabled = useStore(state => state.isSnapEnabled);
  const mapStyle = useStore(state => state.mapStyle);
  const setMapStyle = useStore(state => state.setMapStyle);
  const sidebarPhase = useStore(state => state.sidebarPhase);
  const isExporting = useStore(state => state.isExporting);
  const setMapInstance = useStore(state => state.setMapInstance);
  const mapInstance = useStore(state => state.mapInstance);
  const isSimulating = useStore(state => state.isSimulating);
  const setIsSimulating = useStore(state => state.setIsSimulating);
  const setSimProgress = useStore(state => state.setSimProgress);
  const drawSessionKey = useStore(state => state.drawSessionKey);

  const [zoom, setZoom] = useState(16.5);
  const [cursor, setCursor] = useState('grab');
  const [draftCoords, setDraftCoords] = useState([]);
  const draftCoordsRef = useRef([]);
  const snapPromisesRef = useRef([]);
  const [roadCollection, setRoadCollection] = useState(null);
  const lastFetchRef = useRef(null);
  const [firstStyleLayerId, setFirstStyleLayerId] = useState(null);
  const [clickPing, setClickPing] = useState(null);

  const handleMouseEnter = useCallback(() => setCursor('crosshair'), []);
  const handleMouseLeave = useCallback(() => setCursor('grab'), []);

  const storeActiveZoneId = useStore(state => state.activeZoneId);
  const az = useMemo(() => zones.find(z => z.id === activeZoneId), [zones, activeZoneId]);

  const allAssetsGeoJSON = useMemo(() => {
    const features = [];
    zones.forEach(z => {
      (z.placedAssets || []).forEach(a => {
        const char = a.type === 'truck' ? 'T' : a.type === 'cone' ? 'C' : a.type === 'barrier' ? 'B' : 'S';
        const color = a.type === 'truck' ? '#10b981' : a.type === 'cone' ? '#f59e0b' : a.type === 'barrier' ? '#ef4444' : '#0ea5e9';
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [a.lng, a.lat] },
          properties: { label: char, color }
        });
      });
    });
    return { type: 'FeatureCollection', features };
  }, [zones]);

  const calloutGeoJSON = useMemo(() => {
    const features = [];
    zones.forEach(z => {
      const assets = z.placedAssets || [];
      assets.forEach((a, i) => {
        const isCone = a.type === 'cone';
        // CLUTTER REDUCTION: Only label first, last, or every 12th cone
        if (isCone && assets.length > 8 && i !== 0 && i !== assets.length - 1 && i % 12 !== 0) return;

        // STAGGERED LAYOUT: Vary angles to prevent "comb" overlap
        const angles = [-45, -135, 45, 135];
        const angle = angles[i % angles.length] * (Math.PI / 180);
        const dist = isCone ? 0.00018 : 0.00025; // Technical offset
        const labelLng = a.lng + dist * Math.cos(angle);
        const labelLat = a.lat + dist * Math.sin(angle);
        
        // Leader Line
        features.push({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[a.lng, a.lat], [labelLng, labelLat]] },
          properties: { isLine: true }
        });

        // Label
        const typeLabel = a.type.charAt(0).toUpperCase() + a.type.slice(1).replace('sign-', '');
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [labelLng, labelLat] },
          properties: { label: `${typeLabel} #${i+1}`, isText: true }
        });
      });
    });
    return { type: 'FeatureCollection', features };
  }, [zones]);

  const simFrameRef = useRef(null);
  const simStopRequestedRef = useRef(false);

  // ── DRIVE SIMULATION ANIMATION ─────────────────────────────────────────────
  useEffect(() => {
    if (!isSimulating || !mapRef.current) return;
    const map = mapRef.current.getMap();
    
    // Reset control refs
    simStopRequestedRef.current = false;
    if (simFrameRef.current) cancelAnimationFrame(simFrameRef.current);

    const state = useStore.getState();
    const az = state.zones.find(z => z.id === activeZoneId);
    
    if (!az?.coords?.length || az.coords.length < 2) {
      state.setIsSimulating(false);
      return;
    }

    // Synchronous Path Prep
    let spline;
    let totalDist = 0;
    try {
      const rawCoords = az.coords;
      let simPath = [...rawCoords];
      const isPath = az.shapeType === 'polyline';
      
      if (isPath) {
        if ((az.approachEdgeDirections || {})[0] === -1) simPath.reverse();
      } else {
        const startIdx = (az.approachEdgeIndices?.[0]) || 0;
        simPath = [];
        for (let i = 0; i <= rawCoords.length; i++) {
          simPath.push(rawCoords[(startIdx + i) % rawCoords.length]);
        }
        if ((az.approachEdgeDirections || {})[startIdx] === -1) simPath.reverse();
      }

      // ─── PATH EXTENSION ──────────────────────────────────────────────────
      // Extend the path 200m BACKWARDS from the start to catch distant assets
      if (simPath.length >= 2) {
        const p1 = turf.point([simPath[0].lng, simPath[0].lat]);
        const p2 = turf.point([simPath[1].lng, simPath[1].lat]);
        const bearing = turf.bearing(p2, p1); // Reverse direction
        const extendedPt = turf.destination(p1, 0.2, bearing, { units: 'kilometers' });
        simPath.unshift({ lng: extendedPt.geometry.coordinates[0], lat: extendedPt.geometry.coordinates[1] });
      }

      const line = turf.cleanCoords(turf.lineString(simPath.map(p => [p.lng, p.lat])));
      spline = turf.bezierSpline(line, { resolution: 5000, sharpness: 0.65 });
      totalDist = turf.length(spline, { units: 'kilometers' });
    } catch (e) {
      console.error('Path prep failed:', e);
      state.setIsSimulating(false);
      return;
    }

    if (totalDist <= 0 || !isFinite(totalDist)) {
      state.setIsSimulating(false);
      return;
    }

    // Determine Start Offset based on the most UPSTREAM asset
    let startOffset = 0;
    const assets = az.placedAssets || [];
    if (assets.length > 0) {
      try {
        const offsets = assets.map(a => {
          const pt = turf.nearestPointOnLine(spline, turf.point([a.lng, a.lat]), { units: 'kilometers' });
          return pt.properties.location || 0;
        });
        // Find the absolute first asset the driver would see
        const minOffset = Math.min(...offsets);
        // Add a 20m (0.02km) lead-in buffer
        startOffset = Math.max(0, minOffset - 0.02);
        console.log(`[SIM] Extended path: ${totalDist.toFixed(3)}km | Starting at ${startOffset.toFixed(3)}km`);
      } catch (e) {
        console.warn('[SIM] Failed to calculate asset offsets, starting at 0.');
        startOffset = 0;
      }
    }

    // Detect User Interaction
    const onUserInteraction = (e) => {
      // Only stop if the move was explicitly caused by user (originalEvent exists)
      if (e.originalEvent && !simStopRequestedRef.current) {
        console.log('[SIM] Manual interaction detected, releasing camera control.');
        useStore.getState().setIsSimulating(false);
      }
    };
    
    map.on('movestart', onUserInteraction);
    map.on('zoomstart', onUserInteraction);
    map.on('rotatestart', onUserInteraction);

    let accumulatedElapsed = 0;
    let lastBearing = 0;
    let lastTime = null; // Initialize in first frame

    // Initial Jump (accounting for startOffset)
    const startPt = turf.along(spline, startOffset, { units: 'kilometers' }).geometry.coordinates;
    const lookAheadDist = Math.min(totalDist, startOffset + 0.015);
    const targetPt = turf.along(spline, lookAheadDist, { units: 'kilometers' }).geometry.coordinates;
    lastBearing = turf.bearing(turf.point(startPt), turf.point(targetPt));

    console.log(`[SIM] Starting approach sequence at ${startOffset.toFixed(3)}km mark.`);
    map.stop();
    map.jumpTo({ center: [startPt[0], startPt[1]], zoom: 19.5, pitch: 75, bearing: lastBearing });

    const animate = (time) => {
      if (simStopRequestedRef.current) return;
      
      // Initialize timing on first frame
      if (lastTime === null) {
        lastTime = time;
        simFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      const delta = time - lastTime;
      lastTime = time;

      const s = useStore.getState();
      if (!s.isSimulating) { 
        simStopRequestedRef.current = true;
        return; 
      }

      if (!s.simIsPaused) accumulatedElapsed += delta;

      const currentSpeedKph = Number(az.speedLimit || 50) * s.simSpeed;
      const remainingDist = totalDist - startOffset;
      
      // If path is effectively finished or too short, stop
      if (remainingDist <= 0.001) {
        s.setIsSimulating(false);
        s.setSimProgress(0);
        return;
      }

      const durationMs = (remainingDist / (Math.max(1, currentSpeedKph) / 3600)) * 1000;
      
      let progress = accumulatedElapsed / durationMs;
      if (isNaN(progress) || !isFinite(progress)) progress = 0;
      progress = Math.min(progress, 1);
      
      s.setSimProgress(progress);

      const curDist = startOffset + (remainingDist * progress);
      const pos = turf.along(spline, curDist, { units: 'kilometers' }).geometry.coordinates;
      const nextDist = Math.min(totalDist, curDist + 0.012);
      const nextPos = turf.along(spline, nextDist, { units: 'kilometers' }).geometry.coordinates;
      
      let targetBearing = turf.bearing(turf.point(pos), turf.point(nextPos));
      if (isNaN(targetBearing) || !isFinite(targetBearing)) targetBearing = lastBearing;
      
      while (targetBearing - lastBearing > 180) targetBearing -= 360;
      while (targetBearing - lastBearing < -180) targetBearing += 360;
      lastBearing = targetBearing;

      if (!isNaN(pos[0]) && !isNaN(pos[1]) && isFinite(pos[0]) && isFinite(pos[1])) {
        map.jumpTo({ center: [pos[0], pos[1]], bearing: targetBearing, pitch: 75, zoom: 19.8 });
      }
      
      if (progress < 1) {
        simFrameRef.current = requestAnimationFrame(animate);
      } else {
        console.log('[SIM] Sequence complete.');
        s.setIsSimulating(false);
        s.setSimProgress(0);
      }
    };

    simFrameRef.current = requestAnimationFrame(animate);

    return () => { 
      simStopRequestedRef.current = true;
      if (simFrameRef.current) cancelAnimationFrame(simFrameRef.current);
      map.off('movestart', onUserInteraction);
      map.off('zoomstart', onUserInteraction);
      map.off('rotatestart', onUserInteraction);
    };
  }, [isSimulating, activeZoneId]);

  // ── KEYBOARD SHORTCUTS ─────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
      if (cmdOrCtrl && e.key === 'z') {
        e.preventDefault();
        const activeTool = useStore.getState().activeTool;
        if (activeTool?.startsWith('draw-')) window.dispatchEvent(new CustomEvent('trigger-draw-undo'));
        else useStore.getState().undo();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const sid = useStore.getState().selectedAssetId;
        if (sid) {
          const owner = zones.find(z => (z.placedAssets || []).some(a => a.id === sid));
          if (owner) { useStore.getState().pushUndo(); useStore.getState().removePlacedAsset(owner.id, sid); useStore.getState().setSelectedAssetId(null); }
        }
      }
      if (e.key === 'Escape') {
        if (useStore.getState().isSimulating) useStore.getState().setIsSimulating(false);
        else if (useStore.getState().activeTool) { useStore.getState().setActiveTool(null); window.dispatchEvent(new CustomEvent('trigger-draw-cancel')); }
        else { useStore.getState().setActiveZoneId(null); useStore.getState().setSelectedAssetId(null); }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zones]);

  const handleVertexDragEnd = useCallback((zoneId, index, e) => {
    const newCoord = { lng: e.lngLat.lng, lat: e.lngLat.lat };
    const zone = zones.find(z => z.id === zoneId);
    if (!zone) return;
    const pt = zone.coords[index];
    if (pt?.isAutoPoint) return; // Protect auto-generated path points
    const newCoords = [...zone.coords];
    newCoords[index] = { ...newCoord, snapped: pt?.snapped };
    useStore.getState().updateZone(zoneId, { coords: newCoords });
  }, [zones]);

  const handleVertexClick = useCallback((zoneId, index, e) => {
    if (e.originalEvent) e.originalEvent.stopPropagation();
    const zone = zones.find(z => z.id === zoneId);
    if (zone && zone.coords[index]?.isAutoPoint) return; // Ignore clicks on auto-points
    onSelectZone?.(zoneId);
  }, [zones, onSelectZone]);

  const allZonesGeoJSON = useMemo(() => ({
    type: 'FeatureCollection',
    features: zones.map(z => {
      if (!z.coords || z.coords.length < 2) return null;
      const shapeType = z.shapeType || 'polygon';
      const coords = shapeType === 'rectangle' ? rectangleFromPoints(z.coords) : z.coords;
      const isArea = shapeType !== 'polyline';
      const collection = featureFromCoords(coords, isArea ? 'polygon' : 'polyline');
      const feature = collection.features[0];
      return { ...feature, properties: { id: z.id, isActive: z.id === activeZoneId, color: z.color || '#0ea5e9', isArea } };
    }).filter(Boolean)
  }), [zones, activeZoneId]);

  const approachSidesGeoJSON = useMemo(() => {
    const features = [];
    zones.forEach(z => {
      if (!z.coords || z.coords.length < 2 || z.taperDisabled) return;
      const isPath = z.shapeType === 'polyline';
      const numCoords = z.coords.length;
      const loopLimit = isPath ? numCoords - 1 : numCoords;
      const indices = z.approachEdgeIndices || [0];
      indices.forEach(idx => {
        const safeIdx = Math.min(Math.max(0, idx), loopLimit - 1);
        const start = z.coords[safeIdx];
        const end = z.coords[(safeIdx + 1) % numCoords];
        if (start && end) {
          features.push({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[start.lng, start.lat], [end.lng, end.lat]] },
            properties: { zoneId: z.id, color: z.color || '#0ea5e9', isActive: z.id === activeZoneId }
          });
        }
      });
    });
    return { type: 'FeatureCollection', features };
  }, [zones, activeZoneId]);

  const sideLabelsGeoJSON = useMemo(() => {
    if (sidebarPhase !== 2 || !activeZoneId) return { type: 'FeatureCollection', features: [] };
    const az = zones.find(z => z.id === activeZoneId);
    if (!az?.coords?.length) return { type: 'FeatureCollection', features: [] };
    const isPath = az.shapeType === 'polyline';
    const segments = getLogicalSegments(az.coords, isPath);
    const features = [];
    
    segments.forEach((seg, idx) => {
      const line = turf.lineString(seg.points.map(p => [p.lng, p.lat]));
      const len = turf.length(line, { units: 'kilometers' });
      const midPt = turf.along(line, len / 2, { units: 'kilometers' });
      const isActive = seg.subIndices.every(i => az.approachEdgeIndices?.includes(i));
      features.push({ 
        type: 'Feature', 
        geometry: midPt.geometry, 
        properties: { id: seg.id, label: `SIDE ${idx + 1}`, isActive, color: isActive ? '#38bdf8' : '#ffffff' } 
      });
    });
    return { type: 'FeatureCollection', features };
  }, [zones, activeZoneId, sidebarPhase]);

  const approachArrowsGeoJSON = useMemo(() => {
    if (sidebarPhase !== 2 || !activeZoneId) return { type: 'FeatureCollection', features: [] };
    const az = zones.find(z => z.id === activeZoneId);
    if (!az?.coords?.length || !az.approachEdgeIndices?.length) return { type: 'FeatureCollection', features: [] };
    const isPath = az.shapeType === 'polyline';
    const segments = getLogicalSegments(az.coords, isPath);
    const features = [];
    const dirs = az.approachEdgeDirections || {};
    
    segments.forEach(seg => {
      const isActive = seg.subIndices.every(i => az.approachEdgeIndices?.includes(i));
      if (!isActive) return;
      
      const line = turf.lineString(seg.points.map(p => [p.lng, p.lat]));
      const len = turf.length(line, { units: 'kilometers' });
      if (len === 0) return;
      
      const midDist = len / 2;
      const arrowPt = turf.along(line, midDist, { units: 'kilometers' });
      const aheadPt = turf.along(line, Math.min(len, midDist + 0.001), { units: 'kilometers' });
      let bearing = turf.bearing(arrowPt, aheadPt);
      
      const dir = dirs[seg.subIndices[0]];
      let finalBearing = -bearing + 90;
      if (dir === -1) finalBearing += 180;
      
      features.push({ 
        type: 'Feature', 
        geometry: arrowPt.geometry, 
        properties: { id: seg.id, bearing: finalBearing } 
      });
    });
    return { type: 'FeatureCollection', features };
  }, [zones, activeZoneId, sidebarPhase]);

  const draftFeatureStatic = useMemo(() => {
    if (!activeTool?.startsWith('draw-') || draftCoords.length === 0) return { type: 'FeatureCollection', features: [] };
    return featureFromCoords(draftCoords, toolToShapeType(activeTool), null);
  }, [draftCoords, activeTool]);

  const ensureRoadsNear = useCallback(async (lat, lng) => {
    if (!isSnapEnabled) return roadCollection;
    if (roadCollection?.features?.length && lastFetchRef.current) {
      const dist = turf.distance(turf.point([lng, lat]), turf.point([lastFetchRef.current.lng, lastFetchRef.current.lat]), { units: 'meters' });
      if (dist < 400) return roadCollection;
    }
    const roads = await fetchRoadVectors(lat, lng, 600);
    if (roads?.features?.length) { useStore.getState().setRoadCollection(roads); lastFetchRef.current = { lat, lng }; return roads; }
    return roadCollection;
  }, [isSnapEnabled, roadCollection]);

  const maybeSnapPoint = useCallback(async ({ lat, lng }) => {
    if (!isSnapEnabled) return { lat, lng };
    const roads = await ensureRoadsNear(lat, lng);
    const snapped = snapToRoads([lat, lng], roads, 18);
    if (snapped) return { lat: snapped.point[0], lng: snapped.point[1], road: snapped.road, line: snapped.line, location: snapped.location };
    return { lat, lng };
  }, [ensureRoadsNear, isSnapEnabled]);

  const handleMapClick = useCallback(async (e) => {
    if (!activeTool && trafficLayerRef.current?.handleClick?.(e)) return;
    const rawPoint = { lng: e.lngLat.lng, lat: e.lngLat.lat };
    setClickPing(rawPoint);
    setTimeout(() => setClickPing(prev => prev?.lng === rawPoint.lng ? null : prev), 800);
    if (activeTool?.startsWith('draw-')) {
      draftCoordsRef.current = [...draftCoordsRef.current, rawPoint];
      setDraftCoords([...draftCoordsRef.current]);
      onUpdatePointCount?.(draftCoordsRef.current.filter(p => !p.isAutoPoint).length);
      const myPromise = maybeSnapPoint(rawPoint);
      snapPromisesRef.current.push(myPromise);
      if (activeTool === 'draw-rectangle' && draftCoordsRef.current.length === 2) {
        const snappedPoints = await Promise.all(snapPromisesRef.current);
        onShapeDrawn?.(rectangleFromPoints(snappedPoints), 'rectangle');
        draftCoordsRef.current = []; setDraftCoords([]); onUpdatePointCount?.(0);
        setActiveTool?.(null); return;
      }
      const snapped = await myPromise;
      const actualIdx = draftCoordsRef.current.findIndex(p => p.lat === rawPoint.lat && p.lng === rawPoint.lng);
      if (actualIdx !== -1) {
        let insertedPoints = [{ ...snapped, snapped: snapped.lat !== rawPoint.lat }];
        let routeFound = false;
        if (actualIdx > 0 && isSnapEnabled && activeTool !== 'draw-rectangle') {
          const prevPt = draftCoordsRef.current[actualIdx - 1];
          if (prevPt.line && snapped.line && (prevPt.line.properties?.id || prevPt.line.id) === (snapped.line.properties?.id || snapped.line.id)) {
            try {
              const slice = turf.lineSlice(turf.point([prevPt.lng, prevPt.lat]), turf.point([snapped.lng, snapped.lat]), snapped.line);
              const sliceCoords = slice.geometry.coordinates;
              if (sliceCoords.length > 1) {
                const isForward = (snapped.location || 0) >= (prevPt.location || 0);
                const finalCoords = isForward ? sliceCoords : [...sliceCoords].reverse();
                insertedPoints = finalCoords.slice(1).map(c => ({ lat: c[1], lng: c[0], road: snapped.road, line: snapped.line, location: snapped.location, snapped: true, isAutoPoint: true }));
                routeFound = true;
              }
            } catch (_) {}
          }
          if (!routeFound && roadCollection) {
            try {
              const routeCoords = findPathInNetwork([prevPt.lng, prevPt.lat], [snapped.lng, snapped.lat], roadCollection);
              if (routeCoords && routeCoords.length > 1) {
                insertedPoints = routeCoords.slice(1).map(c => ({ lat: c[1], lng: c[0], snapped: true, road: snapped.road, isAutoPoint: true }));
                insertedPoints[insertedPoints.length - 1] = { ...snapped, snapped: true };
                routeFound = true;
              }
            } catch (_) {}
          }
        }
        insertedPoints[insertedPoints.length - 1] = { ...snapped, snapped: true };
        draftCoordsRef.current.splice(actualIdx, 1, ...insertedPoints);
        setDraftCoords([...draftCoordsRef.current]);
        onUpdatePointCount?.(draftCoordsRef.current.filter(p => !p.isAutoPoint).length);
      }
      return;
    }
    if (!activeTool) {
      const clickedArrow = e.features?.find(f => f.layer.id === 'approach-arrows-layer');
      if (clickedArrow) {
        const idStr = clickedArrow.properties.id;
        const clickedIndices = idStr.split(',').map(Number);
        const az = zones.find(z => z.id === activeZoneId);
        if (az) {
          const dirs = { ...(az.approachEdgeDirections || {}) };
          // Read current state from the first index in the segment and flip it
          const currentDir = dirs[clickedIndices[0]] === -1 ? 1 : -1;
          clickedIndices.forEach(idx => { dirs[idx] = currentDir; });
          useStore.getState().updateZone(activeZoneId, { approachEdgeDirections: dirs });
        }
        return;
      }
      const clickedLabel = e.features?.find(f => f.layer.id === 'side-labels-layer');
      if (clickedLabel) {
        const idStr = clickedLabel.properties.id;
        const clickedIndices = idStr.split(',').map(Number);
        const az = zones.find(z => z.id === activeZoneId);
        if (az) {
          const current = az.approachEdgeIndices || [];
          const isSelected = clickedIndices.every(idx => current.includes(idx));
          let newIndices;
          if (isSelected) {
            newIndices = current.filter(idx => !clickedIndices.includes(idx));
          } else {
            newIndices = [...new Set([...current, ...clickedIndices])];
          }
          useStore.getState().updateZone(activeZoneId, { approachEdgeIndices: newIndices, taperDisabled: newIndices.length === 0 });
        }
        return;
      }
      const clicked = e.features?.find(f => f.layer.id === 'zones-line' || f.layer.id === 'zones-fill');
      if (clicked) {
        const zoneId = clicked.properties.id;
        if (zoneId !== activeZoneId) onSelectZone?.(zoneId);
      }
      return;
    }
      const isAssetTool = activeTool && (
        activeTool === 'cone' || 
        activeTool === 'barrier' || 
        activeTool === 'truck' || 
        activeTool === 'light' || 
        activeTool === 'flagger' || 
        activeTool === 'supervisor' || 
        activeTool === 'marshal' || 
        activeTool === 'firstaid' ||
        activeTool.startsWith('sign')
      );
    if (isAssetTool) {
      const targetZoneId = activeZoneId || (zones.length > 0 ? zones[0].id : null);
      if (!targetZoneId) return;
      const snappedData = await maybeSnapPoint(rawPoint);
      const rot = snappedData.road ? getRoadOrientation([snappedData.lat, snappedData.lng], snappedData.road) : 0;
      pushUndo();
      addPlacedAsset(targetZoneId, { id: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type: activeTool, lat: snappedData.lat, lng: snappedData.lng, rotation: rot });
    }
  }, [activeTool, maybeSnapPoint, onSelectZone, addPlacedAsset, pushUndo, zones, activeZoneId, onUpdatePointCount, setActiveTool, onShapeDrawn, roadCollection]);

  const handleMouseMove = useCallback((e) => {
    if (!activeTool?.startsWith('draw-') || !mapRef.current) return;
    const map = mapRef.current.getMap();
    let cursorPt = { lng: e.lngLat.lng, lat: e.lngLat.lat };
    if (isSnapEnabled && roadCollection) {
      const snapped = snapToRoads([cursorPt.lat, cursorPt.lng], roadCollection, 18);
      if (snapped) cursorPt = { lat: snapped.point[0], lng: snapped.point[1] };
    }
    requestRef.current = requestAnimationFrame(() => {
      const draftSource = map.getSource('draft-shape');
      if (draftSource && draftCoordsRef.current.length > 0) draftSource.setData(featureFromCoords(draftCoordsRef.current, toolToShapeType(activeTool), cursorPt));
      map.getSource('cursor-source')?.setData({ type: 'Feature', geometry: { type: 'Point', coordinates: [cursorPt.lng, cursorPt.lat] }, properties: { isAsset: activeTool && !activeTool.startsWith('draw-') } });
    });
  }, [activeTool, isSnapEnabled, roadCollection]);

  const handleLoad = useCallback(() => {
    const map = mapRef.current?.getMap?.();
    if (map) setMapInstance(map);
  }, [setMapInstance]);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current.getMap();
    if (!map) return;
    const reorder = () => {
      try {
        const layerOrder = ['zones-fill', 'zones-line', 'approach-sides-glow', 'approach-sides-dash', 'draft-fill', 'draft-line', 'cursor-layer', TRAFFIC_THREE_LAYER_ID];
        layerOrder.forEach(id => { if (map.getLayer(id)) map.moveLayer(id); });
      } catch (_) { }
    };
    map.on('styledata', reorder);
    return () => map.off('styledata', reorder);
  }, [mapStyle]);

  useEffect(() => {
    const interval = setInterval(() => {
      const map = mapRef.current?.getMap?.();
      if (!map) return;
      clearInterval(interval);
      setMapInstance(map);
      const setup = () => {
        if (trafficLayerRef.current) return;
        trafficLayerRef.current = createTrafficAssetsLayer({ map, onDeleteAsset: (assetId) => { const { zones: sz } = useStore.getState(); const owner = sz.find(z => (z.placedAssets || []).some(a => a.id === assetId)); if (owner) { useStore.getState().pushUndo(); useStore.getState().removePlacedAsset(owner.id, assetId); } } });
        try { if (map.getLayer(TRAFFIC_THREE_LAYER_ID)) map.removeLayer(TRAFFIC_THREE_LAYER_ID); map.addLayer(trafficLayerRef.current); trafficLayerRef.current.setData(trafficDataRef.current); } catch (_) { }
      };
      if (map.loaded() || map.isStyleLoaded()) setup();
      else { map.once('load', setup); map.once('style.load', setup); }
      map.on('style.load', () => { trafficLayerRef.current = null; setup(); });
    }, 100);
    return () => clearInterval(interval);
  }, [setMapInstance]);

  useEffect(() => {
    trafficDataRef.current = { zones, activeZoneId };
    if (trafficLayerRef.current?.setData) trafficLayerRef.current.setData({ zones, activeZoneId });
  }, [zones, activeZoneId]);

  useEffect(() => {
    if (!mapInstance) return;
    const updateFirstLayer = () => { try { const layers = mapInstance.getStyle().layers; if (layers?.length) { const firstSymbol = layers.find(l => l.type === 'symbol'); if (firstSymbol) setFirstStyleLayerId(firstSymbol.id); } } catch (_) { } };
    updateFirstLayer(); mapInstance.on('style.load', updateFirstLayer); mapInstance.on('styledata', updateFirstLayer);
    return () => { mapInstance.off('style.load', updateFirstLayer); mapInstance.off('styledata', updateFirstLayer); };
  }, [mapInstance]);

  useEffect(() => {
    const finish = () => { const shapeType = toolToShapeType(activeTool); const coords = shapeType === 'rectangle' ? rectangleFromPoints(draftCoordsRef.current) : draftCoordsRef.current; onShapeDrawn?.(coords, shapeType); draftCoordsRef.current = []; setDraftCoords([]); onUpdatePointCount?.(0); snapPromisesRef.current = []; };
    const undo = () => { if (draftCoordsRef.current.length === 0) return; draftCoordsRef.current.pop(); while (draftCoordsRef.current.length > 0 && draftCoordsRef.current[draftCoordsRef.current.length - 1].isAutoPoint) draftCoordsRef.current.pop(); setDraftCoords([...draftCoordsRef.current]); onUpdatePointCount?.(Math.max(0, draftCoordsRef.current.filter(p => !p.isAutoPoint).length)); snapPromisesRef.current = snapPromisesRef.current.slice(0, -1); };
    const cancel = () => { draftCoordsRef.current = []; setDraftCoords([]); onUpdatePointCount?.(0); snapPromisesRef.current = []; };
    window.addEventListener('trigger-draw-finish', finish); window.addEventListener('trigger-draw-undo', undo); window.addEventListener('trigger-draw-cancel', cancel);
    return () => { window.removeEventListener('trigger-draw-finish', finish); window.removeEventListener('trigger-draw-undo', undo); window.removeEventListener('trigger-draw-cancel', cancel); };
  }, [activeTool, onShapeDrawn, onUpdatePointCount]);

  useEffect(() => {
    draftCoordsRef.current = []; setDraftCoords([]); onUpdatePointCount?.(0); snapPromisesRef.current = [];
  }, [drawSessionKey, onUpdatePointCount]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', pointerEvents: isExporting ? 'none' : 'auto' }}>
      <Map
        ref={mapRef}
        onLoad={handleLoad}
        initialViewState={{ longitude: 77.209, latitude: 28.6139, zoom: 16.5, pitch: 38, bearing: -12 }}
        mapStyle={`https://api.maptiler.com/maps/${MAP_STYLES[mapStyle]}/style.json?key=${MAPTILER_KEY}`}
        interactiveLayerIds={activeTool ? undefined : ['zones-fill', 'zones-line']}
        onClick={handleMapClick}
        onMouseMove={handleMouseMove}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMove={(evt) => setZoom(evt.viewState.zoom)}
        maxPitch={75}
        preserveDrawingBuffer={true}
        cursor={activeTool ? 'crosshair' : cursor}
        canvasContextAttributes={{ antialias: true }}
      >
        <NavigationControl position="bottom-right" visualizePitch />
        <Source id="buildings-source" type="vector" url={`https://api.maptiler.com/tiles/v3/tiles.json?key=${MAPTILER_KEY}`} />
        {mapStyle === 'satellite' && (
          <Source id="esri-world-imagery" type="raster" tiles={['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}']} tileSize={256} minzoom={1} maxzoom={19} attribution="Esri">
            <Layer id="esri-world-imagery-layer" type="raster" beforeId={firstStyleLayerId} />
          </Source>
        )}
        {mapStyle === 'satellite' && <Layer id="satellite-roads" source-layer="transportation" source="buildings-source" type="line" paint={{ 'line-color': '#ffffff', 'line-opacity': 0.25, 'line-width': 1.2 }} />}
        <Layer id="3d-buildings" source="buildings-source" source-layer="building" type="fill-extrusion" minzoom={14} paint={{ 'fill-extrusion-height': ['get', 'render_height'], 'fill-extrusion-base': ['get', 'render_min_height'], 'fill-extrusion-color': '#0ea5e9', 'fill-extrusion-opacity': 0.5 }} />
        <LocationSearch />
        {isSnapEnabled && <div className="snap-indicator-badge"><div className="snap-indicator-content"><span className="snap-indicator-title"><Magnet size={14} /> Snap to Road Active</span><span className="snap-indicator-text">Your clicks will align to street geometry</span></div></div>}
        <Source id="all-zones" type="geojson" data={allZonesGeoJSON}>
          <Layer id="zones-fill" type="fill" filter={['==', ['get', 'isArea'], true]} paint={{ 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['boolean', ['get', 'isActive'], false], 0.35, 0.15] }} />
          <Layer id="zones-line" type="line" paint={{ 'line-color': ['get', 'color'], 'line-width': ['case', ['boolean', ['get', 'isActive'], false], 5, 3] }} />
        </Source>
        <Source id="approach-sides" type="geojson" data={approachSidesGeoJSON}>
          <Layer id="approach-sides-glow" type="line" paint={{ 'line-color': ['get', 'color'], 'line-width': ['case', ['boolean', ['get', 'isActive'], false], 8, 4], 'line-opacity': 0.8 }} />
          <Layer id="approach-sides-dash" type="line" paint={{ 'line-color': '#ffffff', 'line-width': ['case', ['boolean', ['get', 'isActive'], false], 3, 1.5], 'line-dasharray': [3, 3] }} />
        </Source>
        <Source id="side-labels" type="geojson" data={sideLabelsGeoJSON}><Layer id="side-labels-layer" type="symbol" layout={{ 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-letter-spacing': 0.1, 'text-allow-overlap': true, 'text-ignore-placement': true }} paint={{ 'text-color': ['get', 'color'], 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 2.5 }} /></Source>
        <Source id="approach-arrows" type="geojson" data={approachArrowsGeoJSON}><Layer id="approach-arrows-layer" type="symbol" layout={{ 'text-field': '↓', 'text-size': 22, 'text-font': ['Noto Sans Bold'], 'text-rotate': ['get', 'bearing'], 'text-allow-overlap': true, 'text-ignore-placement': true }} paint={{ 'text-color': '#38bdf8', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5, 'text-opacity': 0.9 }} /></Source>
        
        <Source id="high-visibility-assets" type="geojson" data={allAssetsGeoJSON}>
          <Layer 
            id="high-visibility-assets-layer" 
            type="symbol" 
            layout={{ 
              'visibility': isExporting ? 'visible' : 'none',
              'text-field': ['get', 'label'],
              'text-font': ['Noto Sans Bold'],
              'text-size': 18,
              'text-allow-overlap': true,
              'text-ignore-placement': true
            }} 
            paint={{ 
              'text-color': ['get', 'color'],
              'text-halo-color': '#ffffff',
              'text-halo-width': 3
            }} 
          />
        </Source>

        <Source id="callouts-source" type="geojson" data={calloutGeoJSON}>
          <Layer 
            id="callouts-lines" 
            type="line" 
            filter={['==', ['get', 'isLine'], true]}
            layout={{ 'visibility': isExporting ? 'visible' : 'none' }}
            paint={{ 'line-color': '#ffffff', 'line-width': 1.5, 'line-opacity': 0.8 }} 
          />
          <Layer 
            id="callouts-text" 
            type="symbol" 
            filter={['==', ['get', 'isText'], true]}
            layout={{ 
              'visibility': isExporting ? 'visible' : 'none',
              'text-field': ['get', 'label'],
              'text-font': ['Noto Sans Bold'],
              'text-size': 10,
              'text-allow-overlap': true,
              'text-ignore-placement': true
            }} 
            paint={{ 
              'text-color': '#ffffff',
              'text-halo-color': 'rgba(0,0,0,0.8)',
              'text-halo-width': 2
            }} 
          />
        </Source>

        <Source id="draft-shape" type="geojson" data={draftFeatureStatic}><Layer id="draft-fill" type="fill" filter={['==', ['geometry-type'], 'Polygon']} paint={{ 'fill-color': isSnapEnabled ? '#10b981' : '#38bdf8', 'fill-opacity': 0.3 }} /><Layer id="draft-line" type="line" paint={{ 'line-color': isSnapEnabled ? '#10b981' : '#38bdf8', 'line-width': 4 }} /></Source>
        <Source id="cursor-source" type="geojson" data={{ type: 'FeatureCollection', features: [] }}><Layer id="cursor-layer-icon" type="symbol" layout={{ 'text-field': ['case', ['boolean', ['get', 'isAsset'], false], '○', '+'], 'text-size': ['case', ['boolean', ['get', 'isAsset'], false], 32, 24], 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true, 'text-ignore-placement': true }} paint={{ 'text-color': ['case', ['boolean', ['get', 'isAsset'], false], '#ffffff', '#10b981'], 'text-halo-color': ['case', ['boolean', ['get', 'isAsset'], false], '#0ea5e9', '#fff'], 'text-halo-width': 2 }} /></Source>
        {clickPing && <Marker longitude={clickPing.lng} latitude={clickPing.lat} anchor="center"><div className="click-ping" /></Marker>}
        <Layer id="place-labels" source="buildings-source" source-layer="place" type="symbol" layout={{ 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Bold'], 'text-size': 14, 'text-transform': 'uppercase' }} paint={{ 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.8)', 'text-halo-width': 2 }} />
        <Layer id="street-labels" source="buildings-source" source-layer="transportation_name" type="symbol" layout={{ 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'symbol-placement': 'line' }} paint={{ 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.8)', 'text-halo-width': 2 }} />
        {zoom >= 14 && zones.flatMap((z) => {
          let controlIdx = 0;
          return (z.coords || []).map((pt, i) => {
            const isAuto = pt.isAutoPoint; if (!isAuto) controlIdx++; if (isAuto && z.id !== activeZoneId) return null;
            const size = isAuto ? '6px' : (z.id === activeZoneId ? '18px' : '12px'), borderW = isAuto ? '2px' : '3px', content = (!isAuto && z.id === activeZoneId) ? controlIdx : '';
            return <Marker key={`${z.id}-v-${i}`} longitude={pt.lng} latitude={pt.lat} anchor="center" draggable={z.id === activeZoneId} onDrag={(e) => handleVertexDragEnd(z.id, i, e)} onDragEnd={(e) => handleVertexDragEnd(z.id, i, e)} onClick={(e) => handleVertexClick(z.id, e)}><div className={`vertex-marker ${z.id === activeZoneId ? 'active' : 'dormant'}`} style={{ width: size, height: size, background: z.id === activeZoneId ? '#fff' : (z.color || '#0ea5e9'), border: `${borderW} solid ${z.color || '#0ea5e9'}`, borderRadius: '50%', boxShadow: z.id === activeZoneId && !isAuto ? '0 0 10px rgba(0,0,0,0.4)' : '0 2px 4px rgba(0,0,0,0.3)', cursor: z.id === activeZoneId ? 'move' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: z.color || '#0ea5e9', fontWeight: '900', transition: 'all 0.15s ease' }}>{content}</div></Marker>;
          }).filter(Boolean);
        })}
        {(() => {
          let cIdx = 0;
          return draftCoords.map((pt, i) => {
            const isAuto = pt.isAutoPoint; if (!isAuto) cIdx++;
            const size = isAuto ? '6px' : '18px', borderW = isAuto ? '2px' : '3px', content = isAuto ? '' : cIdx;
            return <Marker key={`draft-v-${i}`} longitude={pt.lng} latitude={pt.lat} anchor="center"><div className="vertex-marker active" style={{ width: size, height: size, background: '#fff', border: `${borderW} solid #38bdf8`, borderRadius: '50%', boxShadow: isAuto ? 'none' : '0 0 10px rgba(56, 189, 248, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#38bdf8', fontWeight: '900' }}>{content}</div></Marker>;
          });
        })()}
      </Map>
      <div className="map-style-toggle">
        <button onClick={() => setMapStyle('dark')} className={mapStyle === 'dark' ? 'active' : ''}>Dark</button>
        <button onClick={() => setMapStyle('satellite')} className={mapStyle === 'satellite' ? 'active' : ''}>Satellite HD</button>
      </div>
    </div>
  );
};
export default memo(MapArea);
