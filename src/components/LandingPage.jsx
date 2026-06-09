import React, { useEffect, useRef, useState } from 'react';
import Map, { Source, Layer, Marker } from 'react-map-gl/maplibre';
import { gsap } from 'gsap';
import { Link } from 'react-router-dom';
import { Map as MapIcon, ShieldCheck, Activity, ArrowRight, Layers } from 'lucide-react';
import RealisticBackground from './login/RealisticBackground.jsx';

const MOCK_ZONES = [{
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[[77.218, 28.630], [77.220, 28.630], [77.220, 28.633], [77.218, 28.633], [77.218, 28.630]]]
  },
  properties: { id: 1, name: 'Main Sector' }
}];

const NeumorphicPanel = ({ children, title, icon: Icon, className = "" }) => (
  <div className={`flex flex-col bg-white/[0.02] backdrop-blur-[24px] border border-white/5 rounded-3xl overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.4)] ${className}`}>
    {title && (
      <div className="flex items-center gap-3 px-6 py-5 border-b border-white/5">
        {Icon && <Icon size={18} className="text-indigo-400" />}
        <span className="text-sm font-semibold tracking-wide text-gray-200">{title}</span>
      </div>
    )}
    <div className="flex-1 p-6">
      {children}
    </div>
  </div>
);

const LandingPage = () => {
  const mapRef = useRef();
  const [stats, setStats] = useState({ zones: 0, compliance: 0 });

  useEffect(() => {
    const target = { z: 0, c: 0 };
    gsap.to(target, {
      z: 56, c: 99.2,
      duration: 2,
      ease: "power3.out",
      onUpdate: () => setStats({ 
        zones: Math.floor(target.z), 
        compliance: target.c.toFixed(1)
      })
    });
  }, []);

  return (
    <div className="fixed inset-0 bg-[#09090b] text-white font-sans overflow-hidden select-none">
      <RealisticBackground isExiting={false} />
      
      {/* Ambient Orbs */}
      <div className="absolute top-0 left-0 w-[40vw] h-[40vw] bg-indigo-600/10 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[40vw] h-[40vw] bg-sky-600/10 rounded-full blur-[100px] pointer-events-none" />

      <div className="relative z-10 h-full w-full max-w-[1600px] mx-auto grid grid-cols-12 gap-6 p-6 md:p-10">
        
        {/* Header / Intro Panel */}
        <div className="col-span-12 md:col-span-4 flex flex-col gap-6">
          <NeumorphicPanel className="h-auto">
            <h1 className="text-3xl font-extrabold mb-2 bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">Marg Rakshak</h1>
            <p className="text-sm text-gray-400 leading-relaxed mb-8">
              Premium traffic management and disaster response platform. Plan, simulate, and execute with precision.
            </p>
            <Link to="/app" className="group flex items-center justify-between w-full p-4 bg-gradient-to-r from-indigo-500 to-blue-500 hover:from-indigo-400 hover:to-blue-400 text-white rounded-xl transition-all shadow-[0_4px_16px_rgba(99,102,241,0.3)]">
              <span className="font-semibold text-sm">Open Workspace</span>
              <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
            </Link>
          </NeumorphicPanel>

          <NeumorphicPanel title="System Status" icon={Activity} className="flex-1">
            <div className="grid grid-cols-2 gap-4 h-full">
              <div className="bg-white/5 rounded-2xl p-4 flex flex-col justify-center">
                <span className="text-xs text-gray-400 mb-1">Active Zones</span>
                <span className="text-3xl font-bold text-white">{stats.zones}</span>
              </div>
              <div className="bg-white/5 rounded-2xl p-4 flex flex-col justify-center">
                <span className="text-xs text-gray-400 mb-1">Compliance</span>
                <span className="text-3xl font-bold text-white">{stats.compliance}%</span>
              </div>
              <div className="col-span-2 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl p-4 flex items-center gap-4">
                <ShieldCheck size={24} className="text-indigo-400" />
                <div>
                  <h4 className="text-sm font-semibold text-gray-200">All Systems Nominal</h4>
                  <p className="text-xs text-gray-500">Security protocols active.</p>
                </div>
              </div>
            </div>
          </NeumorphicPanel>
        </div>

        {/* Map Panel */}
        <NeumorphicPanel className="col-span-12 md:col-span-8 !p-2" title="Global Overview" icon={MapIcon}>
          <div className="w-full h-full rounded-[20px] overflow-hidden relative border border-white/10">
            <Map
              ref={mapRef}
              initialViewState={{ longitude: 77.2090, latitude: 28.6139, zoom: 13, pitch: 30 }}
              mapStyle="https://api.maptiler.com/maps/streets-v2-dark/style.json?key=cxN8sHcrbJ8xB21xDxDj"
              interactive={false}
            >
              <Source type="geojson" data={{ type: 'FeatureCollection', features: MOCK_ZONES }}>
                <Layer id="z-f" type="fill" paint={{ 'fill-color': '#6366f1', 'fill-opacity': 0.15 }} />
                <Layer id="z-l" type="line" paint={{ 'line-color': '#6366f1', 'line-width': 2 }} />
              </Source>
              
              <Marker longitude={77.2190} latitude={28.6315}>
                <div className="relative">
                  <div className="absolute inset-0 bg-indigo-500 rounded-full animate-ping opacity-50" />
                  <div className="relative w-4 h-4 bg-indigo-500 rounded-full border-2 border-white shadow-lg" />
                </div>
              </Marker>
            </Map>
          </div>
        </NeumorphicPanel>

      </div>
    </div>
  );
};

export default LandingPage;