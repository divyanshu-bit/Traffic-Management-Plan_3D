import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import * as turf from '@turf/turf';
import useStore from '../store/useStore';
import Map, { Layer, Marker, NavigationControl, Source } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { 
  Construction, 
  Shield, 
  Truck, 
  User, 
  TrafficCone, 
  AlertTriangle, 
  Info, 
  ArrowRight, 
  Timer, 
  Octagon, 
  Ban, 
  Activity, 
  PlusCircle,
  MapPin,
  Square
} from 'lucide-react';
import LocationSearch from './LocationSearch';
import { fetchRoadVectors, snapToRoads, getRoadOrientation } from '../utils/geoSnap';

const MAPTILER_KEY = 'cxN8sHcrbJ8xB21xDxDj';

const MAP_STYLES = {
  dark: 'streets-v2-dark',
  satellite: 'streets-v2-dark', // Use the same lightweight vector base for both
};



const ASSET_CONFIG = {
  cone: { icon: TrafficCone, color: '#f97316' },
  barrier: { icon: Square, color: '#3b82f6' },
  truck: { icon: Truck, color: '#8b5cf6' },
  sign: { icon: Construction, color: '#eab308' },
  flagger: { icon: User, color: '#10b981' },
  supervisor: { icon: Shield, color: '#6366f1' },
  marshal: { icon: Shield, color: '#f43f5e' },
  firstaid: { icon: Activity, color: '#ef4444' },
  'sign-roadwork': { icon: Construction, color: '#f97316' },
  'sign-merge': { icon: ArrowRight, color: '#f59e0b' },
  'sign-slow': { icon: Timer, color: '#facc15' },
  'sign-detour': { icon: PlusCircle, color: '#10b981' },
  'sign-menwork': { icon: User, color: '#f97316' },
  'sign-endwork': { icon: Construction, color: '#10b981' },
  'sign-stop': { icon: Octagon, color: '#ef4444' },
  'sign-speed30': { icon: null, label: '30', color: '#facc15' },
  'sign-speed50': { icon: null, label: '50', color: '#facc15' },
  'sign-nopark': { icon: Ban, color: '#ef4444' },
  ACCIDENT: { icon: AlertTriangle, color: '#ef4444' },
  HAZARD: { icon: AlertTriangle, color: '#f59e0b' },
};


const lngLat = (point) => [point.lng, point.lat];

const rectangleFromPoints = (points) => {
  if (points.length < 2) return points;
  const [a, b] = points;
  return [
    { lng: a.lng, lat: a.lat },
    { lng: b.lng, lat: a.lat },
    { lng: b.lng, lat: b.lat },
    { lng: a.lng, lat: b.lat },
  ];
};

const zoneCoordsForRender = (zone) => {
  if (!zone.coords?.length) return [];
  return zone.shapeType === 'rectangle' ? rectangleFromPoints(zone.coords) : zone.coords;
};

const featureFromCoords = (coords, shapeType, cursor = null) => {
  if (shapeType === 'rectangle') {
    const rect = rectangleFromPoints(coords);
    if (rect.length < 2) {
      return {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: rect.map(lngLat) },
      };
    }
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [[...rect.map(lngLat), lngLat(rect[0])]] },
    };
  }

  const display = cursor && shapeType !== 'polyline' ? [...coords, cursor] : cursor ? [...coords, cursor] : coords;
  if (shapeType === 'polygon' && display.length >= 3) {
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [[...display.map(lngLat), lngLat(display[0])]] },
    };
  }

  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: display.map(lngLat) },
  };
};

const canFinishDraft = (tool, coords) => {
  if (tool === 'draw-polyline') return coords.length >= 2;
  if (tool === 'draw-rectangle') return coords.length >= 2;
  return coords.length >= 3;
};

const toolToShapeType = (tool) => {
  if (tool === 'draw-polyline') return 'polyline';
  if (tool === 'draw-rectangle') return 'rectangle';
  return 'polygon';
};


