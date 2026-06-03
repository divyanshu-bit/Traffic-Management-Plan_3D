import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import * as turf from '@turf/turf';
import useStore from '../store/useStore';
import Map, { Layer, Marker, NavigationControl, Source } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Magnet } from 'lucide-react';
import LocationSearch from './LocationSearch';
import { fetchRoadVectors, snapToRoads, getRoadOrientation } from '../utils/geoSnap';
import { createTrafficAssetsLayer, TRAFFIC_THREE_LAYER_ID } from './trafficThreeLayer';

const MAPTILER_KEY = 'cxN8sHcrbJ8xB21xDxDj';
const MAP_STYLES = {
  dark: 'streets-v2-dark',
  satellite: 'streets-v2-dark', 
};

// -- HELPERS --
function lngLat(point) { return [point.lng, point.lat]; }

function rectangleFromPoints(points) {
  if (points.length !== 2) return points;
  const [p1, p2] = points;
  return [
    p1,
    { lng: p2.lng, lat: p1.lat },
    p2,
    { lng: p1.lng, lat: p2.lat }
  ];
}



function featureFromCoords(coords, shapeType, cursor = null) {
  const display = cursor ? [...coords, cursor] : coords;
  if (display.length === 0) return { type: 'FeatureCollection', features: [] };

  let feature;
  if (shapeType === 'rectangle' && display.length >= 2) {
    const rect = rectangleFromPoints(display.slice(0, 2));
    feature = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...rect.map(lngLat), lngLat(rect[0])]] } };
  } else if (shapeType === 'polygon' && display.length >= 3) {
    feature = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...display.map(lngLat), lngLat(display[0])]] } };
  } else if (display.length >= 2) {
    feature = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: display.map(lngLat) } };
  } else {
    feature = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: lngLat(display[0]) } };
  }

  return { type: 'FeatureCollection', features: [feature] };
}

function toolToShapeType(tool) {
  if (tool === 'draw-polyline') return 'polyline';
  if (tool === 'draw-rectangle') return 'rectangle';
  return 'polygon';
}

