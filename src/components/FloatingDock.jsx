// src/components/FloatingDock.jsx
import React, { useState } from 'react';
import { 
  Square, 
  TrafficCone, 
  Truck, 
  Construction, 
  User, 
  Shield, 
  Activity, 
  PlusCircle, 
  Octagon, 
  Ban, 
  Undo2, 
  Redo2, 
  Trash2, 
  Magnet, 
  Hexagon, 
  Spline, 
  Library,
  X,
  Check,
  RotateCcw,
  Timer,
  ChevronsLeft,
  ChevronsRight
} from 'lucide-react';
import useStore from '../store/useStore';

const SIGN_LIBRARY = {
  'Warning': [
    { type:'sign-roadwork',icon: Construction, label:'Road Work Ahead', color: '#f97316' },
    { type:'sign-merge',   icon: PlusCircle,   label:'Lane Merge', color: '#f59e0b' },
    { type:'sign-slow',    icon: Timer,        label:'Slow Down', color: '#facc15' },
    { type:'sign-detour',  icon: RotateCcw,    label:'Detour', color: '#10b981' },
    { type:'sign-menwork', icon: User,         label:'Men at Work', color: '#f97316' },
    { type:'sign-endwork', icon: Construction, label:'End of Work', color: '#10b981' },
  ],
  'Regulatory': [
    { type:'sign-stop',   icon: Octagon,      label:'Stop', color: '#ef4444' },
    { type:'sign-speed30',label:'30',         color: '#facc15' },
    { type:'sign-speed50',label:'50',         color: '#facc15' },
    { type:'sign-nopark', icon: Ban,          label:'No Parking', color: '#ef4444' },
  ],
  'Control': [
    { type:'cone',   icon: TrafficCone, label:'Traffic Cone', color: '#f97316' },
    { type:'barrier',icon: Square,      label:'Water Barrier', color: '#3b82f6' },
    { type:'truck',  icon: Truck,       label:'TMA Truck', color: '#8b5cf6' },
    { type:'sign',   icon: Construction,label:'Signal', color: '#eab308' },
  ],
  'Personnel': [
    { type:'flagger',   icon: User,     label:'Flagger', color: '#10b981' },
    { type:'supervisor',icon: Shield,   label:'Supervisor', color: '#6366f1' },
    { type:'marshal',   icon: Shield,   label:'Traffic Marshal', color: '#f43f5e' },
    { type:'firstaid',  icon: Activity, label:'First Aid', color: '#ef4444' },
  ],
};

const drawEvent = (name) => window.dispatchEvent(new CustomEvent(name));

