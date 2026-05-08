import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import * as turf from '@turf/turf';
import useStore from '../store/useStore';
import Map, { Layer, Marker, NavigationControl, Source } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { 
  Construction, Shield, Truck, User, TrafficCone, AlertTriangle, 
  Info, ArrowRight, Timer, Octagon, Ban, Activity, PlusCircle, MapPin, Square, Magnet
} from 'lucide-react';
import LocationSearch from './LocationSearch';
import { fetchRoadVectors, snapToRoads, getRoadOrientation } from '../utils/geoSnap';

const MAPTILER_KEY = 'cxN8sHcrbJ8xB21xDxDj';
const MAP_STYLES = {
  dark: 'streets-v2-dark',
  satellite: 'streets-v2-dark', 
};

// -- 2D ASSET CONFIGURATION (Professional Sign-inspired designs) --
const ASSET_CONFIG = {
  cone: { icon: TrafficCone, color: '#ff4d00', shape: 'circle' },
  barrier: { icon: Square, color: '#ef4444', shape: 'rect' },
  truck: { icon: Truck, color: '#facc15', shape: 'rect' },
  sign: { icon: Construction, color: '#facc15', shape: 'diamond' },
  'sign-stop': { icon: Octagon, color: '#ef4444', shape: 'octagon' },
  'sign-roadwork': { icon: Construction, color: '#ff4d00', shape: 'diamond' },
  'sign-merge': { icon: ArrowRight, color: '#f59e0b', shape: 'diamond' },
  'sign-slow': { icon: Timer, color: '#facc15', shape: 'circle' },
  flagger: { icon: User, color: '#22c55e', shape: 'circle' },
  firstaid: { icon: Activity, color: '#ef4444', shape: 'circle' },
  ACCIDENT: { icon: AlertTriangle, color: '#b91c1c', shape: 'triangle' },
  HAZARD: { icon: AlertTriangle, color: '#d97706', shape: 'triangle' },
};

// -- HELPERS --
function lngLat(point) { return [point.lng, point.lat]; }

function rectangleFromPoints(points) {
  if (points.length < 2) return points;
  const [a, b] = points;
  return [{ lng: a.lng, lat: a.lat }, { lng: b.lng, lat: a.lat }, { lng: b.lng, lat: b.lat }, { lng: a.lng, lat: b.lat }];
}

function featureFromCoords(coords, shapeType, cursor = null) {
  if (shapeType === 'rectangle') {
    const rect = rectangleFromPoints(coords);
    if (rect.length < 2) return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: rect.map(lngLat) } };
    return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...rect.map(lngLat), lngLat(rect[0])]] } };
  }
  const display = cursor ? [...coords, cursor] : coords;
  if (shapeType === 'polygon' && display.length >= 3) return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...display.map(lngLat), lngLat(display[0])]] } };
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: display.map(lngLat) } };
}

function toolToShapeType(tool) {
  if (tool === 'draw-polyline') return 'polyline';
  if (tool === 'draw-rectangle') return 'rectangle';
  return 'polygon';
}

