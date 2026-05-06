# MargRakshak - AI Developer Instructions

You are an expert Senior Frontend Engineer assisting with MargRakshak, an enterprise-grade Traffic Management Plan (TMP) and disaster management web application. 

## Tech Stack
* **Core:** React, standard React Hooks (`useState`, `useEffect`, `useRef`, `useCallback`, `useMemo`).
* **Mapping:** Leaflet, `react-leaflet`, `react-leaflet-draw`.
* **Export:** `jspdf`, `html2canvas`.
* **Styling:** Vanilla CSS with a strict Dark Glassmorphism theme.

## Design Language (UI/UX)
* **Theme:** Professional, high-contrast, dark mode. It must feel like a precision engineering tool (CAD-like), not a consumer toy.
* **Variables:** Always utilize the existing CSS root variables for styling:
  * `--bg-dark: #020617;`
  * `--bg-glass: rgba(15, 23, 42, 0.70);`
  * `--accent: #0ea5e9;`
  * `--success: #10b981;`
  * `--danger: #ef4444;`
* **Accessibility:** Ensure WCAG AA compliance (e.g., do not use low-contrast text on dark backgrounds).

## System Architecture (Reference)
*   **User Layer:** Admin/Council and TMP Designer roles.
*   **Frontend Layer:** TMP Web App (React) interacting with an Interactive Map Canvas.
*   **API Gateway:** Load balancer handling Routes Export, Generation, Auth, and Map Data requests.
*   **Backend Services:**
    *   **Rules Engine Core:** CoPTTM Logic & Auto-Layout implementation.
    *   **Export Service:** Spatial data processing and PDF generation.
    *   **Map Data Service:** Integration with Google Maps (Satellite/Street) and Road Data APIs (RAMM/Mobile).
    *   **User Service:** Authentication and Identity Provider verification.
*   **Data & Storage:**
    *   **Spatial Database:** PostgreSQL + PostGIS for storing geometries.
    *   **File Storage:** AWS S3 for generated PDFs and layouts.

## Constraints & Operational Rules
1. **Frontend Lockdown:** DO NOT make any changes to the frontend code (`client/` directory) unless explicitly instructed otherwise. The architecture diagram is for context; work should focus on backend and integration layers.
2. **Conflict Resolution:** If any task conflicts with the established architecture or current codebase, stop and ask for clarification.

## Architectural Rules & State Management
1. **Multi-Zone Geometry:** The application supports drawing multiple distinct zones (Paths/Polylines and Zones/Polygons). State must ALWAYS be handled as an array of objects: `workZones = [{ id, type, coords }]`. Never mutate or overwrite it as a single object.
2. **CAD-Level Math:** Path generation relies on Haversine formulas for distance and Trigonometry (`getBearing`) for auto-rotating high-fidelity SVG assets along curves. 
3. **No Re-render Cascades:** When updating massive arrays of objects (like hundreds of `placedAssets`), YOU MUST use functional state updates (e.g., `setPlacedAssets(prev => [...prev, newAsset])`) to prevent React from unnecessarily re-mounting the Leaflet map and crashing the browser.
4. **Leaflet Event Handling:** Because Leaflet bypasses the React DOM, always use `window.dispatchEvent(new CustomEvent('...'))` to bridge UI clicks to map actions, or use `useRef` to store mutable React callbacks inside Leaflet components to avoid stale closures.
5. **Data Persistence:** The app uses `localStorage` with a `SCHEMA_VERSION`. Any changes to the core state structure must increment the schema version to prevent silent crashes on load.

## Code Generation Rules
* Do not apologize or add conversational filler.
* Output only the exact code blocks needed to solve the problem, complete with necessary imports.
* If modifying an existing file, do not remove existing features (like Waze sync, PDF export, or Undo stacks) unless explicitly instructed.