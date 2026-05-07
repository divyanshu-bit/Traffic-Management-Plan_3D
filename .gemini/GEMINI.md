# Marg Rakshak: Traffic Management & Disaster Response

Marg Rakshak is a sophisticated traffic management planning tool that enables users to create detailed traffic control plans using a photorealistic 3D map interface.

## Project Overview

- **Purpose:** Provide a digital platform for traffic management, allowing for the placement of 3D assets (cones, barriers, trucks) on a real-world map with precise GIS alignment.
- **Frontend:** React 19, Vite, Three.js, MapLibre GL JS, Zustand.
- **Backend:** Node.js/Express, Socket.io (for real-time collaboration), PostgreSQL (Sequelize).
- **Core Features:**
    - Photorealistic 3D asset rendering on top of satellite imagery.
    - Automatic zone generation and asset placement based on speed limits (using Turf.js).
    - Real-time road data synchronization (Waze/Incidents).
    - Collaborative editing via WebSockets.
    - Professional PDF/Image export of traffic plans.

## Getting Started

### Prerequisites
- Node.js (Latest LTS recommended)
- PostgreSQL (for the backend database)

### Installation
1.  Clone the repository.
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Set up environment variables:
    - Create a `.env` file based on `.env.example`.
    - Required: `MAPTILER_KEY`, `DATABASE_URL`.
    - Optional: `GEMINI_API_KEY` (reserved for future AI-assisted plan generation — not yet used in the frontend).
    - Optional: `CORS_ORIGIN` (comma-separated list of allowed origins in production, e.g. `https://yourdomain.com`). If not set in production, all cross-origin requests are blocked.

### Running the App
- **Development:**
  ```bash
  npm run dev
  ```
  This starts the Express server which serves both the API and the Vite frontend.
- **Production Build:**
  ```bash
  npm run build
  ```
- **Type Checking / Lint:**
  ```bash
  npm run lint
  ```

## Architecture & Directory Structure

- `server.ts`: Express + Socket.io entry point. Vite middleware is injected in development; the pre-built `dist/` is served in production.
- `src/`: Frontend application code.
    - `components/Maparea.jsx`: The heart of the application. Integrates Three.js into MapLibre GL JS as a custom layer for 3D rendering.
    - `components/LocationSearch.jsx`: Self-contained search widget rendered inside the MapLibre `<Map>` component. Uses Nominatim for geocoding and the browser Geolocation API for GPS tracking.
    - `store/useStore.jsx`: Global state management using Zustand. **All** critical state — zones, placed assets, undo/redo history, map instance, tool selection — lives here.
    - `utils/geoSnap.js`: Road-vector fetching (Overpass API), coordinate snapping, and road-orientation calculation.
- `server/`: Backend application logic.
    - `models/`: Database schemas (Project, Zone, Asset, User).
    - `routes/`: API endpoints.
    - `services/`: Core business logic (Rules engine, S3 integration, Waze sync).
- `public/models/`: Contains the `.glb` files for 3D assets (`cone.glb`, `truck.glb`, `sign.glb`, `firstaid.glb`). If a file is missing at runtime the asset falls back to a red box placeholder and a `console.warn` is emitted — this is intentional, not a crash.

## Key Constraints & Conventions

### 3D Rendering (Maparea.jsx)
- The Three.js custom layer uses `renderingMode: '3d'`. Do **not** change this to `'2d'` — doing so breaks depth buffer handling with terrain and causes assets to render incorrectly or not at all.
- `renderer.resetState()` is called at the start of every `render()` invocation to restore Three.js's expected WebGL state after MapLibre modifies it. This line is required and must not be removed.
- The `assetGroup` (`THREE.Group`) **must** be added to the `scene` with `scene.add(assetGroup)` inside `onAdd`. It is also stored in `threeRef.current` so `update3DScene` can clear and repopulate it. Failing to add it to the scene makes all placed assets invisible with no error.
- `update3DScene` is declared with `useCallback(fn, [])` (empty deps) and reads zones via `zonesRef.current` to avoid stale closures without unnecessary re-creation.

