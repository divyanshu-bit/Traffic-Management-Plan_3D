import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
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
  const [mapStyle, setMapStyle] = useState('satellite');
  const [draftCoords, setDraftCoords] = useState([]);

  // Avoid React re-renders on every mouse move.
  const cursorPointRef = useRef(null);
  const draftSourceRef = useRef(null);


  // Phase 1: Ref-based pitch tracking — does NOT trigger React re-renders during panning
  const currentPitchRef = useRef(38);
  const [show3d, setShow3d] = useState(false);
  const lastMoveTime = useRef(0); // Phase 2: throttle ref for mouseMove
  const mapRef = useRef(null);

  const roadFetchRef = useRef({ key: '', loading: false });

  const activeZone = zones.find(z => z.id === activeZoneId) || zones[0];
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

  const interactiveLayerIds = useMemo(() => ['zones-fill', 'zones-line', 'assets-symbol'], []);

  const draftFeature = useMemo(() => {
    if (!isDrawing || draftCoords.length === 0) return null;
    // cursor is now ref-based (no React cursorPoint state)
    // Note: mousemove updates draft preview via draftSourceRef.setData
    return featureFromCoords(draftCoords, draftShapeType, null);
  }, [draftCoords, draftShapeType, isDrawing]);



  useEffect(() => {
    // Reset React draft state when tool changes.
    // (We can also clear the MapLibre draft source here; this effect is infrequent vs mousemove.)
    setDraftCoords([]);
    cursorPointRef.current = null;

    if (draftSourceRef.current) {
      draftSourceRef.current.setData({
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
    const finalCoords = shapeType === 'rectangle' ? rectangleFromPoints(draftCoords) : draftCoords;
    onShapeDrawn?.(finalCoords, shapeType);
    setDraftCoords([]);
    cursorPointRef.current = null;

    if (draftSourceRef.current) {
      draftSourceRef.current.setData({
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

    if (draftSourceRef.current) {
      draftSourceRef.current.setData({
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

  const allAssetsGeoJSON = useMemo(() => {
    const features = [];
    
    // Regular zone assets
    zones.forEach(zone => {
      zone.placedAssets?.forEach(asset => {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [asset.lng, asset.lat]
          },
          properties: {
            id: asset.id,
            zoneId: zone.id,
            type: asset.type,
            isActive: zone.id === activeZoneId,
            snapped: asset.snapped || false,
            rotation: asset.rotation || 0,
            color: ASSET_CONFIG[asset.type]?.color || '#94a3b8'
          }
        });
      });
    });

    // Live incidents
    liveIncidents.forEach(incident => {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [incident.lng, incident.lat]
        },
        properties: {
          id: incident.id,
          type: incident.type,
          isActive: true,
          isIncident: true,
          color: ASSET_CONFIG[incident.type]?.color || '#ef4444'
        }
      });
    });

    return {
      type: 'FeatureCollection',
      features
    };
  }, [zones, activeZoneId, liveIncidents]);

  const handleMapClick = useCallback(async (e) => {
    const assetFeature = e.features?.find(f => f.layer?.id === 'assets-symbol');
    if (assetFeature) {
      const { id, zoneId, isIncident } = assetFeature.properties;
      if (isIncident) return; // Incident clicks maybe later
      if (zoneId === activeZoneId) {
        onAssetRemove?.(id);
      } else {
        onSelectZone?.(zoneId);
      }
      return;
    }

    const clickedZone = e.features?.find(feature => feature.layer?.id?.startsWith('line-') || feature.layer?.id?.startsWith('fill-'));
    const rawPoint = { lng: e.lngLat.lng, lat: e.lngLat.lat };

    if (isDrawing) {
      const snapped = await maybeSnapPoint(rawPoint);
      const isSnapped = snapped.lat !== rawPoint.lat || snapped.lng !== rawPoint.lng;
      
      setDraftCoords(prev => {
        const next = [...prev, { ...snapped, snapped: isSnapped }];
        if (activeTool === 'draw-rectangle' && next.length === 2) {
          // Finish rectangle immediately on second click
          setTimeout(() => {
            const finalCoords = rectangleFromPoints(next);
            onShapeDrawn?.(finalCoords, 'rectangle');
            setDraftCoords([]);
            cursorPointRef.current = null;
            if (draftSourceRef.current) {
              draftSourceRef.current.setData({
                type: 'FeatureCollection',
                features: [],
              });
            }
            onUpdatePointCount?.(0);
          }, 10);

          return next;
        }
        return next;
      });
      return;
    }

    if (!activeTool) {
      if (clickedZone) {
        const id = clickedZone.layer.id.replace(/^line-|^fill-/, '');
        onSelectZone?.(id);
      }
      return;
    }

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
  }, [activeTool, isDrawing, isSnapEnabled, maybeSnapPoint, onSelectZone, setPlacedAssets, onShapeDrawn, onUpdatePointCount, showToast]);


  const handleMouseMove = useCallback((e) => {
    if (!isDrawing || draftCoords.length === 0) return;

    // Throttle to ~60fps without calling React state.
    const now = performance.now();
    if (now - lastMoveTime.current < 16) return;
    lastMoveTime.current = now;

    const cursor = { lng: e.lngLat.lng, lat: e.lngLat.lat };
    cursorPointRef.current = cursor;

    if (!draftSourceRef.current) return;

    // Build only lightweight draft geometry; keep render path clean.
    const geojson = featureFromCoords(draftCoords, draftShapeType, cursor);
    draftSourceRef.current.setData(geojson);
  }, [draftCoords, draftShapeType, isDrawing]);


  const handleDoubleClick = useCallback((e) => {
    if (!isDrawing) return;
    e.preventDefault?.();
    finishDraft();
  }, [finishDraft, isDrawing]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Map
        ref={mapRef}
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
        onMouseMove={handleMouseMove}
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
            beforeId="road-blueprint-casing"
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
              source-layer="road"
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
              source-layer="road"
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
                  14, 0,
                  15, ['*', 1.0, ['get', 'render_height']]
                ],
                'fill-extrusion-base': ['get', 'render_min_height'],
                'fill-extrusion-color': '#38bdf8', // Brighter cyan glass
                'fill-extrusion-opacity': [
                  'interpolate', ['linear'], ['zoom'],
                  14, 0,
                  15, 0.6,
                  19, 0.5
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
                ['boolean', ['get', 'isActive'], false], 0.16,
                0.07
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

        <Source id="all-assets" type="geojson" data={allAssetsGeoJSON}>
          {/* Base circle for all assets (Glassmorphism effect) */}
          <Layer
            id="assets-circle"
            type="circle"
            paint={{
              'circle-radius': [
                'interpolate', ['linear'], ['zoom'],
                15, 6,
                18, 16,
                20, 22
              ],
              'circle-color': ['get', 'color'],
              'circle-opacity': [
                'case',
                ['boolean', ['get', 'isActive'], false], 0.9,
                0.6
              ],
              'circle-stroke-width': [
                'case',
                ['boolean', ['get', 'isActive'], false], 2,
                1
              ],
              'circle-stroke-color': '#ffffff',
              'circle-blur': 0.1
            }}
          />
          {/* Symbol layer for the actual icon/label */}
          <Layer
            id="assets-symbol"
            type="symbol"
            layout={{
              'text-field': ['case', ['has', 'label'], ['get', 'label'], ''],
              'text-font': ['Open Sans Bold'],
              'text-size': 12,
              'icon-image': ['get', 'type'],
              'icon-size': 0.8,
              'icon-rotate': ['get', 'rotation'],
              'icon-allow-overlap': true,
              'text-allow-overlap': true
            }}
            paint={{
              'text-color': '#ffffff'
            }}
          />
        </Source>

        <Source
          id="draft-shape"
          type="geojson"
          data={draftFeature || { type: 'FeatureCollection', features: [] }}
          ref={(src) => {
            draftSourceRef.current = src;
          }}
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
                'text-font': ['Noto Sans Bold', 'Roboto Bold', 'Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-size': [
                  'interpolate', ['linear'], ['zoom'],
                  10, 10,
                  15, 14
                ],
                'text-letter-spacing': 0.05,
                'text-transform': 'uppercase'
              }}
              paint={{
                'text-color': '#ffffff',
                'text-halo-color': 'rgba(2, 6, 23, 0.9)',
                'text-halo-width': 2
              }}
            />

            <Layer
              id="poi-labels"
              source="buildings-source"
              source-layer="poi"
              type="symbol"
              minzoom={13}
              layout={{
                'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name'], ''],
                'text-font': ['Noto Sans Regular', 'Roboto Regular', 'Open Sans Regular', 'Arial Unicode MS Regular'],
                'text-size': 10,
                'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
                'text-radial-offset': 0.6,
                'text-justify': 'auto'
              }}
              paint={{
                'text-color': '#cbd5e1',
                'text-halo-color': 'rgba(2, 6, 23, 0.8)',
                'text-halo-width': 1.5
              }}
            />

            <Layer
              id="natural-labels"
              source="buildings-source"
              source-layer="water_name"
              type="symbol"
              layout={{
                'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name'], ''],
                'text-font': ['Noto Sans Italic', 'Open Sans Italic'],
                'text-size': 12
              }}
              paint={{
                'text-color': '#38bdf8',
                'text-halo-color': 'rgba(2, 6, 23, 0.8)',
                'text-halo-width': 1
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
