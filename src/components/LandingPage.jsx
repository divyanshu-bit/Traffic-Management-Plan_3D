import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { Environment, Float, PerspectiveCamera, ContactShadows } from '@react-three/drei';
import Map, { NavigationControl, Source, Layer, Marker } from 'react-map-gl/maplibre';
import { gsap } from 'gsap';
import { Link } from 'react-router-dom';
import { 
  Activity, AlertTriangle, Shield, Zap, Globe, Cpu, 
  Terminal, BarChart3, Radio, ArrowUpRight, Lock 
} from 'lucide-react';

// --- Simulated Data ---
const MOCK_INCIDENTS = [
  { id: 1, type: 'ACCIDENT', location: 'Connaught Place', coords: [77.2190, 28.6315], severity: 'HIGH', time: '2m ago' },
  { id: 2, type: 'HAZARD', location: 'Rajpath Margin', coords: [77.2150, 28.6139], severity: 'MEDIUM', time: '5m ago' },
  { id: 3, type: 'CONSTRUCTION', location: 'Dhaula Kuan Junction', coords: [77.1650, 28.5910], severity: 'LOW', time: '12m ago' },
];

const MOCK_ZONES = [
  {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[77.218, 28.630], [77.220, 28.630], [77.220, 28.633], [77.218, 28.633], [77.218, 28.630]]]
    },
    properties: { id: 1, name: 'CP North Zone' }
  }
];

// --- 3D Barrier Component ---
const Barrier = ({ position }) => {
  const gltf = useLoader(GLTFLoader, '/models/sign.glb');
  const modelRef = useRef();

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    if (modelRef.current) {
      modelRef.current.rotation.y = Math.sin(t / 4) / 8;
    }
  });

  return (
    <primitive 
      ref={modelRef} 
      object={gltf.scene.clone()} 
      scale={2} 
      position={position} 
      rotation={[0, -Math.PI / 4, 0]}
    />
  );
};

// --- Sub-Components ---
const GlassPanel = ({ children, title, icon: Icon, className = "" }) => (
  <div className={`flex flex-col bg-black/40 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden shadow-2xl ${className}`}>
    <div className="flex items-center justify-between px-4 py-3 bg-white/5 border-bottom border-white/5">
      <div className="flex items-center gap-2">
        {Icon && <Icon size={14} className="text-blue-400" />}
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 font-mono">{title}</span>
      </div>
      <div className="flex gap-1">
        <div className="w-1.5 h-1.5 rounded-full bg-red-500/20" />
        <div className="w-1.5 h-1.5 rounded-full bg-yellow-500/20" />
        <div className="w-1.5 h-1.5 rounded-full bg-green-500/20" />
      </div>
    </div>
    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
      {children}
    </div>
  </div>
);

