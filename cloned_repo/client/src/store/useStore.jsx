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
  
  // Initialize activeZoneId after zones are created
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

  updateActiveZone: (patch) => set((state) => ({
    zones: state.zones.map(z => z.id === state.activeZoneId ? { ...z, ...patch } : z)
  })),

  setZones: (zones) => set({ zones }),

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

// Initialize the first activeZoneId
const initialZones = useStore.getState().zones;
if (initialZones.length > 0) {
  useStore.setState({ activeZoneId: initialZones[0].id });
}

export default useStore;
