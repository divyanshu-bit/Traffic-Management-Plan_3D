import { create } from 'zustand';

const ZONE_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#a78bfa', '#f43f5e', '#06b6d4', '#fb923c', '#84cc16'];

let _zoneSeq = 1;
const makeZone = (index = 0) => ({
  id: `zone-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  name: `Zone ${_zoneSeq++}`,
  color: ZONE_COLORS[index % ZONE_COLORS.length],
  coords: [],
  shapeType: 'polygon',
  approachEdgeIndices: [0],
  // FIX #1: Removed hardcoded debug assets that were pre-populated on every
  // new zone. These caused three phantom 3D objects (cone, truck, sign) to
  // appear at fixed Delhi coordinates for every zone, including newly created
  // ones. Real assets come from user placement or the rules engine.
  placedAssets: [],
  hasGenerated: false,
  speedLimit: '50',
  workZoneSpeed: '30',
  laneCount: '2',
  laneWidth: '3.5',
  surfaceType: 'Asphalt',
  gradient: '0–3%',
  closureType: 'Lane',
  roadLevel: 'Level 2',
});

const useStore = create((set, get) => ({
  // Auth & UI
  isAuthenticated: false,
  setIsAuthenticated: (val) => set({ isAuthenticated: val }),
  isLoading: false,
  setIsLoading: (val) => set({ isLoading: val }),
  showOnboarding: true,
  setShowOnboarding: (val) => set({ showOnboarding: val }),
  isSidebarOpen: true,
  setIsSidebarOpen: (val) => set((state) => ({ isSidebarOpen: typeof val === 'function' ? val(state.isSidebarOpen) : val })),

  // Project Metadata
  projectName: '',
  permitNumber: '',
  contractorName: '',
  clientName: '',
  startDate: '',
  endDate: '',
  workingHours: '07:00–17:00',
  nightWork: false,
  superintendent: '',
  safetyOfficer: '',
  emergencyContact: '',
  setProjectField: (field, value) => set({ [field]: value }),

  // Zones State
  zones: [makeZone(0)],
  activeZoneId: null,

  setActiveZoneId: (id) => set({ activeZoneId: id }),

  getActiveZone: () => {
    const { zones, activeZoneId } = get();
    return zones.find(z => z.id === activeZoneId) || zones[0];
  },

  addZone: () => set((state) => {
    const newZone = makeZone(state.zones.length);
    return {
      zones: [...state.zones, newZone],
      activeZoneId: newZone.id
    };
  }),

  deleteZone: (id) => set((state) => {
    if (state.zones.length <= 1) return state;
    const remaining = state.zones.filter(z => z.id !== id);
    return {
      zones: remaining,
      activeZoneId: state.activeZoneId === id ? remaining[0].id : state.activeZoneId
    };
  }),

  renameZone: (id, name) => set((state) => ({
    zones: state.zones.map(z => z.id === id ? { ...z, name } : z)
  })),

  updateZone: (id, patch) => set((state) => ({
    zones: state.zones.map(z => z.id === id ? { ...z, ...patch } : z)
  })),

  updateActiveZone: (patch) => set((state) => ({
    zones: state.zones.map(z => z.id === state.activeZoneId ? { ...z, ...patch } : z)
  })),

  setZones: (zones) => set({ zones }),

  // FIX #2: placedAssets moved into the Zustand store to align with the
  // convention that all critical state lives here. Previously it was lifted to
  // the parent component and passed down as a prop setter, which meant the
  // undo/redo history system in this store could never capture asset changes.
  // Assets are now stored per-zone inside zone.placedAssets (already the case
  // in the data model), and the helpers below update them immutably.
  addPlacedAsset: (zoneId, asset) => set((state) => ({
    zones: state.zones.map(z =>
      z.id === zoneId
        ? { ...z, placedAssets: [...(z.placedAssets || []), asset] }
        : z
    )
  })),

  removePlacedAsset: (zoneId, assetId) => set((state) => ({
    zones: state.zones.map(z =>
      z.id === zoneId
        ? { ...z, placedAssets: (z.placedAssets || []).filter(a => a.id !== assetId) }
        : z
    )
  })),

  updatePlacedAsset: (zoneId, assetId, patch) => set((state) => ({
    zones: state.zones.map(z =>
      z.id === zoneId
        ? { ...z, placedAssets: (z.placedAssets || []).map(a => a.id === assetId ? { ...a, ...patch } : a) }
        : z
    )
  })),

  // Waze & Incidents
  isWazeSync: false,
  setIsWazeSync: (val) => set({ isWazeSync: val }),
  incidents: [],
  setIncidents: (val) => set({ incidents: val }),

  // Generation & Progress
  isGenerating: false,
  setIsGenerating: (val) => set({ isGenerating: val }),
  genProgress: { state: '', percent: 0 },
  setGenProgress: (val) => set({ genProgress: val }),
  saveStatus: 'idle',
  setSaveStatus: (val) => set({ saveStatus: val }),
  isExporting: false,
  setIsExporting: (val) => set({ isExporting: val }),

  // Map Instance for direct control (fitBounds for PDF etc)
  mapInstance: null,
  setMapInstance: (val) => set({ mapInstance: val }),

  // History management
  history: [],
  redoStack: [],
  pushUndo: () => {
    const { zones } = get();
    set((state) => ({
      history: [...state.history.slice(-19), JSON.parse(JSON.stringify(zones))],
      redoStack: []
    }));
  },
  undo: () => set((state) => {
    if (state.history.length === 0) return state;
    const previous = state.history[state.history.length - 1];
    return {
      redoStack: [JSON.parse(JSON.stringify(state.zones)), ...state.redoStack.slice(0, 19)],
      history: state.history.slice(0, -1),
      zones: previous
    };
  }),
  redo: () => set((state) => {
    if (state.redoStack.length === 0) return state;
    const next = state.redoStack[0];
    return {
      history: [...state.history, JSON.parse(JSON.stringify(state.zones))],
      redoStack: state.redoStack.slice(1),
      zones: next
    };
  }),

  // Map & Tools
  activeTool: null,
  setActiveTool: (tool) => set({ activeTool: tool }),
  isSnapEnabled: false,
  setIsSnapEnabled: (val) => set({ isSnapEnabled: val }),
  roadCollection: null,
  setRoadCollection: (val) => set({ roadCollection: val }),
  drawPointCount: 0,
  setDrawPointCount: (val) => set({ drawPointCount: val }),
}));

// Initialize the first activeZoneId after store creation
const initialZones = useStore.getState().zones;
if (initialZones.length > 0) {
  useStore.setState({ activeZoneId: initialZones[0].id });
}

export default useStore;