const MapArea = ({
  activeTool, zones = [], activeZoneId, onSelectZone, isSnapEnabled,
  roadCollection, setRoadCollection, setPlacedAssets, onAssetRemove,
  onShapeDrawn, onUpdatePointCount, liveIncidents = [], showToast,
  updateZone, setActiveTool // Added setActiveTool
}) => {
  const isExporting = useStore(state => state.isExporting);
  const setMapInstance = useStore(state => state.setMapInstance);
  const mapStyle = useStore(state => state.mapStyle);
  const setMapStyle = useStore(state => state.setMapStyle);

  const mapRef = useRef(null);
  const [draftCoords, setDraftCoords] = useState([]);
  const [clickPing, setClickPing] = useState(null); // Added clickPing
  const [zoom, setZoom] = useState(16.5);
  const draftCoordsRef = useRef([]);
  const requestRef = useRef(); // For performance optimization
  const lastFetchRef = useRef(null);

  useEffect(() => { draftCoordsRef.current = draftCoords; }, [draftCoords]);

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
      const coords = z.shapeType === 'rectangle' ? rectangleFromPoints(z.coords) : z.coords;
      if (coords.length < 2) return null;
      const isArea = z.shapeType !== 'polyline';
      const feature = featureFromCoords(coords, isArea ? 'polygon' : 'polyline');
      return { ...feature, properties: { id: z.id, isActive: z.id === activeZoneId, color: z.color || '#0ea5e9', isArea } };
    }).filter(Boolean)
  }), [zones, activeZoneId]);

  const draftFeatureStatic = useMemo(() => {
    if (!activeTool?.startsWith('draw-') || draftCoords.length === 0) return { type: 'FeatureCollection', features: [] };
    // Pass null cursor to decouple from React state for performance
    return featureFromCoords(draftCoords, toolToShapeType(activeTool), null);
  }, [draftCoords, activeTool]);

  const ensureRoadsNear = useCallback(async (lat, lng) => {
    if (!isSnapEnabled) return roadCollection;
    
    // Performance: Only fetch if we moved > 400m from last fetch center
    if (roadCollection?.features?.length && lastFetchRef.current) {
      const dist = turf.distance(
        turf.point([lng, lat]), 
        turf.point([lastFetchRef.current.lng, lastFetchRef.current.lat]), 
        { units: 'meters' }
      );
      if (dist < 400) return roadCollection;
    }

    const roads = await fetchRoadVectors(lat, lng, 900);
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
    if (snapped) return { lat: snapped[0], lng: snapped[1], road: roads.features.find(f => f.geometry.type.includes('Line')) || null };
    return { lat, lng };
  }, [ensureRoadsNear, isSnapEnabled]);

  const handleMapClick = useCallback(async (e) => {
    const rawPoint = { lng: e.lngLat.lng, lat: e.lngLat.lat };
    
    // Show click ping
    setClickPing(rawPoint);
    setTimeout(() => setClickPing(prev => prev?.lng === rawPoint.lng ? null : prev), 800);

    // If drawing, add point
    if (activeTool?.startsWith('draw-')) {
      const snapped = await maybeSnapPoint(rawPoint);
      const nextCoords = [...draftCoordsRef.current, { ...snapped, snapped: snapped.lat !== rawPoint.lat }];
      
      // Auto-finish for rectangle after 2 points
      if (activeTool === 'draw-rectangle' && nextCoords.length === 2) {
        onShapeDrawn?.(rectangleFromPoints(nextCoords), 'rectangle');
        setDraftCoords([]); onUpdatePointCount?.(0);
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

      setDraftCoords(nextCoords);
      onUpdatePointCount?.(nextCoords.length);
      return;
    }

    // If no tool, try selecting an existing zone
    if (!activeTool) {
      const clicked = e.features?.[0];
      if (clicked?.properties?.id) {
        onSelectZone?.(clicked.properties.id);
      }
      return;
    }

    // Asset placement
    const snappedData = await maybeSnapPoint(rawPoint);
    const rot = snappedData.road ? getRoadOrientation([snappedData.lat, snappedData.lng], snappedData.road) : 0;
    setPlacedAssets(prev => [...prev, { id: `manual-${Date.now()}`, type: activeTool, lat: snappedData.lat, lng: snappedData.lng, rotation: rot }]);
  }, [activeTool, maybeSnapPoint, onSelectZone, setPlacedAssets, onUpdatePointCount, setActiveTool, onShapeDrawn]);

  const handleMouseMove = useCallback((e) => {
    if (!activeTool?.startsWith('draw-') || !mapRef.current) return;
    
    const map = mapRef.current.getMap();
    const cursorPt = { lng: e.lngLat.lng, lat: e.lngLat.lat };

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
  }, [activeTool]);

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
      setDraftCoords([]); onUpdatePointCount?.(0);
      clearDraftSources();
    };
    const undo = () => { setDraftCoords(prev => prev.slice(0,-1)); onUpdatePointCount?.(Math.max(0, draftCoordsRef.current.length - 1)); };
    const cancel = () => { setDraftCoords([]); onUpdatePointCount?.(0); clearDraftSources(); };
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

  // Persistent Assets Component
  const RenderedAssets = useMemo(() => {
    return zones.flatMap(z => (z.placedAssets || []).map(asset => {
      const cfg = ASSET_CONFIG[asset.type] || { icon: MapPin, color: '#94a3b8', shape: 'circle' };
      const Icon = cfg.icon;
      const isActive = z.id === activeZoneId;
      
      const getShapeStyle = () => {
        const base = {
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: '28px', height: '28px', cursor: 'pointer',
          background: cfg.color, color: 'white', border: '2px solid white',
          boxShadow: '0 3px 6px rgba(0,0,0,0.3)', transition: 'all 0.2s',
          transform: `rotate(${asset.rotation}deg)`
        };
        if (cfg.shape === 'circle') return { ...base, borderRadius: '50%' };
        if (cfg.shape === 'rect') return { ...base, borderRadius: '4px' };
        if (cfg.shape === 'diamond') return { ...base, transform: `rotate(${45 + (asset.rotation || 0)}deg)`, borderRadius: '2px' };
        if (cfg.shape === 'octagon') return { ...base, clipPath: 'polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)' };
        return base;
      };

      return (
        <Marker key={asset.id} longitude={asset.lng} latitude={asset.lat} anchor="center">
          <div 
            style={getShapeStyle()}
            onClick={(e) => { e.stopPropagation(); isActive ? onAssetRemove?.(asset.id) : onSelectZone?.(z.id); }}
            title={asset.type}
          >
            <div style={{ transform: cfg.shape === 'diamond' ? 'rotate(-45deg)' : 'none' }}>
              <Icon size={16} strokeWidth={2.5} />
            </div>
          </div>
        </Marker>
      );
    }));
  }, [zones, activeZoneId, onAssetRemove, onSelectZone]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', pointerEvents: isExporting ? 'none' : 'auto' }}>
      <Map
        ref={mapRef}
        onLoad={(e) => setMapInstance(e.target)}
        initialViewState={{ longitude: 77.209, latitude: 28.6139, zoom: 16.5, pitch: 38, bearing: -12 }}
        mapStyle={`https://api.maptiler.com/maps/${MAP_STYLES[mapStyle]}/style.json?key=${MAPTILER_KEY}`}
        interactiveLayerIds={['zones-fill']}
        onClick={handleMapClick}
        onMouseMove={handleMouseMove}
        onMove={(evt) => setZoom(evt.viewState.zoom)}
        maxPitch={75}
        mapOptions={{
          preserveDrawingBuffer: true
        }}
      >
        <NavigationControl position="bottom-right" visualizePitch />
        <Source id="buildings-source" type="vector" url={`https://api.maptiler.com/tiles/v3/tiles.json?key=${MAPTILER_KEY}`} />
        
        {mapStyle === 'satellite' && (
          <Source id="esri-world-imagery" type="raster" tiles={['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}']} tileSize={256} minzoom={1} maxzoom={19}>
            <Layer id="esri-world-imagery-layer" type="raster" beforeId="3d-buildings" />
          </Source>
        )}

        {mapStyle === 'satellite' && (
          <Layer 
            id="satellite-roads" 
            source-layer="transportation" 
            source="buildings-source" 
            type="line" 
            beforeId="3d-buildings"
            paint={{ 'line-color': '#ffffff', 'line-opacity': 0.25, 'line-width': 1.2 }} 
          />
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
          <Layer id="zones-fill" type="fill" filter={['==', ['get', 'isArea'], true]} paint={{ 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['boolean', ['get', 'isActive'], false], 0.25, 0.1] }} />
          <Layer id="zones-line" type="line" paint={{ 'line-color': ['get', 'color'], 'line-width': ['case', ['boolean', ['get', 'isActive'], false], 4, 2], 'line-dasharray': [2, 1.5] }} />
        </Source>

        <Source id="draft-shape" type="geojson" data={draftFeatureStatic}>
          <Layer id="draft-fill" type="fill" filter={['==', ['geometry-type'], 'Polygon']} paint={{ 'fill-color': isSnapEnabled ? '#10b981' : '#38bdf8', 'fill-opacity': 0.2 }} />
          <Layer id="draft-line" type="line" paint={{ 'line-color': isSnapEnabled ? '#10b981' : '#38bdf8', 'line-width': 3, 'line-dasharray': [2, 1] }} />
        </Source>

        <Source id="cursor-source" type="geojson" data={{ type: 'FeatureCollection', features: [] }}>
          <Layer 
            id="cursor-layer" 
            type="symbol" 
            layout={{ 
              'text-field': '+', 
              'text-size': 20, 
              'text-font': ['Noto Sans Bold'], 
              'text-allow-overlap': true,
              'text-ignore-placement': true
            }} 
            paint={{ 'text-color': isSnapEnabled ? '#10b981' : '#0ea5e9', 'text-halo-color': '#fff', 'text-halo-width': 1 }} 
          />
        </Source>

        {/* 2D ASSET RENDERING */}
        {RenderedAssets}

        {/* CLICK PING */}
        {clickPing && (
          <Marker longitude={clickPing.lng} latitude={clickPing.lat} anchor="center">
            <div className="click-ping" />
          </Marker>
        )}

        {/* LABELS */}
        <Layer id="place-labels" source="buildings-source" source-layer="place" type="symbol" layout={{ 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Bold'], 'text-size': 14, 'text-transform': 'uppercase' }} paint={{ 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.8)', 'text-halo-width': 2 }} />
        <Layer id="street-labels" source="buildings-source" source-layer="transportation_name" type="symbol" layout={{ 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'symbol-placement': 'line' }} paint={{ 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.8)', 'text-halo-width': 2 }} />

        {/* PERSISTENT ZONE POINTERS */}
        {zoom >= 14 && zones.flatMap((z) => (z.coords || []).map((pt, i) => (
          <Marker key={`${z.id}-v-${i}`} longitude={pt.lng} latitude={pt.lat} anchor="center" draggable={z.id === activeZoneId} onDrag={(e) => handleVertexDragEnd(z.id, i, e)} onDragEnd={(e) => handleVertexDragEnd(z.id, i, e)} onClick={(e) => handleVertexClick(z.id, e)}>
            <div className={`vertex-marker ${z.id === activeZoneId ? 'active' : 'dormant'}`} style={{ width: z.id === activeZoneId ? '16px' : '10px', height: z.id === activeZoneId ? '16px' : '10px', background: z.id === activeZoneId ? '#fff' : (z.color || '#0ea5e9'), border: `3px solid ${z.color || '#0ea5e9'}`, borderRadius: '50%', boxShadow: z.id === activeZoneId ? '0 0 10px rgba(0,0,0,0.4)' : '0 2px 4px rgba(0,0,0,0.3)', cursor: z.id === activeZoneId ? 'move' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', color: z.color || '#0ea5e9', fontWeight: '900', transition: 'all 0.15s ease' }}>
              {z.id === activeZoneId ? i + 1 : ''}
            </div>
          </Marker>
        )))}

        {/* DRAFT VERTEX MARKERS */}
        {draftCoords.map((pt, i) => (
          <Marker key={`draft-v-${i}`} longitude={pt.lng} latitude={pt.lat} anchor="center">
            <div className="vertex-marker active" style={{ width: '14px', height: '14px', background: '#fff', border: '3px solid #38bdf8', borderRadius: '50%', boxShadow: '0 0 10px rgba(56, 189, 248, 0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', color: '#38bdf8', fontWeight: '900' }}>
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