const MapArea = ({
  activeTool,
  zones = [],
  activeZoneId,
  onSelectZone,
  isSnapEnabled,
  roadCollection,
  setRoadCollection,
  setPlacedAssets,
  onAssetRemove,
  onShapeDrawn,
  onUpdatePointCount,
  liveIncidents = [],
  showToast,
}) => {
  const isExporting = useStore(state => state.isExporting);
  const setMapInstance = useStore(state => state.setMapInstance);
  const mapRef = useRef(null);

  useEffect(() => {
    if (mapRef.current) {
      setMapInstance(mapRef.current.getMap());
    }
  }, [setMapInstance]);

  const [mapStyle, setMapStyle] = useState('satellite');
  const [draftCoords, setDraftCoords] = useState([]);

  // Avoid React re-renders on every mouse move.
  const cursorPointRef = useRef(null);


  // Phase 1: Ref-based tracking
  const currentPitchRef = useRef(38);
  const rafId = useRef(null);
  const lastMouseMoveEvent = useRef(null);
  const draftCoordsRef = useRef([]);
  const draftSourceRef = useRef(null);

  // Sync refs for the rAF loop (avoids stale closures in handleMouseMove)
  const drawStateRef = useRef({ isDrawing: false, draftShapeType: 'polyline' });

  useEffect(() => {
    drawStateRef.current = {
      isDrawing: activeTool?.startsWith('draw-'),
      draftShapeType: toolToShapeType(activeTool)
    };
    // Sync points if the tool changes or on mount
    if (!activeTool?.startsWith('draw-')) {
      draftCoordsRef.current = [];
      onUpdatePointCount?.(0);
      if (mapRef.current) {
        const source = mapRef.current.getSource('draft-shape');
        if (source) source.setData({ type: 'FeatureCollection', features: [] });
      }
    }
  }, [activeTool, onUpdatePointCount]);

  const updateDraftPreview = useCallback(() => {
    if (!mapRef.current || !lastMouseMoveEvent.current) return;
    const { isDrawing, draftShapeType } = drawStateRef.current;
    if (!isDrawing || draftCoordsRef.current.length === 0) return;

    if (!draftSourceRef.current) {
      draftSourceRef.current = mapRef.current.getSource('draft-shape');
    }
    if (!draftSourceRef.current) return;

    const cursor = { 
      lng: lastMouseMoveEvent.current.lngLat.lng, 
      lat: lastMouseMoveEvent.current.lngLat.lat 
    };
    
    // Geometry generation outside React render
    const geojson = featureFromCoords(draftCoordsRef.current, draftShapeType, cursor);
    draftSourceRef.current.setData(geojson);
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!drawStateRef.current.isDrawing || draftCoordsRef.current.length === 0) return;
    
    lastMouseMoveEvent.current = e;
    
    if (!rafId.current) {
      rafId.current = requestAnimationFrame(() => {
        updateDraftPreview();
        rafId.current = null;
      });
    }
  }, [updateDraftPreview]);

  const [show3d, setShow3d] = useState(false);
  const roadFetchRef = useRef({ key: '', loading: false });

  const activeZone = useMemo(() => zones.find(z => z.id === activeZoneId) || zones[0], [zones, activeZoneId]);
  const isDrawing = activeTool?.startsWith('draw-');
  const draftShapeType = toolToShapeType(activeTool);
  const isSatellite = mapStyle === 'satellite';
  const show3dContext = isSatellite && show3d;

  const allZonesGeoJSON = useMemo(() => {
    return {
      type: 'FeatureCollection',
      features: zones.map(zone => {
        const coords = zoneCoordsForRender(zone);
        if (coords.length < 2) return null;
        const isArea = zone.shapeType === 'polygon' || zone.shapeType === 'rectangle';
        const feature = featureFromCoords(coords, isArea ? 'polygon' : 'polyline');
        return {
          ...feature,
          properties: {
            id: zone.id,
            isActive: zone.id === activeZoneId,
            color: zone.color || '#0ea5e9',
            isArea
          }
        };
      }).filter(Boolean)
    };
  }, [zones, activeZoneId]);

  const incidentsGeoJSON = useMemo(() => {
    return {
      type: 'FeatureCollection',
      features: liveIncidents.map(incident => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [incident.lng, incident.lat] },
        properties: {
          id: incident.id,
          type: incident.type,
          icon: ASSET_CONFIG[incident.type]?.label || '!',
          color: ASSET_CONFIG[incident.type]?.color || '#ef4444'
        }
      }))
    };
  }, [liveIncidents]);

  const interactiveLayerIds = useMemo(() => ['zones-fill', 'zones-line', 'assets-3d', 'incidents-unclustered', 'incidents-cluster'], []);

  const draftFeatureStatic = useMemo(() => {
    if (!isDrawing || draftCoords.length === 0) return { type: 'FeatureCollection', features: [] };
    return featureFromCoords(draftCoords, draftShapeType, null);
  }, [draftCoords, draftShapeType, isDrawing]);

  useEffect(() => {
    // Reset React draft state when tool changes.
    // (We can also clear the MapLibre draft source here; this effect is infrequent vs mousemove.)
    setDraftCoords([]);
    cursorPointRef.current = null;

    const source = mapRef.current?.getSource('draft-shape');
    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features: [],
      });
    }

    onUpdatePointCount?.(0);
  }, [activeTool, onUpdatePointCount]);




  useEffect(() => {
    onUpdatePointCount?.(isDrawing ? draftCoords.length : 0);
  }, [draftCoords.length, isDrawing, onUpdatePointCount]);

  const finishDraft = useCallback(() => {

    if (!isDrawing || !canFinishDraft(activeTool, draftCoords)) return;
    const shapeType = toolToShapeType(activeTool);
    const finalCoords = shapeType === 'rectangle' ? rectangleFromPoints(draftCoordsRef.current) : draftCoordsRef.current;
    onShapeDrawn?.(finalCoords, shapeType);
    draftCoordsRef.current = [];
    setDraftCoords([]);
    cursorPointRef.current = null;

    const source = mapRef.current?.getSource('draft-shape');
    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features: [],
      });
    }

    onUpdatePointCount?.(0);
  }, [activeTool, draftCoords, isDrawing, onShapeDrawn, onUpdatePointCount]);


  const undoDraftPoint = useCallback(() => {
    setDraftCoords(prev => prev.slice(0, -1));
  }, []);



  const cancelDraft = useCallback(() => {
    setDraftCoords([]);
    cursorPointRef.current = null;

    const source = mapRef.current?.getSource('draft-shape');
    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features: [],
      });
    }

    onUpdatePointCount?.(0);
  }, [onUpdatePointCount]);


  useEffect(() => {
    window.addEventListener('trigger-draw-finish', finishDraft);
    window.addEventListener('trigger-draw-undo', undoDraftPoint);
    window.addEventListener('trigger-draw-cancel', cancelDraft);
    return () => {
      window.removeEventListener('trigger-draw-finish', finishDraft);
      window.removeEventListener('trigger-draw-undo', undoDraftPoint);
      window.removeEventListener('trigger-draw-cancel', cancelDraft);
    };
  }, [cancelDraft, finishDraft, undoDraftPoint]);

  // Fix: only flyTo when activeZoneId changes, and use a ref to prevent loops
  const lastFlownId = useRef(null);
  useEffect(() => {
    if (!activeZoneId || !mapRef.current || isDrawing || lastFlownId.current === activeZoneId) return;
    const zone = zones.find(z => z.id === activeZoneId);
    if (!zone || !zone.coords?.length) return;

    lastFlownId.current = activeZoneId;
    const coords = zoneCoordsForRender(zone);
    const lngs = coords.map(c => c.lng);
    const lats = coords.map(c => c.lat);
    const center = {
      lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
      lat: (Math.min(...lats) + Math.max(...lats)) / 2
    };

    mapRef.current.flyTo({
      center: [center.lng, center.lat],
      duration: 2000,
      essential: true,
      padding: { top: 50, bottom: 50, left: 50, right: 50 },
      zoom: Math.max(mapRef.current.getZoom(), 17)
    });
  }, [activeZoneId, zones, isDrawing]);

  const ensureRoadsNear = useCallback(async (lat, lng) => {
    if (!isSnapEnabled) return roadCollection;
    const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    if (roadCollection?.features?.length && roadFetchRef.current.key === key) return roadCollection;
    if (roadFetchRef.current.loading) return roadCollection;

    roadFetchRef.current = { key, loading: true };
    const roads = await fetchRoadVectors(lat, lng, 900);
    roadFetchRef.current.loading = false;
    if (roads?.features?.length) {
      setRoadCollection?.(roads);
      return roads;
    }
    return roadCollection;
  }, [isSnapEnabled, roadCollection, setRoadCollection]);

  const maybeSnapPoint = useCallback(async ({ lat, lng }) => {
    if (!isSnapEnabled) return { lat, lng };
    const roads = await ensureRoadsNear(lat, lng);
    const snapped = snapToRoads([lat, lng], roads, 18);
    
    if (snapped) {
      // Find the specific road feature for orientation
      let bestRoad = null;
      roads.features.forEach(f => {
        if (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString') {
          // Simplified search for matching road
          bestRoad = f;
        }
      });
      return { lat: snapped[0], lng: snapped[1], road: bestRoad };

    }
    return { lat, lng };
  }, [ensureRoadsNear, isSnapEnabled]);

  const allAssets3D = useMemo(() => {
    const features = [];
    zones.forEach(zone => {
      zone.placedAssets?.forEach(asset => {
        // Create a small polygon for the asset base (e.g., 0.5m buffer)
        // Since turf.buffer is available, we use it to create a small shape
        const point = turf.point([asset.lng, asset.lat]);
        const size = asset.type === 'cone' ? 0.0004 : 0.0008; // roughly in km for buffer
        const polygon = turf.buffer(point, size, { units: 'kilometers' });
        
        features.push({
          ...polygon,
          properties: {
            id: asset.id,
            zoneId: zone.id,
            type: asset.type,
            isActive: zone.id === activeZoneId,
            height: asset.type === 'cone' ? 1.0 : 2.5, // Cones 1m, Signs 2.5m
            base: 0,
            color: ASSET_CONFIG[asset.type]?.color || '#94a3b8',
            rotation: asset.rotation || 0
          }
        });
      });
    });
    return { type: 'FeatureCollection', features };
  }, [zones, activeZoneId]);

  const handleMapClick = useCallback(async (e) => {
    // Check if we clicked an asset in the 3D layer
    const assetFeature = e.features?.find(f => f.layer?.id === 'assets-3d');
    if (assetFeature) {
      const { id, zoneId } = assetFeature.properties;
      if (zoneId === activeZoneId) {
        onAssetRemove?.(id);
      } else {
        onSelectZone?.(zoneId);
      }
      return;
    }

    const rawPoint = { lng: e.lngLat.lng, lat: e.lngLat.lat };

    if (isDrawing) {
      const snapped = await maybeSnapPoint(rawPoint);
      const isSnapped = snapped.lat !== rawPoint.lat || snapped.lng !== rawPoint.lng;
      
      const nextPoint = { ...snapped, snapped: isSnapped };
      draftCoordsRef.current = [...draftCoordsRef.current, nextPoint];
      setDraftCoords([...draftCoordsRef.current]); // Still update state for vertex markers & point count

      if (activeTool === 'draw-rectangle' && draftCoordsRef.current.length === 2) {
        const finalCoords = rectangleFromPoints(draftCoordsRef.current);
        onShapeDrawn?.(finalCoords, 'rectangle');
        draftCoordsRef.current = [];
        setDraftCoords([]);
      }
      return;
    }

    // Check if we clicked a zone area or line
    const clickedFeature = e.features?.[0];
    if (!activeTool && clickedFeature) {
      const zoneId = clickedFeature.properties.id;
      if (zoneId) {
        onSelectZone?.(zoneId);
        return;
      }
    }

    if (!activeTool) return;

    // Asset placement
    const snappedData = await maybeSnapPoint(rawPoint);
    const isSnapped = !!snappedData.road;
    const rotation = isSnapped ? getRoadOrientation([snappedData.lat, snappedData.lng], snappedData.road) : 0;
    
    if (isSnapEnabled && !isSnapped) {
      showToast?.('Road snap unavailable; placed manually');
    }

    setPlacedAssets(prev => [...prev, {
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type: activeTool,
      source: 'manual',
      lat: snappedData.lat,
      lng: snappedData.lng,
      snapped: isSnapped,
      rotation: rotation
    }]);
  }, [activeTool, isDrawing, isSnapEnabled, maybeSnapPoint, onSelectZone, setPlacedAssets, onShapeDrawn, showToast]);


  const handleMouseMoveThrottled = useMemo(() => handleMouseMove, [handleMouseMove]);


  const handleDoubleClick = useCallback((e) => {
    if (!isDrawing) return;
    e.preventDefault?.();
    finishDraft();
  }, [finishDraft, isDrawing]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', pointerEvents: isExporting ? 'none' : 'auto' }}>
      <Map
        ref={mapRef}
        preserveDrawingBuffer={true}
        initialViewState={{
          longitude: 77.209,
          latitude: 28.6139,
          zoom: 16.5,
          pitch: 38,
          bearing: -12,
        }}
        mapStyle={`https://api.maptiler.com/maps/${MAP_STYLES[mapStyle]}/style.json?key=${MAPTILER_KEY}`}
        terrain={show3dContext ? { source: 'maptiler-terrain', exaggeration: 1.0 } : undefined}
        interactiveLayerIds={interactiveLayerIds}
        maxZoom={mapStyle === 'satellite' ? 20 : 22}
        minZoom={3}
        fog={mapStyle === 'satellite' ? {
          range: [0.5, 10],
          color: '#ffffff',
          'horizon-blend': 0.1
        } : undefined}


        onClick={handleMapClick}
        onMouseMove={handleMouseMoveThrottled}
        onDblClick={handleDoubleClick}
        // Phase 1: Track pitch in a ref (no re-render), only update state when crossing threshold
        onMove={(evt) => { currentPitchRef.current = evt.viewState.pitch; }}
        onMoveEnd={(evt) => { setShow3d(isSatellite && evt.viewState.pitch > 20); }}
        maxPitch={75}
        light={{
          anchor: 'viewport',
          color: '#ffffff',
          intensity: 0.4,
          position: [1, 90, 45]
        }}
        // Phase 4: Professional MapLibre engine tuning
        fadeDuration={200}
        renderWorldCopies={false}
        maxParallelImageRequests={8}
        className={isDrawing ? 'map-drawing-crosshair' : activeTool ? 'map-asset-pointer' : 'map-grab'}
      >
        <NavigationControl position="bottom-right" visualizePitch />

        {isSatellite && (
          // Phase 3: Tile source constraints for perfect caching and no over-fetching
          <Source
            id="esri-world-imagery"
            type="raster"
            tiles={['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}']}
            tileSize={256}
            minzoom={1}
            maxzoom={19}
            crossOrigin="anonymous"
          />
        )}

        {isSatellite && (
          <Layer
            id="esri-world-imagery-layer"
            type="raster"
            source="esri-world-imagery"
          />
        )}


        {isSatellite && (
          <Source
            id="buildings-source"
            type="vector"
            url={`https://api.maptiler.com/tiles/v3/tiles.json?key=${MAPTILER_KEY}`}
          />
        )}

        {isSatellite && (
          <>
            {/* Road Blueprint Casing for High Contrast */}
            <Layer
              id="road-blueprint-casing"
              source="buildings-source"
              source-layer="transportation"
              type="line"
              paint={{
                'line-color': '#ffffff',
                'line-width': [
                  'interpolate', ['linear'], ['zoom'],
                  15, 2,
                  18, 5
                ],
                'line-opacity': 0.25,
              }}
            />

            {/* Road Blueprint Overlay for Satellite HD */}
            <Layer
              id="road-blueprint"
              source="buildings-source"
              source-layer="transportation"
              type="line"
              paint={{
                'line-color': '#0ea5e9',
                'line-width': [
                  'interpolate', ['linear'], ['zoom'],
                  15, 1,
                  18, 3
                ],
                'line-opacity': 0.6,
                'line-blur': 0.5,
              }}
            />
          </>
        )}




        {show3dContext && (
          <>
            <Source
              id="maptiler-terrain"
              type="raster-dem"
              url={`https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${MAPTILER_KEY}`}
              tileSize={512}
            />
            <Layer
              id="hillshading"
              type="hillshade"
              source="maptiler-terrain"
              paint={{
                'hillshade-exaggeration': 0.35,
                'hillshade-shadow-color': '#000000',
                'hillshade-highlight-color': '#ffffff'
              }}
            />
            <Layer
              id="3d-buildings"
              source="buildings-source"
              source-layer="building"
              filter={['has', 'render_height']}
              type="fill-extrusion"
              minzoom={14}
              paint={{
                'fill-extrusion-height': [
                  'interpolate', ['linear'], ['zoom'],
                  14.5, 0,
                  15.5, ['get', 'render_height']
                ],
                'fill-extrusion-base': ['get', 'render_min_height'],
                'fill-extrusion-color': [
                  'interpolate', ['linear'], ['get', 'render_height'],
                  0, '#38bdf8',  // Light cyan for low buildings
                  30, '#0ea5e9', // Mid blue
                  70, '#0284c7', // Deep blue for towers
                  150, '#0369a1' // Darkest for skyscrapers
                ],
                'fill-extrusion-opacity': [
                  'interpolate', ['linear'], ['zoom'],
                  14.5, 0,
                  15.5, 0.65,
                  18, 0.45
                ],
                'fill-extrusion-vertical-gradient': true,
              }}
            />
            <Layer
              id="building-outlines"
              source="buildings-source"
              source-layer="building"
              type="line"
              minzoom={15}
              paint={{
                'line-color': '#ffffff',
                'line-width': 1,
                'line-opacity': 0.3
              }}
            />
          </>
        )}

        <LocationSearch />


        <Source id="all-zones" type="geojson" data={allZonesGeoJSON}>
          <Layer
            id="zones-fill"
            type="fill"
            filter={['==', ['get', 'isArea'], true]}
            paint={{
              'fill-color': ['get', 'color'],
              'fill-opacity': [
                'case',
                ['boolean', ['get', 'isActive'], false], 0.2,
                0.08
              ]
            }}
          />
          <Layer
            id="zones-line"
            type="line"
            paint={{
              'line-color': ['get', 'color'],
              'line-width': [
                'case',
                ['boolean', ['get', 'isActive'], false], 4,
                2
              ],
              'line-dasharray': ['literal', [2, 1.4]],
              'line-opacity': [
                'case',
                ['boolean', ['get', 'isActive'], false], 1,
                0.7
              ]
            }}
          />
        </Source>

        <Source id="assets-source" type="geojson" data={allAssets3D}>
          <Layer
            id="assets-3d"
            type="fill-extrusion"
            paint={{
              'fill-extrusion-height': ['get', 'height'],
              'fill-extrusion-base': ['get', 'base'],
              'fill-extrusion-color': ['get', 'color'],
              'fill-extrusion-opacity': 0.9,
              'fill-extrusion-vertical-gradient': true,
            }}
          />
        </Source>

        {/* Removed DOM markers for incidents for performance optimization */}

        <Source 
          id="incidents-source" 
          type="geojson" 
          data={incidentsGeoJSON}
          cluster={true}
          clusterMaxZoom={14}
          clusterRadius={50}
        >
          {/* Cluster Circles: Dark Glassmorphism Effect */}
          <Layer
            id="incidents-cluster"
            type="circle"
            filter={['has', 'point_count']}
            paint={{
              'circle-color': '#ef4444',
              'circle-radius': [
                'step',
                ['get', 'point_count'],
                20,
                100, 30,
                750, 40
              ],
              'circle-opacity': 0.3,
              'circle-stroke-width': 1.5,
              'circle-stroke-color': '#ff0000',
              'circle-stroke-opacity': 0.6,
              'circle-blur': 0.2
            }}
          />

          {/* Inner Sharp Ring for Cluster */}
          <Layer
            id="incidents-cluster-inner"
            type="circle"
            filter={['has', 'point_count']}
            paint={{
              'circle-color': '#ffffff',
              'circle-opacity': 0.1,
              'circle-radius': 12,
              'circle-stroke-width': 1,
              'circle-stroke-color': '#ffffff',
              'circle-stroke-opacity': 0.4
            }}
          />

          {/* Cluster Count Text */}
          <Layer
            id="incidents-cluster-count"
            type="symbol"
            filter={['has', 'point_count']}
            layout={{
              'text-field': '{point_count}',
              'text-font': ['Noto Sans Bold', 'Arial Unicode MS Bold'],
              'text-size': 12
            }}
            paint={{
              'text-color': '#ffffff'
            }}
          />

          {/* Individual Incident Icons */}
          <Layer
            id="incidents-unclustered"
            type="symbol"
            filter={['!', ['has', 'point_count']]}
            layout={{
              'text-field': ['get', 'icon'],
              'text-font': ['Noto Sans Medium', 'Arial Unicode MS Regular'],
              'text-size': 14,
              'text-allow-overlap': true,
              'symbol-sort-key': 10
            }}
            paint={{
              'text-color': '#ffffff',
              'text-halo-color': '#ef4444',
              'text-halo-width': 2
            }}
          />
        </Source>

        <Source
          id="draft-shape"
          type="geojson"
          data={draftFeatureStatic}
        >
          {/* Render layers once; geometry is updated via draftSourceRef.setData */}
          {draftShapeType === 'polygon' && (
            <Layer
              id="draft-fill"
              type="fill"
              paint={{ 'fill-color': activeZone?.color || '#38bdf8', 'fill-opacity': 0.18 }}
            />
          )}
          <Layer
            id="draft-line"
            type="line"
            paint={{
              'line-color': activeZone?.color || '#38bdf8',
              'line-width': 4,
              'line-dasharray': ['literal', [1.2, 1.2]],
            }}
          />
        </Source>


        {isDrawing && draftCoords.map((pt, i) => (
          <Marker key={`v-${i}`} longitude={pt.lng} latitude={pt.lat} anchor="center">
            <div className={`vertex-marker ${pt.snapped ? 'snapped' : ''}`}>
              {i + 1}
            </div>
          </Marker>
        ))}

        {/* TOP-LEVEL LABELS (Ensures they stay above 3D buildings and imagery) */}
        {isSatellite && (
          <>
            <Layer
              id="place-labels"
              source="buildings-source"
              source-layer="place"
              type="symbol"
              layout={{
                'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name'], ''],
                'text-font': ['Noto Sans Bold', 'Arial Unicode MS Bold'],
                'text-size': [
                  'interpolate', ['linear'], ['zoom'],
                  12, 14,
                  15, 18,
                  18, 24
                ],
                'text-letter-spacing': 0.02,
                'text-transform': 'uppercase',
                'text-allow-overlap': true,
                'text-ignore-placement': true,
                'text-padding': 2
              }}
              paint={{
                'text-color': '#ffffff',
                'text-halo-color': 'rgba(0, 0, 0, 0.9)',
                'text-halo-width': 3,
                'text-halo-blur': 1
              }}
            />

            <Layer
              id="poi-labels"
              source="buildings-source"
              source-layer="poi"
              type="symbol"
              minzoom={12}
              layout={{
                'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name'], ''],
                'text-font': ['Noto Sans Medium', 'Arial Unicode MS Regular'],
                'text-size': [
                  'interpolate', ['linear'], ['zoom'],
                  13, 11,
                  16, 14
                ],
                'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
                'text-radial-offset': 0.8,
                'text-justify': 'auto',
                'text-allow-overlap': false
              }}
              paint={{
                'text-color': '#f8fafc',
                'text-halo-color': 'rgba(15, 23, 42, 0.9)',
                'text-halo-width': 2
              }}
            />

            <Layer
              id="natural-labels"
              source="buildings-source"
              source-layer="water_name"
              type="symbol"
              layout={{
                'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name'], ''],
                'text-font': ['Noto Sans Italic', 'Arial Unicode MS Regular'],
                'text-size': 13
              }}
              paint={{
                'text-color': '#7dd3fc',
                'text-halo-color': 'rgba(15, 23, 42, 0.8)',
                'text-halo-width': 1.5
              }}
            />

            <Layer
              id="street-labels"
              source="buildings-source"
              source-layer="transportation_name"
              type="symbol"
              minzoom={15}
              layout={{
                'text-field': '{name}',
                'text-font': ['Noto Sans Medium', 'Arial Unicode MS Regular'],
                'text-size': [
                  'interpolate', ['linear'], ['zoom'],
                  15, 10,
                  18, 13
                ],
                'symbol-placement': 'line',
                'text-rotation-alignment': 'map',
                'text-pitch-alignment': 'viewport',
                'text-max-angle': 30
              }}
              paint={{
                'text-color': '#ffffff',
                'text-halo-color': 'rgba(0,0,0,0.8)',
                'text-halo-width': 2
              }}
            />
          </>
        )}
      </Map>

      <div className="map-style-toggle">
        <button
          onClick={() => setMapStyle('dark')}
          className={mapStyle === 'dark' ? 'active' : ''}
        >
          Dark
        </button>
        <button
          onClick={() => setMapStyle('satellite')}
          className={mapStyle === 'satellite' ? 'active' : ''}
        >
          Satellite HD
        </button>
      </div>
    </div>
  );
};

export default memo(MapArea);