const LandingPage = () => {
  const mapRef = useRef();
  const [activeIncident, setActiveIncident] = useState(null);
  const [stats, setStats] = useState({ zones: 0, compliance: 0, response: 0 });

  // Simulated Ticking Data
  useEffect(() => {
    const ctx = gsap.context(() => {
      const target = { z: 0, c: 0, r: 0 };
      gsap.to(target, {
        z: 42,
        c: 98.4,
        r: 140,
        duration: 3,
        ease: "power2.out",
        onUpdate: () => setStats({ 
          zones: Math.floor(target.z), 
          compliance: target.c.toFixed(1), 
          response: Math.floor(target.r) 
        })
      });
    });
    return () => ctx.revert();
  }, []);

  const handleIncidentClick = (incident) => {
    setActiveIncident(incident);
    mapRef.current?.flyTo({
      center: incident.coords,
      zoom: 16,
      pitch: 45,
      duration: 2000
    });
  };

  return (
    <div className="fixed inset-0 bg-[#0A0A0A] text-white font-sans overflow-hidden select-none">
      {/* Background Grid */}
      <div className="absolute inset-0 z-0 opacity-20 pointer-events-none" 
        style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(255,255,255,0.05) 1px, transparent 0)', backgroundSize: '40px 40px' }} 
      />

      {/* Main HUD Layout */}
      <div className="relative z-10 h-full w-full grid grid-cols-12 gap-4 p-4 md:p-6 lg:p-8">
        
        {/* Left Sidebar: Incident Feed */}
        <GlassPanel title="SIMULATED_FEEDS" icon={Radio} className="col-span-12 md:col-span-3">
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs font-bold text-red-500 font-mono uppercase tracking-tighter">Live Traffic Events</span>
            </div>
            {MOCK_INCIDENTS.map((inc) => (
              <div 
                key={inc.id}
                onClick={() => handleIncidentClick(inc)}
                className={`group p-3 rounded-lg border transition-all cursor-pointer ${
                  activeIncident?.id === inc.id 
                    ? 'bg-blue-500/20 border-blue-500/50' 
                    : 'bg-white/5 border-white/10 hover:border-white/20 hover:bg-white/10'
                }`}
              >
                <div className="flex justify-between items-start mb-1">
                  <div className="flex items-center gap-1.5">
                    {inc.type === 'ACCIDENT' ? <AlertTriangle size={12} className="text-red-400" /> : <Shield size={12} className="text-orange-400" />}
                    <span className="text-[10px] font-bold font-mono tracking-tight">{inc.type}</span>
                  </div>
                  <span className="text-[9px] text-gray-500 font-mono">{inc.time}</span>
                </div>
                <h4 className="text-xs font-bold mb-1 truncate">{inc.location}</h4>
                <div className="flex justify-between items-center">
                  <span className={`text-[8px] px-1.5 py-0.5 rounded font-black ${
                    inc.severity === 'HIGH' ? 'bg-red-500/20 text-red-400' : 'bg-orange-500/20 text-orange-400'
                  }`}>
                    PRIORITY_{inc.severity}
                  </span>
                  <ArrowUpRight size={10} className="text-gray-600 group-hover:text-blue-400 transition-colors" />
                </div>
              </div>
            ))}
          </div>
        </GlassPanel>

        {/* Center: Mission Map */}
        <div className="col-span-12 md:col-span-6 relative rounded-xl border border-white/10 overflow-hidden shadow-[0_0_50px_rgba(0,0,0,0.8)]">
          <Map
            ref={mapRef}
            initialViewState={{
              longitude: 77.2090,
              latitude: 28.6139,
              zoom: 13,
              pitch: 45
            }}
            mapStyle="mapbox://styles/mapbox/dark-v11"
            mapboxAccessToken={import.meta.env.VITE_MAPBOX_TOKEN}
          >
            <Source type="geojson" data={{ type: 'FeatureCollection', features: MOCK_ZONES }}>
              <Layer
                id="zone-fill"
                type="fill"
                paint={{ 'fill-color': '#3b82f6', 'fill-opacity': 0.2 }}
              />
              <Layer
                id="zone-outline"
                type="line"
                paint={{ 'line-color': '#3b82f6', 'line-width': 2, 'line-dasharray': [2, 1] }}
              />
            </Source>

            {/* Simulated 3D Assets on Map */}
            <div className="absolute inset-0 pointer-events-none">
              <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 5, 10], fov: 50 }}>
                <ambientLight intensity={0.5} />
                <spotLight position={[10, 10, 10]} intensity={1} castShadow />
                <Barrier position={[0, -1, 0]} />
                <Environment preset="city" />
              </Canvas>
            </div>

            {MOCK_INCIDENTS.map(inc => (
              <Marker key={inc.id} longitude={inc.coords[0]} latitude={inc.coords[1]}>
                <div className="relative group cursor-pointer">
                  <div className={`w-4 h-4 rounded-full border-2 border-white shadow-lg animate-bounce ${
                    inc.type === 'ACCIDENT' ? 'bg-red-500' : 'bg-orange-500'
                  }`} />
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity bg-black/80 px-2 py-1 rounded text-[8px] font-mono whitespace-nowrap">
                    {inc.location}
                  </div>
                </div>
              </Marker>
            ))}

            <div className="absolute top-4 left-4 p-4 bg-black/60 backdrop-blur-md rounded-lg border border-white/10 flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Globe size={14} className="text-blue-400 animate-spin-slow" />
                <h2 className="text-sm font-black tracking-tighter uppercase italic">Mission Control</h2>
              </div>
              <p className="text-[10px] text-gray-400 font-mono tracking-widest">GLOBAL_GIS_COORDINATION</p>
            </div>

            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-full max-w-sm px-4">
              <Link 
                to="/app" 
                className="group relative flex items-center justify-center gap-3 w-full py-4 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-xl transition-all shadow-[0_10px_30px_rgba(59,130,246,0.3)] hover:shadow-[0_15px_40px_rgba(59,130,246,0.5)] hover:-translate-y-1"
              >
                <Zap size={18} className="fill-current" />
                <span className="text-sm tracking-[0.2em] uppercase">Initialize Dashboard</span>
                <Terminal size={14} className="opacity-40 group-hover:opacity-100" />
              </Link>
            </div>
          </Map>
        </div>

        {/* Right Sidebar: Metrics & Security */}
        <div className="col-span-12 md:col-span-3 flex flex-col gap-4">
          
          <GlassPanel title="SYSTEM_STATS" icon={BarChart3}>
            <div className="grid grid-cols-1 gap-4">
              <div className="p-3 bg-white/5 rounded-lg border border-white/5">
                <span className="text-[9px] text-gray-500 font-mono uppercase block mb-1">Active Road Zones</span>
                <div className="text-2xl font-black font-mono tracking-tighter text-blue-400">{stats.zones}</div>
              </div>
              <div className="p-3 bg-white/5 rounded-lg border border-white/5">
                <span className="text-[9px] text-gray-500 font-mono uppercase block mb-1">Compliance Rating</span>
                <div className="text-2xl font-black font-mono tracking-tighter text-green-400">{stats.compliance}%</div>
                <div className="h-1 w-full bg-white/10 rounded-full mt-2 overflow-hidden">
                  <div className="h-full bg-green-500" style={{ width: `${stats.compliance}%` }} />
                </div>
              </div>
              <div className="p-3 bg-white/5 rounded-lg border border-white/5">
                <span className="text-[9px] text-gray-500 font-mono uppercase block mb-1">Avg Response (s)</span>
                <div className="text-2xl font-black font-mono tracking-tighter text-orange-400">{stats.response}</div>
              </div>
            </div>
          </GlassPanel>

          <GlassPanel title="SECURE_GATEWAY" icon={Lock} className="flex-1">
            <div className="flex flex-col h-full">
              <div className="p-4 bg-white/5 rounded-lg border border-dashed border-white/10 flex-1 flex flex-col items-center justify-center text-center">
                <Cpu size={24} className="text-blue-500 mb-4 opacity-40" />
                <h5 className="text-[10px] font-bold text-gray-300 mb-2 uppercase tracking-widest">Enterprise Architecture</h5>
                <p className="text-[9px] text-gray-500 leading-relaxed font-mono">
                  RBAC Enabled<br/>
                  TLS 1.3 Encryption<br/>
                  Geo-Redundant Sync
                </p>
              </div>
              <div className="mt-4 p-2 bg-black/40 rounded flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_5px_#22c55e]" />
                <span className="text-[8px] font-mono text-gray-400">ENCRYPTION_LAYER_STABLE</span>
              </div>
            </div>
          </GlassPanel>

        </div>

      </div>

      {/* CSS Overrides for specific needs */}
      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 2px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 10px; }
        @keyframes spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin-slow { animation: spin-slow 12s linear infinite; }
      `}} />
    </div>
  );
};

export default LandingPage;