### Draft Source Caching (Maparea.jsx)
- `draftSourceRef` caches the live-preview MapLibre `GeoJSONSource`. This reference is **nullified** in a `useEffect` that watches `mapStyle` because a style reload destroys and recreates all sources. It is lazily re-resolved inside `updateDraftPreview`. Failure to do this causes the draw preview to silently break after a style toggle.

### Road Snapping (geoSnap.js)
- `snapToRoads` only snaps to `LineString` / `MultiLineString` features whose `isBuilding` and `isObstacle` properties are both false.
- `MultiLineString` features are flattened with `turf.flatten` before passing to `turf.nearestPointOnLine`, which does not support `MultiLineString` directly in all Turf versions.
- All coordinate pairs returned by snapping functions use `[lat, lon]` order (not GeoJSON's `[lon, lat]`). This is the internal convention used throughout `Maparea.jsx` and `geoSnap.js` — be careful when calling Turf directly, which always expects `[lon, lat]`.
- `getRoadOrientation` iterates all sub-lines of a `MultiLineString` and picks the one geometrically closest to the snapped point, rather than always using `features[0]`.
- `fetchRoadVectors` filters out degenerate single-node ways (fewer than 2 coordinate pairs) before calling `turf.lineString` to avoid a Turf exception that would crash the entire fetch.

### State Management (useStore.jsx)
- **All critical state lives in the Zustand store.** Do not lift asset, zone, or tool state into parent component `useState` — it will be invisible to the undo/redo system.
- Placed assets are stored inside `zone.placedAssets` (an array on each zone object). Use the store actions `addPlacedAsset(zoneId, asset)`, `removePlacedAsset(zoneId, assetId)`, and `updatePlacedAsset(zoneId, assetId, patch)` — never mutate the array directly.
- `makeZone()` initialises `placedAssets` as an empty array. Do not pre-populate it with debug assets; use the rules engine or manual placement instead.
- The undo/redo system snapshots the entire `zones` array (deep-cloned with `JSON.parse(JSON.stringify(...))`). Keep zone objects JSON-serialisable — no class instances, no circular refs.

### Map Styles (Maparea.jsx)
- `MAP_STYLES.satellite` → `'hybrid'` (MapTiler); `MAP_STYLES.dark` → `'streets-v2-dark'`. Never set both keys to the same slug — the toggle will appear to do nothing.

### Real-time Collaboration (server.ts)
- Socket.io rooms are keyed by `reportId`. Always validate `reportId` is a non-empty string before calling `socket.join()`.
- `cursor-move` and `project-update` events are only forwarded if the emitting socket is already a member of the target room (`socket.rooms.has(reportId)`). This prevents a client from spamming arbitrary sessions.
- The presence event is named `presence-update` (not `presense-update`).
- On disconnect, presence is cleaned up across **all** rooms the socket was in — do not `break` after the first match.

### CORS (server.ts)
- In production, set the `CORS_ORIGIN` environment variable to a comma-separated list of allowed origins. In development, `http://localhost:3000` and `http://localhost:5173` are allowed automatically.
- The Socket.io CORS config mirrors the Express CORS config — keep them in sync.
- Never use a wildcard `"*"` origin on a server that handles authenticated sessions.

### Deployment
- Optimized for deployment on platforms like Netlify (frontend) and Render/Heroku (backend).
- The catch-all SPA route (`app.get('*', ...)`) is registered **after** all API routes in production to prevent API 404s from being swallowed by the HTML fallback.

## TODO & Roadmap
- [ ] Implement `KHR_materials_pbrSpecularGlossiness` to PBR conversion for all 3D models.
- [ ] Enhance road alignment logic for complex intersections.
- [ ] Complete the integration of the rules engine for automated compliance checks.
- [ ] Integrate `GEMINI_API_KEY` for AI-assisted traffic plan suggestions.
- [ ] Add API authentication middleware (JWT or session) — currently all `/api/*` routes are unprotected.