const FloatingDock = ({ onClear, showToast }) => {
  const {
    activeTool, setActiveTool, isSnapEnabled, setIsSnapEnabled,
    undo, redo, history, redoStack, drawPointCount, getActiveZone, zones
  } = useStore();

  const isDrawing = activeTool?.startsWith('draw-');
  const [showSignPanel, setShowSignPanel] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  const finishDrawing = (e) => { e?.stopPropagation?.(); drawEvent('trigger-draw-finish'); };
  const undoLastPoint = (e) => { e?.stopPropagation?.(); drawEvent('trigger-draw-undo'); };
  const cancelDrawing = (e) => { e?.stopPropagation?.(); drawEvent('trigger-draw-cancel'); setActiveTool(null); };

  const canFinish = drawPointCount >= (activeTool === 'draw-polygon' ? 3 : 2);
  const activeZone = getActiveZone();
  const zoneColor = activeZone?.color || '#0ea5e9';
  const zoneName  = activeZone?.name  || 'Zone';
  const zonesCount = (zones?.length ?? 0);


  const canUndo = (history?.length ?? 0) > 0;
  const canRedo = (redoStack?.length ?? 0) > 0;


  return (
    <div className="floating-dock-container animate-entrance-dock">

      {activeZone && !isDrawing && isExpanded && (
        <div className="dock-zone-pill" style={{borderColor:zoneColor,color:zoneColor}}>
          <span className="dock-zone-swatch" style={{background:zoneColor}}/>
          <span>{zoneName}</span>
          {zonesCount > 1 && <span className="dock-zone-count">{zonesCount} zones</span>}
        </div>
      )}

      {isDrawing && (
        <div className="drawing-hud-wrapper">
          <div className="drawing-controls" role="status" aria-live="polite">
            <div className="draw-hud">
              <div className="draw-hud-counter">
                <span className="draw-hud-num">{drawPointCount}</span>
                <span className="draw-hud-label">
                  {drawPointCount === 0
                    ? `Drawing on ${zoneName} — click map to place first point`
                    : drawPointCount < (activeTool==='draw-polygon'?3:2)
                    ? `Need ${(activeTool==='draw-polygon'?3:2) - drawPointCount} more point(s)`
                    : '✓ Ready to finish — click Finish or double-click'}
                </span>
              </div>
              <div className="draw-hud-bar">
                <div className="draw-hud-fill" style={{
                  width:`${Math.min(100,(drawPointCount/Math.max(activeTool==='draw-polygon'?3:2,drawPointCount))*100)}%`,
                  background: canFinish ? '#10b981' : zoneColor,
                }}/>
              </div>
            </div>
            <div className="draw-action-row">
              <button onClick={finishDrawing} disabled={!canFinish} className="draw-action-btn draw-finish" style={{opacity:canFinish?1:0.45}}>
                <Check size={14} style={{marginRight: 4}} /> Finish
              </button>
              <button onClick={undoLastPoint} disabled={drawPointCount===0} className="draw-action-btn draw-undo">
                <Undo2 size={14} style={{marginRight: 4}} /> Undo
              </button>
              <button onClick={cancelDrawing} className="draw-action-btn draw-cancel">
                <X size={14} style={{marginRight: 4}} /> Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showSignPanel && !isDrawing && isExpanded && (
        <div className="sign-panel" role="dialog" aria-label="Sign and asset library">
          <div className="sign-panel-header">
            <span>Sign & Asset Library</span>
            <button className="sign-panel-close" onClick={()=>setShowSignPanel(false)}>✕</button>
          </div>
          {Object.entries(SIGN_LIBRARY).map(([category,items])=>(
            <div key={category} className="sign-category">
              <div className="sign-category-label">{category}</div>
              <div className="sign-grid">
                {items.map(item=>(
                  <button
                    key={item.type}
                    className={`sign-item ${activeTool===item.type?'active':''}`}
                    onClick={()=>{setActiveTool(item.type);setShowSignPanel(false);}}
                  >
                    <span className="sign-item-icon" style={{color: item.color}}>
                      {item.icon ? <item.icon size={30} /> : <span style={{fontSize: 22, fontWeight: 900, color: item.color}}>{item.label}</span>}
                    </span>
                    <span className="sign-item-label">{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className={`floating-dock ${isExpanded ? 'expanded' : 'collapsed'}`} role="toolbar" aria-label="Drawing and placement tools">
        <button 
          className="dock-btn toggle-btn" 
          onClick={() => setIsExpanded(!isExpanded)}
          data-tooltip={isExpanded ? "Collapse Toolbar" : "Expand Tools"}
        >
          <span className="dock-icon">
            {isExpanded ? <ChevronsLeft size={20} /> : <ChevronsRight size={20} />}
          </span>
        </button>

        {isExpanded && (
          <>
            <div className="dock-group">
              <button className={`dock-btn ${activeTool==='draw-polygon'?'active':''}`} data-tooltip="Draw Polygon" onClick={()=>setActiveTool('draw-polygon')}
                style={activeTool==='draw-polygon'?{background:zoneColor,boxShadow:`0 0 18px ${zoneColor}88`}:{}}>
                <span className="dock-icon"><Hexagon size={20} /></span><span className="dock-label">Polygon</span>
              </button>
              <button className={`dock-btn ${activeTool==='draw-polyline'?'active':''}`} data-tooltip="Draw Path" onClick={()=>setActiveTool('draw-polyline')}
                style={activeTool==='draw-polyline'?{background:zoneColor,boxShadow:`0 0 18px ${zoneColor}88`}:{}}>
                <span className="dock-icon"><Spline size={20} /></span><span className="dock-label">Path</span>
              </button>
              <button className={`dock-btn ${activeTool==='draw-rectangle'?'active':''}`} data-tooltip="Draw Rectangle" onClick={()=>setActiveTool('draw-rectangle')}
                style={activeTool==='draw-rectangle'?{background:zoneColor,boxShadow:`0 0 18px ${zoneColor}88`}:{}}>
                <span className="dock-icon"><Square size={20} /></span><span className="dock-label">Rectangle</span>
              </button>
            </div>

            <div className="dock-divider"/>

            <div className="dock-group">
              <button 
                className={`dock-btn ${isSnapEnabled ? 'active' : ''}`} 
                onClick={() => {
                  const nextState = !isSnapEnabled;
                  setIsSnapEnabled(nextState);
                  showToast(nextState ? 'Snap to Road Enabled' : 'Snap to Road Disabled');
                }} 
                data-tooltip="Snap to Road (Turf.js + Overpass)"
                style={isSnapEnabled ? { background: '#10b981', boxShadow: '0 0 18px #10b98188' } : {}}
              >
                <span className="dock-icon"><Magnet size={20} /></span><span className="dock-label">Snap</span>
              </button>
            </div>

            <div className="dock-divider"/>

            <div className="dock-group">
              <button className={`dock-btn ${activeTool==='cone'?'active':''}`} data-tooltip="Traffic Cone" onClick={()=>setActiveTool('cone')}>
                <span className="dock-icon"><TrafficCone size={20} color="#f97316" /></span><span className="dock-label">Cone</span>
              </button>
              <button className={`dock-btn ${activeTool==='barrier'?'active':''}`} data-tooltip="Water Barrier" onClick={()=>setActiveTool('barrier')}>
                <span className="dock-icon"><Square size={20} color="#3b82f6" /></span><span className="dock-label">Barrier</span>
              </button>
              <button className={`dock-btn ${activeTool==='truck'?'active':''}`} data-tooltip="TMA Truck" onClick={()=>setActiveTool('truck')}>
                <span className="dock-icon"><Truck size={20} color="#8b5cf6" /></span><span className="dock-label">TMA</span>
              </button>
              <button className={`dock-btn ${showSignPanel?'active':''}`} data-tooltip="Sign Library" onClick={()=>setShowSignPanel(v=>!v)}>
                <span className="dock-icon"><Library size={20} /></span><span className="dock-label">Library</span>
              </button>
            </div>

            <div className="dock-divider"/>

            <div className="dock-group">
              <button className="dock-btn" onClick={undo} disabled={!canUndo} data-tooltip="Undo (Ctrl+Z)" style={{color:canUndo?'#94a3b8':'#334155'}}>
                <span className="dock-icon"><Undo2 size={18} /></span><span className="dock-label">Undo</span>
              </button>
              <button className="dock-btn" onClick={redo} disabled={!canRedo} data-tooltip="Redo (Ctrl+Y)" style={{color:canRedo?'#94a3b8':'#334155'}}>
                <span className="dock-icon"><Redo2 size={18} /></span><span className="dock-label">Redo</span>
              </button>
              <button className="dock-btn" onClick={onClear} data-tooltip="Clear Zone" style={{color:'#f87171'}}>
                <span className="dock-icon"><Trash2 size={18} /></span><span className="dock-label">Clear</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default FloatingDock;
