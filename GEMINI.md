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
    - Required: `GEMINI_API_KEY`, `MAPTILER_KEY`, `DATABASE_URL`.

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
- **Type Checking:**
  ```bash
  npm run lint
  ```

## Architecture & Directory Structure

- `server.ts`: The main entry point that bootstraps the Express server and integrates Vite middleware.
- `src/`: Frontend application code.
    - `components/Maparea.jsx`: The heart of the application. Integrates Three.js into MapLibre GL JS as a custom layer for 3D rendering.
    - `store/useStore.jsx`: Global state management using Zustand.
    - `utils/geoSnap.js`: Logic for snapping coordinates to roads and calculating orientations.
- `server/`: Backend application logic.
    - `models/`: Database schemas (Project, Zone, Asset, User).
    - `routes/`: API endpoints.
    - `services/`: Core business logic (Rules engine, S3 integration, Waze sync).
- `public/models/`: Contains the `.glb` files for 3D assets (cone, truck, sign, etc.).

## Key Constraints & Conventions

- **3D Rendering:** Uses `renderingMode: '2d'` in the Three.js custom layer to ensure assets are rendered on top of the map tiles without depth buffer conflicts from the terrain.
- **Coordinate System:** Uses MapLibre's `MercatorCoordinate` for precise placement of 3D objects.
- **State Management:** All critical application state (zones, assets, project metadata) should be managed through `useStore`.
- **Styling:** Tailwind CSS is used for UI components.
- **Deployment:** Optimized for deployment on platforms like Netlify (frontend) and Render/Heroku (backend).

## TODO & Roadmap
- [ ] Implement `KHR_materials_pbrSpecularGlossiness` to PBR conversion for all 3D models.
- [ ] Enhance road alignment logic for complex intersections.
- [ ] Complete the integration of the rules engine for automated compliance checks.