const MapArea = ({
  activeTool, drawSessionKey, zones = [], activeZoneId, onSelectZone, isSnapEnabled,
  roadCollection, setRoadCollection, setPlacedAssets, onAssetRemove,
  onShapeDrawn, onUpdatePointCount, liveIncidents = [], showToast,
  updateZone, setActiveTool 
}) => {
  const isExporting = useStore(state => state.isExporting);
  const setMapInstance = useStore(state => state.setMapInstance);
  const mapInstance = useStore(state => state.mapInstance);
  const mapStyle = useStore(state => state.mapStyle);
  const setMapStyle = useStore(state => state.setMapStyle);

  const mapRef = useRef(null);
  const [draftCoords, setDraftCoords] = useState([]);
  const [firstStyleLayerId, setFirstStyleLayerId] = useState(undefined);
  const [clickPing, setClickPing] = useState(null); 
  const [zoom, setZoom] = useState(16.5);
  const [cursor, setCursor] = useState('auto');

  const handleMouseEnter = useCallback(() => {
    setCursor('pointer');
  }, []);

  const handleMouseLeave = useCallback(() => {
    setCursor('auto');
  }, []);

  const draftCoordsRef = useRef([]);
  const lastFetchRef = useRef(null);
  const snapPromisesRef = useRef([]);
  const requestRef = useRef();
  const trafficLayerRef = useRef(null);
  const trafficDataRef = useRef({ zones, activeZoneId });
  const onAssetRemoveRef = useRef(onAssetRemove);

  useEffect(() => {
    onAssetRemoveRef.current = onAssetRemove;
  }, [onAssetRemove]);

  const handleVertexDragEnd = useCallback((zoneId, index, e) => {
    const newCoord = { lng: e.lngLat.lng, lat: e.lngLat.lat };
    const zone = zones.find(z => z.id === zoneId);
    if (!zone) return;
    const newCoords = [...zone.coords];
    newCoords[index] = newCoord;
    updateZone?.(zoneId, { coords: newCoords });
  }, [zones, updateZone]);

  const handleVertexClick = useCallback((zoneId, e) => {
    if (e.originalEvent) e.originalEvent.stopPropagation();
    onSelectZone?.(zoneId);
  }, [onSelectZone]);

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
            geometry: {
              type: 'LineString',
              coordinates: [[start.lng, start.lat], [end.lng, end.lat]]
            },
            properties: {
              zoneId: z.id,
              color: z.color || '#0ea5e9',
              isActive: z.id === activeZoneId
            }
          });
        }
      });
    });
    return { type: 'FeatureCollection', features };
  }, [zones, activeZoneId]);

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
    if (roads?.features?.length) { 
      setRoadCollection?.(roads); 
      lastFetchRef.current = { lat, lng };
      return roads; 
    }
    return roadCollection;
  }, [isSnapEnabled, roadCollection, setRoadCollection]);

  const maybeSnapPoint = useCallback(async ({ lat, lng }) => {
    if (!isSnapEnabled) return { lat, lng };
    const roads = await ensureRoadsNear(lat, lng);
    const snapped = snapToRoads([lat, lng], roads, 18);
    if (snapped) return { lat: snapped.point[0], lng: snapped.point[1], road: snapped.road };
    return { lat, lng };
  }, [ensureRoadsNear, isSnapEnabled]);

  const handleMapClick = useCallback(async (e) => {
    if (!activeTool && trafficLayerRef.current?.handleClick?.(e)) {
      return;
    }

    const rawPoint = { lng: e.lngLat.lng, lat: e.lngLat.lat };
    setClickPing(rawPoint);
    setTimeout(() => setClickPing(prev => prev?.lng === rawPoint.lng ? null : prev), 800);

    if (activeTool?.startsWith('draw-')) {
      const clickIdx = draftCoordsRef.current.length;
      
      // Update coordinates synchronously in refs & state to prevent race conditions
      draftCoordsRef.current = [...draftCoordsRef.current, rawPoint];
      setDraftCoords([...draftCoordsRef.current]);
      onUpdatePointCount?.(draftCoordsRef.current.length);

      // Async snapping
      const myPromise = maybeSnapPoint(rawPoint);
      snapPromisesRef.current.push(myPromise);

      if (activeTool === 'draw-rectangle' && draftCoordsRef.current.length === 2) {
        const currentPromises = [...snapPromisesRef.current];
        snapPromisesRef.current = [];
        const snappedPoints = await Promise.all(currentPromises);
        onShapeDrawn?.(rectangleFromPoints(snappedPoints), 'rectangle');
        draftCoordsRef.current = [];
        setDraftCoords([]);
        onUpdatePointCount?.(0);
        if (mapRef.current) {
          const map = mapRef.current.getMap();
          const ds = map.getSource('draft-shape');
          if (ds) ds.setData({ type: 'FeatureCollection', features: [] });
          const cs = map.getSource('cursor-source');
          if (cs) cs.setData({ type: 'FeatureCollection', features: [] });
        }
        setActiveTool?.(null);
        return;
      }

      const snapped = await myPromise;
      const pt = draftCoordsRef.current[clickIdx];
      // Only update if current coordinate has not changed (e.g. via undo/cancel)
      if (pt && pt.lat === rawPoint.lat && pt.lng === rawPoint.lng) {
        draftCoordsRef.current = draftCoordsRef.current.map((p, idx) =>
          idx === clickIdx ? { ...snapped, snapped: snapped.lat !== rawPoint.lat } : p
        );
        setDraftCoords([...draftCoordsRef.current]);
      }
      return;
    }

    if (!activeTool) {
      const clicked = e.features?.find(f => f.layer.id === 'zones-line' || f.layer.id === 'zones-fill');
      if (clicked) {
        const zoneId = clicked.properties.id;
        const clickedZone = zones.find(z => z.id === zoneId);
        
        // If it's the active zone, check if we clicked near one of its edges to set as approach side
        if (zoneId === activeZoneId && clickedZone && clickedZone.coords?.length > 1) {
          const clickPoint = turf.point([rawPoint.lng, rawPoint.lat]);
          let minDistance = Infinity;
          let closestEdgeIndex = 0;
          
          const isPath = clickedZone.shapeType === 'polyline';
          const numCoords = clickedZone.coords.length;
          const loopLimit = isPath ? numCoords - 1 : numCoords;
          
          for (let i = 0; i < loopLimit; i++) {
            const start = clickedZone.coords[i];
            const end = clickedZone.coords[(i + 1) % numCoords];
            const segment = turf.lineString([[start.lng, start.lat], [end.lng, end.lat]]);
            const dist = turf.pointToLineDistance(clickPoint, segment, { units: 'meters' });
            if (dist < minDistance) {
              minDistance = dist;
              closestEdgeIndex = i;
            }
          }
          
          // If clicked within 35 meters of an edge, update approach side and enable taper
          if (minDistance < 35) {
            const currentIndices = clickedZone.approachEdgeIndices || [];
            let newIndices;
            if (currentIndices.includes(closestEdgeIndex)) {
              newIndices = currentIndices.filter(idx => idx !== closestEdgeIndex);
              showToast?.(`Approach side ${closestEdgeIndex + 1} removed`);
            } else {
              newIndices = [...currentIndices, closestEdgeIndex];
              showToast?.(`Approach side ${closestEdgeIndex + 1} added`);
            }
            updateZone?.(zoneId, { approachEdgeIndices: newIndices, taperDisabled: newIndices.length === 0 });
            return;
          }
        }
        
        if (zoneId !== activeZoneId) {
          onSelectZone?.(zoneId);
        }
      }
      return;
    }

    const snappedData = await maybeSnapPoint(rawPoint);
    const rot = snappedData.road ? getRoadOrientation([snappedData.lat, snappedData.lng], snappedData.road) : 0;
    setPlacedAssets(prev => [...prev, { id: `manual-${Date.now()}`, type: activeTool, lat: snappedData.lat, lng: snappedData.lng, rotation: rot }]);
  }, [activeTool, maybeSnapPoint, onSelectZone, setPlacedAssets, onUpdatePointCount, setActiveTool, onShapeDrawn, zones, activeZoneId, updateZone, showToast]);

  const handleMouseMove = useCallback((e) => {
    if (!activeTool?.startsWith('draw-') || !mapRef.current) return;

    const map = mapRef.current.getMap();
    let cursorPt = { lng: e.lngLat.lng, lat: e.lngLat.lat };
    if (isSnapEnabled && roadCollection) {
      const snapped = snapToRoads([cursorPt.lat, cursorPt.lng], roadCollection, 18);
      if (snapped) {
        cursorPt = { lat: snapped.point[0], lng: snapped.point[1] };
      }
    }

    if (requestRef.current) cancelAnimationFrame(requestRef.current);

    requestRef.current = requestAnimationFrame(() => {
      const draftSource = map.getSource('draft-shape');
      if (draftSource && draftCoordsRef.current.length > 0) {
        const feat = featureFromCoords(draftCoordsRef.current, toolToShapeType(activeTool), cursorPt);
        draftSource.setData(feat);
      }

      const cursorSource = map.getSource('cursor-source');
      if (cursorSource) {
        cursorSource.setData({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [cursorPt.lng, cursorPt.lat] },
          properties: {}
        });
      }
    });
  }, [activeTool, isSnapEnabled, roadCollection]);

  const handleLoad = useCallback((e) => {
    const map = e.target?.getMap ? e.target.getMap() : e.target;
    setMapInstance(map);
  }, [setMapInstance]);

  // Re-order layers after style change to ensure zones render above satellite tiles
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current.getMap();
    const reorder = () => {
      try {
        const layerOrder = ['zones-fill', 'zones-line', 'approach-sides-glow', 'approach-sides-dash', 'draft-fill', 'draft-line', 'cursor-layer', TRAFFIC_THREE_LAYER_ID];
        layerOrder.forEach(id => {
          if (map.getLayer(id)) map.moveLayer(id);
        });
      } catch (_) { /* layer may not exist yet */ }
    };
    map.on('styledata', reorder);
    return () => map.off('styledata', reorder);
  }, [mapStyle]);

  useEffect(() => { 
    if (mapRef.current && !useStore.getState().mapInstance) {
      setMapInstance(mapRef.current.getMap());
    }
  }, [setMapInstance]);

  useEffect(() => {
    if (!mapInstance) return;
    const map = mapInstance;
    let cancelled = false;

    const ensureTrafficLayer = () => {
      if (cancelled) return;
      if (!map.addLayer || !map.getLayer) return;
      if (!trafficLayerRef.current) {
        trafficLayerRef.current = createTrafficAssetsLayer({
          map,
          onDeleteAsset: (assetId) => onAssetRemoveRef.current?.(assetId),
        });
      }

      try {
        if (!map.getLayer(TRAFFIC_THREE_LAYER_ID)) {
          map.addLayer(trafficLayerRef.current);
        }
        trafficLayerRef.current.setData(trafficDataRef.current);
      } catch (_) {
        // The style can be between teardown and load during map-style switches.
      }
    };

    ensureTrafficLayer();
    map.on('style.load', ensureTrafficLayer);
    return () => {
      cancelled = true;
      try {
        map.off?.('style.load', ensureTrafficLayer);
        if (map.getLayer?.(TRAFFIC_THREE_LAYER_ID)) {
          map.removeLayer(TRAFFIC_THREE_LAYER_ID);
        }
      } catch (_) {
        // MapLibre can clear its style before React effect cleanup runs.
      }
      trafficLayerRef.current?.dispose?.();
      trafficLayerRef.current = null;
    };
  }, [mapInstance]);

  useEffect(() => {
    trafficDataRef.current = { zones, activeZoneId };
    if (trafficLayerRef.current?.setData) {
      const activeZone = (zones || []).find(z => z.id === activeZoneId);
      const assetCount = activeZone?.placedAssets?.length || 0;
      
      // AGGRESSIVE UI DIAGNOSTIC: Force a toast if we receive assets
      if (assetCount > 0 && !window.__hasToastedAssets) {
        showToast(`DEBUG: MapArea received ${assetCount} assets!`);
        window.__hasToastedAssets = true;
      }
      
      console.log(`[MAP AREA] Pushing Data to 3D Layer. Active Zone: ${activeZoneId}, Assets: ${assetCount}`);
      trafficLayerRef.current.setData({ zones, activeZoneId });
    }
  }, [zones, activeZoneId, showToast]);

  // Dynamically find the first symbol (label) layer in the MapTiler style,
  // so we can insert the Esri satellite raster layer underneath it.
  // This allows place labels and custom 3D building holograms to render on top of 
  // the satellite photos while hiding dark vector landuse and road backgrounds.
  useEffect(() => {
    if (!mapInstance) return;
    const map = mapInstance;
    const updateFirstLayer = () => {
      try {
        const layers = map.getStyle().layers;
        if (layers && layers.length > 0) {
          const firstSymbol = layers.find(l => l.type === 'symbol');
          if (firstSymbol) {
            setFirstStyleLayerId(firstSymbol.id);
          }
        }
      } catch (_) {}
    };

    updateFirstLayer();
    map.on('style.load', updateFirstLayer);
    map.on('styledata', updateFirstLayer);
    return () => {
      map.off('style.load', updateFirstLayer);
      map.off('styledata', updateFirstLayer);
    };
  }, [mapInstance]);

  useEffect(() => {
    const clearDraftSources = () => {
      if (!mapRef.current) return;
      const map = mapRef.current.getMap();
      const ds = map.getSource('draft-shape');
      if (ds) ds.setData({ type: 'FeatureCollection', features: [] });
      const cs = map.getSource('cursor-source');
      if (cs) cs.setData({ type: 'FeatureCollection', features: [] });
    };

    const finish = () => {
      const shapeType = toolToShapeType(activeTool);
      const coords = shapeType === 'rectangle' ? rectangleFromPoints(draftCoordsRef.current) : draftCoordsRef.current;
      onShapeDrawn?.(coords, shapeType);
      draftCoordsRef.current = [];
      setDraftCoords([]);
      onUpdatePointCount?.(0);
      snapPromisesRef.current = [];
      clearDraftSources();
    };
    const undo = () => {
      draftCoordsRef.current = draftCoordsRef.current.slice(0, -1);
      setDraftCoords([...draftCoordsRef.current]);
      onUpdatePointCount?.(Math.max(0, draftCoordsRef.current.length));
      snapPromisesRef.current = snapPromisesRef.current.slice(0, -1);
    };
    const cancel = () => {
      draftCoordsRef.current = [];
      setDraftCoords([]);
      onUpdatePointCount?.(0);
      snapPromisesRef.current = [];
      clearDraftSources();
    };
    window.addEventListener('trigger-draw-finish', finish);
    window.addEventListener('trigger-draw-undo', undo);
    window.addEventListener('trigger-draw-cancel', cancel);
    return () => {
      window.removeEventListener('trigger-draw-finish', finish);
      window.removeEventListener('trigger-draw-undo', undo);
      window.removeEventListener('trigger-draw-cancel', cancel);
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [activeTool, onShapeDrawn, onUpdatePointCount]);

  useEffect(() => {
    if (!activeTool?.startsWith('draw-')) {
      if (mapRef.current) {
        const map = mapRef.current.getMap();
        const ds = map.getSource('draft-shape');
        if (ds) ds.setData({ type: 'FeatureCollection', features: [] });
        const cs = map.getSource('cursor-source');
        if (cs) cs.setData({ type: 'FeatureCollection', features: [] });
      }
    }
  }, [activeTool]);

  useEffect(() => {
    draftCoordsRef.current = [];
    setDraftCoords([]);
    onUpdatePointCount?.(0);
    snapPromisesRef.current = [];
    if (mapRef.current) {
      const map = mapRef.current.getMap();
      const ds = map.getSource('draft-shape');
      if (ds) ds.setData({ type: 'FeatureCollection', features: [] });
      const cs = map.getSource('cursor-source');
      if (cs) cs.setData({ type: 'FeatureCollection', features: [] });
    }
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
      >
        <NavigationControl position="bottom-right" visualizePitch />
        <Source id="buildings-source" type="vector" url={`https://api.maptiler.com/tiles/v3/tiles.json?key=${MAPTILER_KEY}`} />
        
        {mapStyle === 'satellite' && (
          <Source id="esri-world-imagery" type="raster" tiles={['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}']} tileSize={256} minzoom={1} maxzoom={19} attribution="Esri">
            <Layer id="esri-world-imagery-layer" type="raster" beforeId={firstStyleLayerId} />
          </Source>
        )}

        {mapStyle === 'satellite' && (
          <Layer id="satellite-roads" source-layer="transportation" source="buildings-source" type="line" paint={{ 'line-color': '#ffffff', 'line-opacity': 0.25, 'line-width': 1.2 }} />
        )}
        <Layer id="3d-buildings" source="buildings-source" source-layer="building" type="fill-extrusion" minzoom={14} paint={{ 'fill-extrusion-height': ['get', 'render_height'], 'fill-extrusion-base': ['get', 'render_min_height'], 'fill-extrusion-color': '#0ea5e9', 'fill-extrusion-opacity': 0.5 }} />
        
        <LocationSearch />
        
        {isSnapEnabled && (
          <div className="snap-indicator-badge">
            <div className="snap-indicator-content">
              <span className="snap-indicator-title"><Magnet size={14} /> Snap to Road Active</span>
              <span className="snap-indicator-text">Your clicks will align to street geometry</span>
            </div>
          </div>
        )}
        
        <Source id="all-zones" type="geojson" data={allZonesGeoJSON}>
          <Layer id="zones-fill" type="fill" filter={['==', ['get', 'isArea'], true]} paint={{ 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['boolean', ['get', 'isActive'], false], 0.35, 0.15] }} />
          <Layer id="zones-line" type="line" paint={{ 'line-color': ['get', 'color'], 'line-width': ['case', ['boolean', ['get', 'isActive'], false], 5, 3] }} />
        </Source>

        <Source id="approach-sides" type="geojson" data={approachSidesGeoJSON}>
          <Layer id="approach-sides-glow" type="line" paint={{ 'line-color': ['get', 'color'], 'line-width': ['case', ['boolean', ['get', 'isActive'], false], 8, 4], 'line-opacity': 0.8 }} />
          <Layer id="approach-sides-dash" type="line" paint={{ 'line-color': '#ffffff', 'line-width': ['case', ['boolean', ['get', 'isActive'], false], 3, 1.5], 'line-dasharray': [3, 3] }} />
        </Source>

        <Source id="draft-shape" type="geojson" data={draftFeatureStatic}>
          <Layer id="draft-fill" type="fill" filter={['==', ['geometry-type'], 'Polygon']} paint={{ 'fill-color': isSnapEnabled ? '#10b981' : '#38bdf8', 'fill-opacity': 0.3 }} />
          <Layer id="draft-line" type="line" paint={{ 'line-color': isSnapEnabled ? '#10b981' : '#38bdf8', 'line-width': 4 }} />
        </Source>

        <Source id="cursor-source" type="geojson" data={{ type: 'FeatureCollection', features: [] }}>
          <Layer id="cursor-layer" type="symbol" layout={{ 'text-field': '+', 'text-size': 24, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true, 'text-ignore-placement': true }} paint={{ 'text-color': isSnapEnabled ? '#10b981' : '#0ea5e9', 'text-halo-color': '#fff', 'text-halo-width': 2 }} />
        </Source>



        {clickPing && (
          <Marker longitude={clickPing.lng} latitude={clickPing.lat} anchor="center">
            <div className="click-ping" />
          </Marker>
        )}

        <Layer id="place-labels" source="buildings-source" source-layer="place" type="symbol" layout={{ 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Bold'], 'text-size': 14, 'text-transform': 'uppercase' }} paint={{ 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.8)', 'text-halo-width': 2 }} />
        <Layer id="street-labels" source="buildings-source" source-layer="transportation_name" type="symbol" layout={{ 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'symbol-placement': 'line' }} paint={{ 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.8)', 'text-halo-width': 2 }} />

        {zoom >= 14 && zones.flatMap((z) => (z.coords || []).map((pt, i) => (
          <Marker key={`${z.id}-v-${i}`} longitude={pt.lng} latitude={pt.lat} anchor="center" draggable={z.id === activeZoneId} onDrag={(e) => handleVertexDragEnd(z.id, i, e)} onDragEnd={(e) => handleVertexDragEnd(z.id, i, e)} onClick={(e) => handleVertexClick(z.id, e)}>
            <div className={`vertex-marker ${z.id === activeZoneId ? 'active' : 'dormant'}`} style={{ width: z.id === activeZoneId ? '18px' : '12px', height: z.id === activeZoneId ? '18px' : '12px', background: z.id === activeZoneId ? '#fff' : (z.color || '#0ea5e9'), border: `3px solid ${z.color || '#0ea5e9'}`, borderRadius: '50%', boxShadow: z.id === activeZoneId ? '0 0 10px rgba(0,0,0,0.4)' : '0 2px 4px rgba(0,0,0,0.3)', cursor: z.id === activeZoneId ? 'move' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: z.color || '#0ea5e9', fontWeight: '900', transition: 'all 0.15s ease' }}>
              {z.id === activeZoneId ? i + 1 : ''}
            </div>
          </Marker>
        )))}

        {draftCoords.map((pt, i) => (
          <Marker key={`draft-v-${i}`} longitude={pt.lng} latitude={pt.lat} anchor="center">
            <div className="vertex-marker active" style={{ width: '18px', height: '18px', background: '#fff', border: '3px solid #38bdf8', borderRadius: '50%', boxShadow: '0 0 10px rgba(56, 189, 248, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#38bdf8', fontWeight: '900' }}>
              {i + 1}
            </div>
          </Marker>
        ))}
      </Map>
      <div className="map-style-toggle">
        <button onClick={() => setMapStyle('dark')} className={mapStyle === 'dark' ? 'active' : ''}>Dark</button>
        <button onClick={() => setMapStyle('satellite')} className={mapStyle === 'satellite' ? 'active' : ''}>Satellite HD</button>
      </div>
    </div>
  );
};

export default memo(MapArea);
