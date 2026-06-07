// src/components/Sidebar.jsx
import React, { useState, useMemo, memo } from 'react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import * as turf from '@turf/turf';
import QRCode from 'qrcode';
import { PlusCircle } from 'lucide-react';
import useStore from '../store/useStore';
import { useMRAuth } from '../hooks/useMRAuth';

// ─── ASSET CATALOGUE ─────────────────────────────────────────────────────────
const ASSET_CATALOGUE = [
  { types:['cone'],          label:'Traffic Cones',         pip:'cone',       purpose:'Perimeter delineation and lane channelisation',                         standard:'Space at calculated intervals per speed limit (IRC SP 55)',       unit:'EA', cost: 150    },
  { types:['sign-roadwork'], label:'Road Work Ahead Signs', pip:'cone',       purpose:'Advance warning to approaching traffic of work zone',                   standard:'Position at minimum advance warning distance upstream',           unit:'EA', cost: 300    },
  { types:['sign-merge'],    label:'Lane Merge Signs',      pip:'cone',       purpose:'Warn drivers of lane reduction and required merge',                     standard:'Install before taper start; repeat at mid-taper if >50 m',      unit:'EA', cost: 300    },
  { types:['sign-slow'],     label:'Slow Down Signs',       pip:'cone',       purpose:'Speed reduction advisory on approach to work zone',                     standard:'Space at 50 m intervals; minimum 2 signs per approach',          unit:'EA', cost: 300    },
  { types:['sign-detour'],   label:'Detour Signs',          pip:'cone',       purpose:'Route diversion guidance for diverted road users',                      standard:'Install at all junction approaches on nominated detour route',    unit:'EA', cost: 350    },
  { types:['barrier'],       label:'Water-Filled Barriers', pip:'barrier',    purpose:'Physical separation and impact protection between traffic and workers',  standard:'Deploy at high-risk sections; anti-ram couplings (IRC §6.4)',    unit:'EA', cost: 800    },
  { types:['truck'],         label:'TMA Trucks',            pip:'truck',      purpose:'Truck-mounted attenuator — rear impact protection for work crew',       standard:'Position at tail of zone facing oncoming traffic',               unit:'EA', cost: 5000   },
  { types:['sign'],          label:'Signal / Light Points', pip:'sign',       purpose:'Temporary traffic signal control at zone entry and exit',               standard:'Min 75 m sight distance to signal head (IRC §8.3)',              unit:'EA', cost: 400    },
  { types:['flagger'],       label:'Flaggers',              pip:'flagger',    purpose:'Manual traffic control at zone boundaries during active work',           standard:'Stop/slow paddle per IRC §7.2; radio comms mandatory',           unit:'PERSON', cost: 700  },
  { types:['supervisor'],    label:'Site Supervisors',      pip:'supervisor', purpose:'On-site safety compliance oversight and incident response',              standard:'Min 1 supervisor per 200 m of active zone (IRC §5.1)',           unit:'PERSON', cost: 1200 },
  { types:['marshal'],       label:'Traffic Marshals',      pip:'marshal',    purpose:'Public guidance and pedestrian safety management',                       standard:'High-visibility tactical vest mandatory',                        unit:'PERSON', cost: 900  },
  { types:['firstaid'],      label:'First Aid Stations',    pip:'firstaid',   purpose:'Emergency medical response and trauma support unit',                     standard:'Certified trauma kit and qualified medic required',               unit:'EA', cost: 2500 },
];
const ASSET_DISPLAY = ASSET_CATALOGUE.map(a => ({ types:a.types, label:a.label, pip:a.pip }));

const haversineDist = (p1, p2) => {
  const R=6371e3, f1=(p1.lat*Math.PI)/180, f2=(p2.lat*Math.PI)/180;
  const a=Math.sin(((p2.lat-p1.lat)*Math.PI)/180/2)**2+Math.cos(f1)*Math.cos(f2)*Math.sin(((p2.lng-p1.lng)*Math.PI)/180/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
};
const polygonAreaM2 = (coords) => {
  if (!coords||coords.length<3) return 0;
  const R=6371e3, latRad=coords[0].lat*Math.PI/180;
  const pts=coords.map(c=>({x:c.lng*Math.PI/180*R*Math.cos(latRad),y:c.lat*Math.PI/180*R}));
  let area=0; for(let i=0;i<pts.length;i++){const j=(i+1)%pts.length;area+=pts[i].x*pts[j].y-pts[j].x*pts[i].y;}
  return Math.abs(area/2);
};
const fmtDist=(m)=>m>=1000?`${(m/1000).toFixed(2)} km`:`${Math.round(m)} m`;
const fmtArea=(m2)=>m2>=10000?`${(m2/10000).toFixed(2)} ha`:`${Math.round(m2).toLocaleString()} m²`;
const countByType=(assets)=>{const map={};for(const a of assets)map[a.type]=(map[a.type]||0)+1;return map;};

const SAFETY_PARAMS = {
  '30':{ coneSpacing:'12 m',taperLen:'15 m', sightDist:'60 m', advWarn:'50 m', riskLevel:'LOW',    riskRgb:[16,185,129],  standard:'IRC SP 55:2014 — Urban / Low-Speed' },
  '50':{ coneSpacing:'18 m',taperLen:'40 m', sightDist:'100 m',advWarn:'100 m',riskLevel:'MEDIUM', riskRgb:[245,158,11],  standard:'IRC SP 55:2014 — Standard Roads'    },
  '80':{ coneSpacing:'24 m',taperLen:'107 m',sightDist:'160 m',advWarn:'200 m',riskLevel:'HIGH',   riskRgb:[239,68,68],   standard:'IRC SP 55:2014 — High-Speed Roads'  },
};

// ─── FORM ATOMS ──────────────────────────────────────────────────────────────
const Field=({id,label,children,hint})=>(
  <div className="sp-field">
    <label className="sp-label" htmlFor={id}>{label}</label>
    {children}
    {hint&&<span className="sp-hint">{hint}</span>}
  </div>
);
const Select=({id,value,onChange,children,disabled})=>(
  <select id={id} className="sp-select" value={value} onChange={e=>onChange(e.target.value)} disabled={disabled}>{children}</select>
);
const Input=({id,type='text',value,onChange,placeholder,disabled,min,max})=>(
  <input id={id} type={type} className="sp-input" value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} disabled={disabled} min={min} max={max}/>
);
const Toggle=({id,label,checked,onChange,tag})=>(
  <div className="sp-toggle-row">
    <div className="sp-toggle-left">
      <label htmlFor={id} className="sp-toggle-label">{label}</label>
      {tag&&<span className="sp-tag">{tag}</span>}
    </div>
    <label className="sp-toggle-switch">
      <input id={id} type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}/>
      <span className="sp-toggle-track"><span className="sp-toggle-thumb"/></span>
    </label>
  </div>
);

// ─── SIDEBAR COMPONENT ────────────────────────────────────────────────────────
const Sidebar = ({
  isOpen, onToggle,
  onGenerate, reportId,
}) => {
  const { isAuthenticated, user, logout } = useMRAuth();
  const {
    zones, activeZoneId, getActiveZone,
    setActiveZoneId, addZone, deleteZone, renameZone, updateActiveZone,
    isWazeSync, setIsWazeSync,
    projectName, setProjectField, permitNumber, contractorName, clientName,
    startDate, endDate, workingHours, nightWork, superintendent, safetyOfficer, emergencyContact,
    customLogo, setCustomLogo,
    isGenerating, genProgress, saveStatus,
    isExporting, setIsExporting,
    isSimulating, setIsSimulating,
    mapInstance,
    sidebarPhase, setSidebarPhase
  } = useStore();

  const handleLogoChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => setCustomLogo(event.target.result);
    reader.readAsDataURL(file);
  };

  const [exportError, setExportError] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const [renameVal, setRenameVal] = useState('');

  const az = getActiveZone();
  const sp = SAFETY_PARAMS[az?.speedLimit||'50'] || SAFETY_PARAMS['50'];

  const zoneStats = useMemo(() => {
    if (!az?.coords?.length) return null;
    const isPath = az.shapeType === 'polyline';
    const loopLimit = isPath ? az.coords.length-1 : az.coords.length;
    let perim = 0;
    for (let i=0;i<loopLimit;i++) perim+=haversineDist(az.coords[i],az.coords[(i+1)%az.coords.length]);
    const area=polygonAreaM2(az.coords);
    const center={lat:az.coords.reduce((s,c)=>s+c.lat,0)/az.coords.length,lng:az.coords.reduce((s,c)=>s+c.lng,0)/az.coords.length};
    const minPerim=({30:50,50:100,80:200})[az.speedLimit]||100;
    return {perim,area,center,minPerim,compliant:perim>=minPerim,isPath};
  }, [az?.coords, az?.shapeType, az?.speedLimit]);

  const sidesOptions = useMemo(() => {
    if (!az?.coords?.length) return [];
    const isPath = az.shapeType === 'polyline';
    const numCoords = az.coords.length;
    const loopLimit = isPath ? numCoords - 1 : numCoords;
    const opts = [];
    for (let i = 0; i < loopLimit; i++) {
      const vStart = i + 1;
      const vEnd = isPath ? (i + 2) : ((i + 1) % numCoords + 1);
      opts.push({ value: i, label: `Side ${i + 1} (Vertex ${vStart} → ${vEnd})` });
    }
    return opts;
  }, [az?.coords, az?.shapeType]);

  const assetCounts = useMemo(()=>countByType(az?.placedAssets||[]),[az?.placedAssets]);
  const totalAssets = (az?.placedAssets||[]).length;

  const saveIndicator =
    saveStatus==='saving'?{label:'Saving…',cls:'saving',color:'#f59e0b'}:
    saveStatus==='error'? {label:'Save failed',cls:'error',color:'#ef4444'}:
                          {label:'Saved',cls:'',color:'#10b981'};

  const setZ = (field) => (val) => updateActiveZone({ [field]: val });
  const setP = (field) => (val) => setProjectField(field, val);

  // ── PDF GENERATOR (STRICT 6-PAGE PORTRAIT) ──────────────────────────────────
  const buildPDF = async () => {
    if (!mapInstance) { alert('Map is initialising. Please wait a moment.'); return; }
    setIsExporting(true);

    const originalStyle = useStore.getState().mapStyle;
    const setMapStyle = useStore.getState().setMapStyle;
    const originalView = {
      center:  mapInstance.getCenter(),
      zoom:    mapInstance.getZoom(),
      pitch:   mapInstance.getPitch(),
      bearing: mapInstance.getBearing(),
    };

    const pdf  = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W    = 210, H = 297, M = 15, UW = 180;
    const now  = new Date();
    const dateStr = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

    const INK = [10, 15, 30], STEEL = [30, 45, 80], ACCENT = [14, 165, 233], SILVER = [148, 163, 184];
    const RULE = [226, 232, 240], WHITE = [255, 255, 255], SURFACE = [248, 250, 252];
    const SUCCESS = [16, 185, 129], DANGER = [239, 68, 68], WARNING = [245, 158, 11];

    const F = (...a) => pdf.setFillColor(...(a.length===1 && Array.isArray(a[0]) ? a[0] : a));
    const S = (...a) => pdf.setDrawColor(...(a.length===1 && Array.isArray(a[0]) ? a[0] : a));
    const TC = (...a) => pdf.setTextColor(...(a.length===1 && Array.isArray(a[0]) ? a[0] : a));
    const FS = (n) => pdf.setFontSize(n);
    const FB = (f='helvetica') => pdf.setFont(f, 'bold');
    const FN = (f='helvetica') => pdf.setFont(f, 'normal');
    const T = (s, x, y, o) => pdf.text(String(s ?? ''), x, y, o);
    const R = (x, y, w, h, m) => pdf.rect(x, y, w, h, m || 'F');
    const LN = (x1, y1, x2, y2) => pdf.line(x1, y1, x2, y2);
    const LW = (n) => pdf.setLineWidth(n);

    const validZones = zones.filter(z => z.coords && z.coords.length > 0);
    const TOTAL_PAGES = 5 + validZones.length;
    let pageNum = 1;

    const drawFitImage = (img, tx, ty, tw, th) => {
      if (!img) return;
      try {
        const canvas = mapInstance.getCanvas();
        const canvasAspect = canvas.width / canvas.height;
        let dw = tw, dh = tw / canvasAspect;
        if (dh > th) { dh = th; dw = th * canvasAspect; }
        const ox = (tw - dw) / 2, oy = (th - dh) / 2;
        pdf.addImage(img, 'JPEG', tx + ox, ty + oy, dw, dh);
      } catch(e) { console.error('Image fit failed', e); }
    };

    const drawHeaderFooter = (sectionName) => {
      F(INK); R(0, 0, W, 8, 'F');
      TC(WHITE); FB('helvetica'); FS(9); T('MARG RAKSHAK', 15, 5.5);
      TC(ACCENT); FB('helvetica'); FS(8); T(sectionName.toUpperCase(), W/2, 5.5, {align:'center'});
      TC(SILVER); FN('helvetica'); FS(7); T(`PAGE ${pageNum} / ${TOTAL_PAGES}`, W-15, 5.5, {align:'right'});
      S(RULE); LW(0.2); LN(15, H-12, W-15, H-12);
      TC(SILVER); FN('helvetica'); FS(6); T(`${reportId} | ${dateStr}`, 15, H-8); T('CONFIDENTIAL — AUTHORISED USE ONLY', W-15, H-8, {align:'right'});
    };

    async function captureCurrentView(mapInst) {
      mapInst.triggerRepaint();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise(r => { if (mapInst.areTilesLoaded()) r(); else { mapInst.once('idle', r); setTimeout(r, 5000); } });
      mapInst.triggerRepaint();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return mapInst.getCanvas().toDataURL('image/jpeg', 0.93);
    }

    const drawIcon = (type, x, y, size = 3) => {
      S(0); LW(0.1);
      if (type === 'cone') { F(WARNING); pdf.triangle(x, y+size, x+size, y+size, x+size/2, y, 'FD'); }
      else if (type === 'barrier') { F(DANGER); R(x, y+size*0.2, size*1.2, size*0.6, 'FD'); }
      else if (type === 'truck') { F(STEEL); R(x, y+size*0.2, size*0.5, size*0.5, 'FD'); F(SUCCESS); R(x+size*0.5, y, size, size*0.7, 'FD'); }
      else if (type === 'sign') { F(SILVER); R(x+size*0.4, y, size*0.1, size, 'F'); F(ACCENT); R(x, y, size, size*0.6, 'FD'); }
    };

    const drawGridTable = (x, y, w, cols, rows, headerBg=STEEL, rowBg=SURFACE, altBg=WHITE) => {
      let cy = y; const rh = 8; F(headerBg); R(x, cy, w, rh, 'F'); TC(WHITE); FB('helvetica'); FS(7);
      cols.forEach(c => T(c.label, x + (c.offset||0) + 2, cy + 5.5)); cy+=rh;
      rows.forEach((row, ri) => {
        F(ri%2===0 ? altBg : rowBg); R(x, cy, w, rh, 'F'); S(RULE); LW(0.2); R(x, cy, w, rh, 'S'); TC(INK); FN('helvetica'); FS(7.5);
        row.forEach((cell, ci) => {
          if (!cell) return; const cx = x + (cols[ci].offset||0);
          if (typeof cell === 'object' && cell.badge) { F(cell.bg); R(cx + 2, cy + 2, 14, 4, 'F'); TC(WHITE); FB('helvetica'); FS(5); T(cell.text, cx + 9, cy + 5, {align:'center'}); TC(INK); FN('helvetica'); FS(7.5); }
          else if (typeof cell === 'object' && cell.bold) { FB('helvetica'); TC(cell.color||INK); T(String(cell.text), cx + (cols[ci].align==='right'?cols[ci].width-2:2), cy + 5.5, {align:cols[ci].align||'left'}); FN('helvetica'); TC(INK); }
          else { T(String(cell), cx + (cols[ci].align==='right'?cols[ci].width-2:2), cy + 5.5, {align:cols[ci].align||'left'}); }
        });
        cols.forEach((c,ci) => { if(ci>0) LN(x+(c.offset||0), cy, x+(c.offset||0), cy+rh); }); cy+=rh;
      });
      S(STEEL); LW(0.4); R(x, y, w, cy-y, 'S'); return cy;
    };

    const riskOrder = { 'LOW': 1, 'MEDIUM': 2, 'HIGH': 3 }; let highestRisk = 'LOW';
    validZones.forEach(z => { const r = (SAFETY_PARAMS[z.speedLimit||'50']||SAFETY_PARAMS['50']).riskLevel; if (riskOrder[r] > riskOrder[highestRisk]) highestRisk = r; });
    const grandTotalAssets = validZones.reduce((s,z) => s + (z.placedAssets?.length||0), 0);

    try {
      // --- PAGE 1: TITLE SHEET ---
      F(STEEL); R(0, 0, 40, H, 'F'); TC(WHITE); FB('times'); FS(11); T('TRAFFIC MANAGEMENT PLAN', 15, H-25, {angle: 90}); TC(ACCENT); FN('helvetica'); FS(7); T('IRC:SP:55 · GEOSPATIAL EDITION', 20, H-25, {angle: 90});
      const px = 48;
      if (customLogo) { try { pdf.addImage(customLogo, 'PNG', px, 25, 45, 16, '', 'MEDIUM'); } catch(e){} }
      else { TC(INK); FB('times'); FS(22); T('MARG RAKSHAK', px, 32); TC(SILVER); FN('helvetica'); FS(9); T('Intelligent Traffic Management Platform', px, 38); }
      TC(INK); FB('times'); FS(38); T('TRAFFIC', px, 65); T('MANAGEMENT', px, 79); TC(ACCENT); T('PLAN', px, 93); S(ACCENT); LW(0.7); LN(px, 98, px+100, 98);
      const mRows = [['DOC REF', reportId, 'ISSUED', dateStr], ['PROJECT', projectName||'—', 'TIME', timeStr], ['CLIENT', clientName||'—', 'TOTAL ZONES', String(validZones.length)], ['CONTRACTOR', contractorName||'—', 'TOTAL ASSETS', String(grandTotalAssets)], ['PERMIT NO.', permitNumber||'—', 'RISK LEVEL', highestRisk], ['WORK PERIOD', (startDate || endDate) ? `${startDate || '?'} to ${endDate || '?'}` : '—', 'NIGHT WORKS', nightWork?'YES':'NO']];
      mRows.forEach((r, i) => { const yy = 125 + i*9; TC(SILVER); FN('helvetica'); FS(6.5); T(r[0], px, yy); T(r[2], px+60, yy); TC(INK); FB('helvetica'); FS(8.5); T(r[1], px, yy+3.5); T(r[3], px+60, yy+3.5); });
      TC(SILVER); FN('helvetica'); FS(6); T('DIGITAL VERIFICATION', px, 190);
      let qrRendered = false; try { const qrData = `MARG-RAKSHAK|REF:${reportId}|DATE:${dateStr}|ZONES:${validZones.length}|ASSETS:${grandTotalAssets}`; const qrUrl = await QRCode.toDataURL(qrData, {width: 150, margin: 1}); pdf.addImage(qrUrl, 'PNG', px, 192, 25, 25); qrRendered = true; } catch(e) { console.warn('QR fail'); }
      if (!qrRendered) { S(SILVER); LW(0.2); R(px, 192, 25, 25, 'S'); TC(SILVER); FB('helvetica'); FS(10); T('QR', px+12.5, 206, {align:'center'}); }
      TC(SILVER); FN('helvetica'); FS(6); T('Scan to verify document authenticity', px, 221);
      let zsumY = 230; validZones.forEach((z, i) => { F(i%2===0 ? SURFACE : WHITE); R(px, zsumY, W-px-15, 8, 'F'); F(z.color); R(px, zsumY, 4, 8, 'F'); TC(INK); FB('helvetica'); FS(8); T(z.name, px+7, zsumY+5.5); FN('helvetica'); T(`${z.speedLimit} km/h`, px+45, zsumY+5.5); T(z.closureType||'—', px+65, zsumY+5.5); T(`${z.placedAssets?.length||0} assets`, px+95, zsumY+5.5); const rl = (SAFETY_PARAMS[z.speedLimit||'50']||SAFETY_PARAMS['50']).riskLevel; F(rl==='LOW'?SUCCESS:rl==='MEDIUM'?WARNING:DANGER); R(px+125, zsumY+2, 16, 4, 'F'); TC(WHITE); FB('helvetica'); FS(5); T(rl, px+133, zsumY+5, {align:'center'}); zsumY+=8; });

      // --- PAGE 2: SITE OVERVIEW ---
      pdf.addPage(); pageNum++; drawHeaderFooter('SITE CONTEXT: FULL OVERVIEW MAP');
      try {
        setMapStyle('satellite'); await new Promise(r => setTimeout(r, 3500));
        const allPts = validZones.flatMap(z => [...(z.coords||[]), ...(z.placedAssets||[]).map(a=>({lat:a.lat, lng:a.lng}))]);
        if (allPts.length > 0) {
          const lats = allPts.map(p=>p.lat), lngs = allPts.map(p=>p.lng);
          mapInstance.fitBounds([[Math.min(...lngs),Math.min(...lats)],[Math.max(...lngs),Math.max(...lats)]], {padding:40, animate:false});
          mapInstance.setPitch(0); mapInstance.setBearing(0); const overviewImg = await captureCurrentView(mapInstance);
          drawFitImage(overviewImg, 15, 18, 180, 240);
          F(INK); pdf.setGState(new pdf.GState({opacity: 0.85})); R(15, 18+240-15, 180, 15, 'F'); pdf.setGState(new pdf.GState({opacity: 1}));
          TC(WHITE); FB('helvetica'); FS(9); T(`ALL WORK ZONES: ${validZones.length} | TOTAL ASSETS: ${grandTotalAssets}`, 105, 18+240-5, {align:'center'});
        }
      } catch(e) { console.error('Overview map failed', e); }

      // --- PAGE 3: COMPLIANCE & BoQ ---
      pdf.addPage(); pageNum++; drawHeaderFooter('MUNICIPAL COMPLIANCE & BILL OF QUANTITIES');
      let cy = 20; const aW = (UW - 5)/2;
      const aRowsL = [['Project Name', projectName||'—'], ['Permit No.', permitNumber||'—'], ['Client/Owner', clientName||'—'], ['Contractor', contractorName||'—'], ['Superintendent', superintendent||'—'], ['Safety Officer', safetyOfficer||'—'], ['Emergency Tel.', emergencyContact||'—'], ['Work Period', startDate||'—'], ['Working Hours', workingHours||'—']];
      const aRowsR = [['Report ID', reportId], ['Generated', `${dateStr} ${timeStr}`], ['IRC Standard', 'IRC:SP:55:2014'], ['Total Zones', validZones.length], ['Total Assets', grandTotalAssets], ['Highest Risk', {badge:true, text:highestRisk, bg:highestRisk==='LOW'?SUCCESS:highestRisk==='MEDIUM'?WARNING:DANGER}], ['Approval Status', {bold:true, text:'PENDING', color:WARNING}], ['Night Works', nightWork?'YES':'NO'], ['End Date', endDate||'—']];
      drawGridTable(M, cy, aW, [{label:'PROJECT FIELD',width:35,offset:0},{label:'DETAILS',width:aW-35,offset:35}], aRowsL); drawGridTable(M+aW+5, cy, aW, [{label:'DOCUMENT FIELD',width:35,offset:0},{label:'DETAILS',width:aW-35,offset:35}], aRowsR); cy += (aRowsL.length * 8) + 12;
      TC(INK); FB('times'); FS(10); T('IRC SP:55:2014 SAFETY PARAMETERS MATRIX', M, cy); cy+=4;
      const bRows = validZones.map(z => { 
        const p = SAFETY_PARAMS[z.speedLimit||'50']||SAFETY_PARAMS['50'];
        let totalApproachLen = 0;
        if (z.coords?.length > 1) {
          const indices = z.approachEdgeIndices || [0];
          indices.forEach(idx => {
            const p1 = z.coords[idx];
            const p2 = z.coords[(idx + 1) % z.coords.length];
            if (p1 && p2) totalApproachLen += haversineDist(p1, p2);
          });
        }
        const minP = ({30:50,50:100,80:200})[z.speedLimit]||100;
        const pass = totalApproachLen >= minP;
        return [z.name, `${z.speedLimit||50} km/h`, {badge:true, text:p.riskLevel, bg:p.riskLevel==='LOW'?SUCCESS:p.riskLevel==='MEDIUM'?WARNING:DANGER}, p.taperLen, p.coneSpacing, p.sightDist, p.advWarn, z.closureType||'Lane', {badge:true, text:pass?'PASS':'FAIL', bg:pass?SUCCESS:DANGER}];
      });
      cy = drawGridTable(M, cy, UW, [{label:'ZONE',width:22,offset:0},{label:'SPEED',width:18,offset:22},{label:'RISK',width:18,offset:40},{label:'TAPER',width:20,offset:58},{label:'CONES',width:22,offset:78},{label:'SIGHT',width:20,offset:100},{label:'WARN',width:22,offset:122},{label:'CLOSURE',width:20,offset:144},{label:'STATUS',width:16,offset:164}], bRows); cy += 12;
      TC(INK); FB('times'); FS(10); T('GLOBAL BILL OF QUANTITIES — COMPLETE FLEET', M, cy); cy+=4;
      const cRows = []; let gt = 0, itemNo = 1; const gCounts = {}; validZones.forEach(z => (z.placedAssets||[]).forEach(a => gCounts[a.type] = (gCounts[a.type]||0)+1)); const days = Math.max(1, Math.ceil(( (endDate?new Date(endDate):new Date()) - (startDate?new Date(startDate):new Date()) ) / 86400000) + 1);
      ASSET_CATALOGUE.forEach(a => { const q = a.types.reduce((s,t)=>s+(gCounts[t]||0),0); if (q>0) { const rate = ({'cone':150,'barrier':800,'truck':5000,'sign':300,'light':400,'flagger':700,'supervisor':1200})[a.pip] || 0; const tot = q * rate * days; cRows.push([String(itemNo++), a.label.toUpperCase(), a.unit, String(q), `Rs. ${rate.toLocaleString('en-IN')}`, `Rs. ${tot.toLocaleString('en-IN')}`]); gt += tot; } });
      cRows.push(['', {bold:true, text:'GRAND TOTAL ESTIMATED RENTAL COST (EXCL. TAX)'}, '', '', '', {bold:true, color:ACCENT, align:'right', text:`Rs. ${gt.toLocaleString('en-IN')}`}]);
      drawGridTable(M, cy, UW, [{label:'ID',width:20,offset:0},{label:'EQUIPMENT',width:60,offset:20},{label:'UNIT',width:15,offset:80,align:'center'},{label:'QTY',width:15,offset:95,align:'center'},{label:'RATE',width:35,offset:110,align:'right'},{label:'TOTAL',width:35,offset:145,align:'right'}], cRows);
      TC(SILVER); FN('helvetica'); FS(6); T('* Costs in Indian Rupees (INR). GST extra as applicable.', M, cy + (cRows.length*8) + 14);

      // --- PAGE 4: GPS MANIFEST ---
      pdf.addPage(); pageNum++; drawHeaderFooter('DETAILED GPS DEPLOYMENT MANIFEST');
      TC(INK); FB('times'); FS(10); T('UNIT-BY-UNIT COORDINATE REFERENCE LIST', M, 25);
      const gpsRows = []; let gIdx = 1; validZones.forEach(z => (z.placedAssets||[]).forEach(a => gpsRows.length < 30 && gpsRows.push([String(gIdx++), a.type.toUpperCase(), z.name, a.lat.toFixed(6), a.lng.toFixed(6), `${Math.round(a.rotation||0)}°`, {badge:true, bg:ACCENT, text:'PLANNED'}])));
      if (gpsRows.length > 0) {
        let cygps = 29;
        const rh = 8; F(STEEL); R(M, cygps, UW, rh, 'F'); TC(WHITE); FB('helvetica'); FS(7);
        const cols = [{label:'ID',width:15,offset:0},{label:'TYPE',width:40,offset:15},{label:'ZONE',width:25,offset:55},{label:'LATITUDE',width:30,offset:80},{label:'LONGITUDE',width:30,offset:110},{label:'BEARING',width:20,offset:140},{label:'STATUS',width:20,offset:160}];
        cols.forEach(c => T(c.label, M + c.offset + 2, cygps + 5.5)); cygps+=rh;
        gpsRows.forEach((row, ri) => {
          F(ri%2===0?WHITE:SURFACE); R(M, cygps, UW, rh, 'F'); S(RULE); LW(0.2); R(M, cygps, UW, rh, 'S'); TC(INK); FN('helvetica'); FS(7.5);
          row.forEach((cell, ci) => {
            const cx = M + cols[ci].offset;
            if (ci === 6) { // STATUS Pill
              F(ACCENT); pdf.roundedRect(cx + (20-18)/2, cygps + (rh-5)/2, 18, 5, 2.5, 2.5, 'F');
              TC(WHITE); FB('helvetica'); FS(6); T('PLANNED', cx + 10, cygps + 4.2, {align:'center'});
              TC(INK); FN('helvetica'); FS(7.5);
            } else { T(String(cell), cx + 2, cygps + 5.5); }
          });
          cols.forEach((c,ci) => { if(ci>0) LN(M+c.offset, cygps, M+c.offset, cygps+rh); }); cygps+=rh;
        });
        S(STEEL); LW(0.4); R(M, 29, UW, cygps-29, 'S');
      }
      TC(SILVER); FN('helvetica'); FS(6); T('Coordinates reference: WGS84 · Accuracy: ±1m. Field verify all placements.', M, 285);

      // --- PAGE 5+: BLUEPRINTS ---
      for (const z of validZones) {
        pdf.addPage(); pageNum++; drawHeaderFooter(`ZONE BLUEPRINT: ${z.name.toUpperCase()}`);
        const mapW = 135, mapH = 235, tbX = 152, tbW = 43;
        try {
          setMapStyle('dark'); await new Promise(r => setTimeout(r, 2000));
          const pts = [...(z.coords||[]), ...(z.placedAssets||[]).map(a=>({lat:a.lat, lng:a.lng}))]; const lts = pts.map(p=>p.lat), lgs = pts.map(p=>p.lng);
          mapInstance.fitBounds([[Math.min(...lgs),Math.min(...lts)],[Math.max(...lgs),Math.max(...lts)]], {padding:80, animate:false});
          await new Promise(r => { if(mapInstance.areTilesLoaded()) r(); else { mapInstance.once('idle',r); setTimeout(r,2000); } });
          const center = { lat: lts.reduce((a,b)=>a+b,0)/lts.length, lng: lgs.reduce((a,b)=>a+b,0)/lgs.length };
          mapInstance.jumpTo({ center, zoom: mapInstance.getZoom() - 0.5, pitch: 60, bearing: -20, animate: false });
          await new Promise(r => { if(mapInstance.areTilesLoaded()) r(); else { mapInstance.once('idle',r); setTimeout(r,3000); } });
          const mapImg = await captureCurrentView(mapInstance);
          S(STEEL); LW(0.4); R(15, 25, mapW, mapH, 'D'); 
          drawFitImage(mapImg, 15, 25, mapW, mapH);
          F(INK); pdf.setGState(new pdf.GState({opacity:0.85})); R(15, 25+mapH-12, mapW, 12, 'F'); pdf.setGState(new pdf.GState({opacity:1}));
          TC(WHITE); FB('helvetica'); FS(8); T(`ZONE: ${z.name.toUpperCase()}`, 20, 25+mapH-5); T(`PITCH 60°`, 15+mapW/2, 25+mapH-5, {align:'center'}); T(`SCALE ~1:1000`, 15+mapW-5, 25+mapH-5, {align:'right'});
        } catch(e) { console.error('Map fail', e); }
        S(STEEL); LW(0.3); R(tbX, 25, tbW, 235, 'D'); let ty = 25;
        F(z.color); R(tbX, ty, tbW, 4, 'F'); ty+=4; TC(INK); FB('times'); FS(9); T(z.name.toUpperCase(), tbX+2, ty+5, {maxWidth: tbW-4}); ty+=8; TC(SILVER); FN('helvetica'); FS(6); T('WORK ZONE BLUEPRINT', tbX+2, ty+3); ty+=6;
        S(RULE); LN(tbX, ty, tbX+tbW, ty); ty+=2; TC(ACCENT); FB('helvetica'); FS(6); T('GEOMETRY', tbX+2, ty+3); ty+=6; TC(INK); FN('helvetica'); FS(7);
        let perim=0; if(z.coords?.length>1) perim=haversineDist(z.coords[0],z.coords[1]); T(`Perim: ${fmtDist(perim)}`, tbX+2, ty+3); ty+=4; T(`Area: ${fmtArea(polygonAreaM2(z.coords))}`, tbX+2, ty+3); ty+=4; T(`Vertices: ${z.coords?.length}`, tbX+2, ty+3); ty+=6;
        S(RULE); LN(tbX, ty, tbX+tbW, ty); ty+=2; TC(ACCENT); FB('helvetica'); FS(6); T('PARAMETERS', tbX+2, ty+3); ty+=6; TC(INK); FN('helvetica'); FS(7);
        T(`Speed: ${z.speedLimit} km/h`, tbX+2, ty+3); ty+=4; T(`WZ: ${z.workZoneSpeed} km/h`, tbX+2, ty+3); ty+=4; T(`Lanes: ${z.laneCount}x${z.laneWidth}m`, tbX+2, ty+3); ty+=4; T(`Surface: ${z.surfaceType}`, tbX+2, ty+3); ty+=6;
        S(RULE); LN(tbX, ty, tbX+tbW, ty); ty+=2; TC(ACCENT); FB('helvetica'); FS(6); T('IRC SP:55', tbX+2, ty+3); ty+=6; const zp=SAFETY_PARAMS[z.speedLimit||'50']||SAFETY_PARAMS['50'];
        T(`Taper: ${zp.taperLen}`, tbX+2, ty+3); ty+=4; T(`Sight: ${zp.sightDist}`, tbX+2, ty+3); ty+=4; F(zp.riskLevel==='LOW'?SUCCESS:zp.riskLevel==='MEDIUM'?WARNING:DANGER); R(tbX+2, ty+1, 16, 4, 'F'); TC(WHITE); FB('helvetica'); FS(5); T(zp.riskLevel, tbX+10, ty+4, {align:'center'}); ty+=8;
        S(RULE); LN(tbX, ty, tbX+tbW, ty); ty+=2;
        TC(ACCENT); FB('helvetica'); FS(6); T('EQUIPMENT', tbX+2, ty+3); ty+=6; TC(INK); FN('helvetica'); FS(6.5);
        const zc=countByType(z.placedAssets||[]);
        ASSET_CATALOGUE.forEach(a => {
          const c=a.types.reduce((s,t)=>s+(zc[t]||0),0);
          if(c>0){ 
            const cleanLabel = a.label.replace(' Signs','').replace(' Points','');
            T(cleanLabel, tbX+2, ty+3, {maxWidth: tbW-10}); 
            FB('helvetica'); T(String(c), tbX+tbW-2, ty+3, {align:'right'}); 
            FN('helvetica'); ty+=4.5; 
          }
        });
        S(RULE); LN(tbX, ty+2, tbX+tbW, ty+2); ty+=4; TC(ACCENT); FB('helvetica'); FS(6); T('LEGEND', tbX+2, ty+3); ty+=6;
        [['cone','Cone'],['barrier','Barrier'],['truck','TMA Truck'],['sign','Sign']].forEach((item,i) => { drawIcon(item[0], tbX+2, ty+i*6, 3); TC(INK); FN('helvetica'); FS(6); T(item[1], tbX+8, ty+3 + i*6); });
        S(INK); LW(0.3); F(INK); pdf.triangle(tbX+tbW/2, 235+25, tbX+tbW/2-3, 235+30, tbX+tbW/2+3, 235+30, 'FD'); T('N', tbX+tbW/2, 235+35, {align:'center'});
      }

      // --- PAGE LAST: SOP ---
      pdf.addPage(); pageNum++; drawHeaderFooter('SAFETY PROTOCOLS & SOPs');
      cy = 25; TC(INK); FB('times'); FS(10); T('OPERATIONAL DEPLOYMENT SEQUENCE', M, cy); cy+=5;
      const phW = (UW - 15) / 4;
      const phs = [{ t: 'PHASE 1', d: '• Position TMA truck\n• Deploy warning signs\n• Setup channelising' }, { t: 'PHASE 2', d: '• Place taper cones\n• Install merge signs\n• Deploy speed signs' }, { t: 'PHASE 3', d: '• Position flaggers\n• Activate signals\n• Commence ops' }, { t: 'PHASE 4', d: '• Remove signs\n• Clear site\n• Submit report' }];
      phs.forEach((p, i) => { const px = M + i*(phW+5); F(SURFACE); R(px, cy, phW, 40, 'F'); F(ACCENT); R(px, cy, phW, 6, 'F'); TC(WHITE); FB('helvetica'); FS(7); T(p.t, px+2, cy+4); TC(INK); FN('helvetica'); FS(6.5); T(p.d, px+2, cy+11, {maxWidth: phW-4, lineHeightFactor: 1.4}); });
      cy += 50; TC(INK); FB('times'); FS(10); T('EMERGENCY RESPONSE CONTACTS', M, cy); cy+=5;
      F(SURFACE); R(M, cy, UW, 25, 'F'); F(DANGER); R(M, cy, 3, 25, 'F'); TC(INK); FB('helvetica'); FS(7); T('POLICE: 100 | AMBULANCE: 108 | HIGHWAY: 1033', M+10, cy+8); T(`Safety: ${safetyOfficer||'—'} | Superintendent: ${superintendent||'—'}`, M+10, cy+16);
      cy += 35; F(SURFACE); R(M, cy, UW, 25, 'F'); TC(DANGER); FB('helvetica'); FS(7); T('IN CASE OF INCIDENT:', M+5, cy+6); TC(INK); FN('helvetica'); FS(7); T('1. Alert supervisor. 2. Call emergency. 3. Preserve scene. 4. Complete report.', M+5, cy+13);
      cy += 35;
      const sW = 56;
      [{t:'SITE SUPERINTENDENT',d:'Project Implementation Lead'},{t:'SAFETY OFFICER',d:'Compliance & Audit'},{t:'AUTHORITY REP.',d:'Government / Client Representative'}].forEach((s,i) => {
        const sx = M + i*(sW+5);
        F(SURFACE); R(sx, cy, sW, 45, 'F'); S(STEEL); LW(0.2); R(sx, cy, sW, 45, 'S');
        TC(STEEL); FB('helvetica'); FS(8); T(s.t, sx+2, cy+5);
        TC(SILVER); FN('helvetica'); FS(6); T(s.d, sx+2, cy+9);
        S(SILVER); LN(sx+5, cy+38, sx+sW-5, cy+38);
        T('Full Name & Designation', sx+2, cy+41);
        T('Date: _______________', sx+2, cy+44);
      });

      setMapStyle(originalStyle); await new Promise(r => setTimeout(r, 1800)); mapInstance.jumpTo({ ...originalView, animate: false });
      setIsExporting(false); pdf.save(`MargRakshak_TMP_${reportId}.pdf`);
    } catch (err) {
      console.error('PDF Error:', err); setMapStyle(originalStyle); mapInstance.jumpTo({ ...originalView, animate: false });
      setIsExporting(false); setExportError(`Export failed: ${err.message}`);
    }
  };

  const exportToPDF = async () => {
    setIsExporting(true); setExportError(null);
    try { await buildPDF(); }
    catch(e) { console.error('PDF error:', e); setExportError(`Export failed: ${e.message}`); }
    finally { setIsExporting(false); }
  };

  const PhaseBtn=({num,label,active,onClick})=>(
    <button className={`sb-phase-btn ${active?'active':''}`} onClick={onClick}>
      <span className="sb-phase-num">{num}</span>
      <span className="sb-phase-label">{label}</span>
    </button>
  );

  const hasAnyGenerated = zones.some(z => z.hasGenerated);

  return (
    <div className={`sidebar-wrapper ${!isOpen?'collapsed':''}`}>
      <aside className="main-sidebar animate-entrance-sidebar" style={{pointerEvents:isExporting?'none':'auto'}} aria-busy={isExporting}>

        {isExporting && (
          <div className="export-overlay" aria-live="assertive">
            <div className="export-overlay-inner">
              <div className="spinner spinner-light" style={{width:24,height:24,borderWidth:3}}/>
              <span>Rendering PDF…</span>
              <span className="export-overlay-sub">Building {zones.length} zone report</span>
            </div>
          </div>
        )}

        <div className="sb-header">
          <div className="sb-brand">
            <div className="sb-brand-logo">M</div>
            <div>
              <div className="sb-brand-name">Marg Rakshak</div>
              <div className="sb-brand-sub">Traffic Management System</div>
            </div>
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
            <button onClick={() => document.body.classList.toggle('light-mode')} style={{background: 'transparent', border: '1px solid var(--sb-border-2)', borderRadius: '4px', cursor: 'pointer', padding: '4px 6px', fontSize: '12px'}} title="Toggle Light Mode">☀️</button>
            
            {isAuthenticated && user && (
              <div className="sb-user-profile" style={{display:'flex', alignItems:'center', gap:'10px', background:'rgba(255,255,255,0.05)', padding:'4px 8px', borderRadius:'20px', border:'1px solid var(--sb-border-2)'}}>
                {user.picture && <img src={user.picture} alt={user.name} style={{width:24, height:24, borderRadius:'50%'}} />}
                <div style={{display:'flex', flexDirection:'column'}}>
                  <span style={{fontSize:'10px', fontWeight:700, color:'var(--sb-text-main)', maxWidth:'80px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{user.name}</span>
                  <button onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })} style={{background:'none', border:'none', color:'var(--sb-accent)', fontSize:'9px', fontWeight:800, padding:0, textAlign:'left', cursor:'pointer'}}>LOGOUT</button>
                </div>
              </div>
            )}

            {!isAuthenticated && (
              <div className={`sb-save-badge sb-save-badge--${saveIndicator.cls}`} role="status">
                <span className="sb-save-dot"/>
                {saveIndicator.label}
              </div>
            )}
          </div>
        </div>

        <div className="sb-stepper">
          <PhaseBtn num="01" label="Zones"    active={sidebarPhase===1} onClick={()=>setSidebarPhase(1)}/>
          <div className="sb-step-line"/>
          <PhaseBtn num="02" label="Env"      active={sidebarPhase===2} onClick={()=>setSidebarPhase(2)}/>
          <div className="sb-step-line"/>
          <PhaseBtn num="03" label="Logistics"active={sidebarPhase===3} onClick={()=>setSidebarPhase(3)}/>
          <div className="sb-step-line"/>
          <PhaseBtn num="04" label="Safety"   active={sidebarPhase===4} onClick={()=>setSidebarPhase(4)}/>
        </div>

        <div className="sb-body">

          {sidebarPhase===1 && (
            <div className="sb-phase-content">
              <h3 className="sb-tab-title">01 — Work Zones</h3>

              <div className="sz-zone-list">
                {zones.map((zone, idx) => {
                  const isActive = zone.id === activeZoneId;
                  const isRenaming = renamingId === zone.id;
                  return (
                    <div
                      key={zone.id}
                      className={`sz-zone-card ${isActive?'sz-zone-card--active':''}`}
                      onClick={() => { if (!isRenaming) setActiveZoneId(zone.id); }}
                    >
                      <div className="sz-zone-card-left">
                        <div className="sz-zone-swatch" style={{background:zone.color}}/>
                        <div className="sz-zone-info">
                          {isRenaming ? (
                            <input
                              className="sz-rename-input"
                              value={renameVal}
                              autoFocus
                              onChange={e=>setRenameVal(e.target.value)}
                              onBlur={()=>{renameZone(zone.id,renameVal||zone.name);setRenamingId(null);}}
                              onKeyDown={e=>{if(e.key==='Enter'){renameZone(zone.id,renameVal||zone.name);setRenamingId(null);}if(e.key==='Escape')setRenamingId(null);}}
                              onClick={e=>e.stopPropagation()}
                            />
                          ) : (
                            <div className="sz-zone-name">{zone.name}</div>
                          )}
                          <div className="sz-zone-meta">
                            {zone.speedLimit}km/h · {zone.closureType} · {zone.placedAssets.length} assets
                            {zone.coords?.length>0 && <span className="sz-zone-badge-ok"> · ✓ Boundary</span>}
                          </div>
                        </div>
                      </div>
                      <div className="sz-zone-card-actions" onClick={e=>e.stopPropagation()}>
                        <button className="sz-action-btn" title="Rename" onClick={()=>{setRenamingId(zone.id);setRenameVal(zone.name);}}>✏️</button>
                        <button className="sz-action-btn sz-action-btn--danger" title="Delete zone" onClick={()=>deleteZone(zone.id)}>🗑</button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <button className="sz-add-btn" onClick={() => { addZone(); setSidebarPhase(1); }}>
                <span>＋</span> Add Zone
              </button>

              {az && (
                <div className="sz-active-hint">
                  <span style={{color:az.color}}>◆</span> Active: <strong>{az.name}</strong>
                  {az.coords?.length===0 && <span className="sz-active-hint-tip"> — draw its boundary on the map using the tools below</span>}
                </div>
              )}
            </div>
          )}

          {sidebarPhase===2 && (
            <div className="sb-phase-content">
              <h3 className="sb-tab-title">02 — Road Environment</h3>
              {az ? (
                <>
                  <div className="sz-active-zone-pill" style={{borderColor:az.color,color:az.color}}>
                    <span style={{background:az.color,borderRadius:'50%',width:8,height:8,display:'inline-block'}}/>
                    {az.name}
                  </div>
                  <div className="sp-grid-2">
                    <Field id="speed-limit" label="Posted Speed">
                      <Select id="speed-limit" value={az.speedLimit} onChange={setZ('speedLimit')} disabled={isGenerating}>
                        <option value="30">30 km/h — Urban</option>
                        <option value="50">50 km/h — Standard</option>
                        <option value="80">80 km/h — Highway</option>
                      </Select>
                    </Field>
                    <Field id="wz-speed" label="WZ Speed">
                      <Select id="wz-speed" value={az.workZoneSpeed} onChange={setZ('workZoneSpeed')}>
                        <option value="15">15 km/h</option>
                        <option value="30">30 km/h</option>
                        <option value="50">50 km/h</option>
                      </Select>
                    </Field>
                  </div>
                  <div className="sp-grid-2">
                    <Field id="lane-count" label="Total Lanes">
                      <Select id="lane-count" value={az.laneCount} onChange={setZ('laneCount')}>
                        <option value="1">1 lane</option><option value="2">2 lanes</option><option value="4">4 lanes</option>
                      </Select>
                    </Field>
                    <Field id="lane-width" label="Lane Width">
                      <Select id="lane-width" value={az.laneWidth} onChange={setZ('laneWidth')}>
                        <option value="3.0">3.0 m</option><option value="3.5">3.5 m</option><option value="3.75">3.75 m</option>
                      </Select>
                    </Field>
                  </div>
                  <div className="sp-grid-2">
                    <Field id="surface-type" label="Road Surface">
                      <Select id="surface-type" value={az.surfaceType} onChange={setZ('surfaceType')}>
                        <option value="Asphalt">Asphalt</option><option value="Concrete">Concrete</option><option value="Gravel">Gravel</option>
                      </Select>
                    </Field>
                    <Field id="closure-type" label="Closure Type">
                      <Select id="closure-type" value={az.closureType} onChange={setZ('closureType')}>
                        <option value="Lane">Lane</option><option value="Shoulder">Shoulder</option><option value="Full">Full Road</option>
                      </Select>
                    </Field>
                  </div>
                  <div className="sp-grid-2">
                    <Field id="disable-taper" label="Taper Settings">
                      <Select 
                        id="disable-taper" 
                        value={(!az.approachEdgeIndices || az.approachEdgeIndices.length === 0) ? "disabled" : "enabled"} 
                        onChange={(val) => {
                          const disabled = val === "disabled";
                          updateActiveZone({ 
                            approachEdgeIndices: disabled ? [] : [0]
                          });
                        }}
                        disabled={isGenerating}
                      >
                        <option value="enabled">Standard (With Taper)</option>
                        <option value="disabled">Perimeter Only (No Taper)</option>
                      </Select>
                    </Field>
                    <Field id="approach-side" label="Traffic Approach Side">
                      <div className="approach-sides-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {sidesOptions.length === 0 ? (
                          <span style={{ fontSize: '12px', color: '#64748b' }}>Draw boundary first...</span>
                        ) : (
                          sidesOptions.map(opt => {
                            const isSelected = az.approachEdgeIndices?.includes(opt.value);
                            return (
                              <button
                                key={opt.value}
                                onClick={() => {
                                  if (isGenerating) return;
                                  const current = az.approachEdgeIndices || [];
                                  let newIndices;
                                  if (current.includes(opt.value)) {
                                    newIndices = current.filter(i => i !== opt.value);
                                  } else {
                                    newIndices = [...current, opt.value];
                                  }
                                  updateActiveZone({ approachEdgeIndices: newIndices, taperDisabled: newIndices.length === 0 });
                                }}
                                disabled={isGenerating}
                                style={{
                                  padding: '4px 10px',
                                  fontSize: '11px',
                                  borderRadius: '12px',
                                  border: isSelected ? '1px solid #38bdf8' : '1px solid #334155',
                                  background: isSelected ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                                  color: isSelected ? '#38bdf8' : '#94a3b8',
                                  cursor: isGenerating ? 'not-allowed' : 'pointer',
                                  transition: 'all 0.2s',
                                  outline: 'none'
                                }}
                                title={opt.label}
                              >
                                Side {opt.value + 1}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </Field>
                  </div>
                  <span className="sp-hint" style={{ display: 'block', marginTop: '-4px', marginBottom: '8px' }}>💡 Pro-Tip: You can click directly on any boundary edge on the map to select the approach side.</span>
                  <Toggle id="waze-toggle" label="Sync Road API" checked={isWazeSync} onChange={setIsWazeSync} tag="LIVE"/>
                  <div className="sp-derived-strip">
                    <div className="sp-derived-item"><span className="sp-derived-label" title="Spacing between cones">Spacing</span><span className="sp-derived-value">{sp.coneSpacing}</span></div>
                    <div className="sp-derived-item"><span className="sp-derived-label" title="Taper Length: Distance required to safely channel traffic into another lane">Taper</span><span className="sp-derived-value">{sp.taperLen}</span></div>
                    <div className="sp-derived-item"><span className="sp-derived-label">Risk</span><span className={`sp-derived-value sp-risk-${sp.riskLevel.toLowerCase()}`}>{sp.riskLevel}</span></div>
                  </div>
                </>
              ) : <p className="sb-zone-empty">Select a zone first</p>}
            </div>
          )}

          {sidebarPhase===3 && (
            <div className="sb-phase-content">
              <h3 className="sb-tab-title">03 — Site Logistics</h3>
              <Field id="project-name" label="Project Description">
                <Input id="project-name" value={projectName} onChange={setP('projectName')} placeholder="Project title"/>
              </Field>
              <div className="sp-grid-2">
                <Field id="permit-no" label="Permit No."><Input id="permit-no" value={permitNumber} onChange={setP('permitNumber')} placeholder="Permit #"/></Field>
                <Field id="client-name" label="Authority"><Input id="client-name" value={clientName} onChange={setP('clientName')} placeholder="Client"/></Field>
              </div>
              <div className="sp-grid-2">
                <Field id="start-date" label="Start Date"><Input id="start-date" type="date" value={startDate} onChange={setP('startDate')}/></Field>
                <Field id="end-date" label="End Date"><Input id="end-date" type="date" value={endDate} onChange={setP('endDate')}/></Field>
              </div>
              <div className="sp-grid-2">
                <Field id="working-hours" label="Working Hours">
                  <Input id="working-hours" value={workingHours} onChange={setP('workingHours')} placeholder="e.g. 07:00–17:00"/>
                </Field>
                <div style={{ paddingTop: '20px' }}>
                  <Toggle id="night-work" label="Night Works" checked={nightWork} onChange={setP('nightWork')} />
                </div>
              </div>
              <Field id="superintendent" label="Superintendent">
                <Input id="superintendent" value={superintendent} onChange={setP('superintendent')} placeholder="Name"/>
              </Field>
              <Field id="safety-officer" label="Safety Officer">
                <Input id="safety-officer" value={safetyOfficer} onChange={setP('safetyOfficer')} placeholder="Name"/>
              </Field>
              <Field id="emergency-contact" label="Emergency Contact">
                <Input id="emergency-contact" type="tel" value={emergencyContact} onChange={setP('emergencyContact')} placeholder="+91"/>
              </Field>

              <Field id="company-logo" label="Company Logo">
                <div className="logo-upload-container">
                  <input 
                    type="file" 
                    id="logo-upload" 
                    accept="image/png, image/jpeg" 
                    onChange={handleLogoChange}
                    className="hidden-file-input"
                  />
                  <label htmlFor="logo-upload" className="logo-upload-label">
                    {customLogo ? (
                      <div className="logo-preview-box">
                        <img src={customLogo} alt="Logo" className="logo-preview-img" />
                        <span className="logo-change-text">Change Logo</span>
                      </div>
                    ) : (
                      <div className="logo-placeholder">
                        <PlusCircle size={20} />
                        <span>Upload Logo</span>
                      </div>
                    )}
                  </label>
                </div>
              </Field>
            </div>
          )}

          {sidebarPhase===4 && (
            <div className="sb-phase-content">
              <h3 className="sb-tab-title">04 — Safety & Manifest</h3>

              <div className="sz-all-zones-summary">
                {zones.map(zone=>{
                  const isActive=zone.id===activeZoneId;
                  const zst=SAFETY_PARAMS[zone.speedLimit||'50']||SAFETY_PARAMS['50'];
                  const zHasZone=zone.coords?.length>0;
                  return(
                    <div key={zone.id} className={`sz-summary-row ${isActive?'sz-summary-row--active':''}`} onClick={()=>setActiveZoneId(zone.id)}>
                      <span className="sz-summary-swatch" style={{background:zone.color}}/>
                      <span className="sz-summary-name">{zone.name}</span>
                      <span className="sz-summary-meta">{zHasZone?'✓':''} {zone.placedAssets.length} assets</span>
                      <span className={`sz-summary-risk sz-summary-risk--${zst.riskLevel.toLowerCase()}`}>{zst.riskLevel}</span>
                    </div>
                  );
                })}
              </div>

              {az && (
                <div className="sb-zone-card" style={{margin:0,border:'none',background:'rgba(255,255,255,0.03)',borderRadius:12}}>
                  <div className="sb-zone-header">
                    <span className="sb-zone-title">{az.name} — Geometry</span>
                    {zoneStats && <span className={`sb-zone-badge ${zoneStats.compliant?'sb-zone-badge--ok':'sb-zone-badge--warn'}`}>{zoneStats.compliant?'✓ PASS':'⚠ REVIEW'}</span>}
                  </div>
                  {zoneStats?(
                    <div className="sb-zone-stats">
                      <div className="sb-zone-stat"><span className="sb-zone-stat-val">{fmtDist(zoneStats.perim)}</span> <span className="sb-zone-stat-lbl">Perimeter</span></div>
                      {!zoneStats.isPath&&<div className="sb-zone-stat"><span className="sb-zone-stat-val">{fmtArea(zoneStats.area)}</span> <span className="sb-zone-stat-lbl">Area</span></div>}
                    </div>
                  ):<p className="sb-zone-empty">Draw zone boundary first.</p>}
                </div>
              )}

              {az?.hasGenerated && (
                <div style={{ marginTop: 12 }}>
                  {!isSimulating ? (
                    <button 
                      className="sb-phase-next-btn" 
                      style={{ 
                        width: '100%', 
                        background: 'rgba(56, 189, 248, 0.1)', 
                        border: '1px solid #38bdf8', 
                        color: '#38bdf8',
                      }}
                      onClick={() => {
                        useStore.getState().setSimIsPaused(false);
                        setIsSimulating(true);
                      }}
                    >
                      🚗 Simulate Approach (3D)
                    </button>
                  ) : (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button 
                        className="sb-phase-next-btn" 
                        style={{ 
                          flex: 1, 
                          background: 'rgba(239, 68, 68, 0.15)', 
                          border: '1px solid #ef4444', 
                          color: '#ef4444',
                          boxShadow: '0 0 15px rgba(239, 68, 68, 0.2)'
                        }}
                        onClick={() => setIsSimulating(false)}
                      >
                        ⏹ Stop
                      </button>
                      <button 
                        className="sb-phase-next-btn" 
                        style={{ 
                          flex: 1, 
                          background: useStore.getState().simIsPaused ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)', 
                          border: useStore.getState().simIsPaused ? '1px solid #10b981' : '1px solid #f59e0b', 
                          color: useStore.getState().simIsPaused ? '#10b981' : '#f59e0b',
                        }}
                        onClick={() => useStore.getState().setSimIsPaused(!useStore.getState().simIsPaused)}
                      >
                        {useStore.getState().simIsPaused ? '▶ Resume' : '⏸ Pause'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {az?.hasGenerated && (
                <div className="sb-manifest-card" style={{margin:0,marginTop:10}}>
                  <div className="sb-manifest-header">
                    <div className="sb-manifest-title">{az.name} — Equipment</div>
                    <div className="sb-manifest-total">{totalAssets}<span>items</span></div>
                  </div>
                  <div className="sb-manifest-list">
                    {ASSET_DISPLAY.map(group=>{
                      const count=group.types.reduce((s,t)=>s+(assetCounts[t]||0),0);
                      if(!count) return null;
                      return(
                        <div className="sb-manifest-row" key={group.label} title={group.purpose}>
                          <div className="sb-manifest-pip-wrap">
                            <span className={`sb-pip sb-pip--${group.pip}`}/>
                            <span className="sb-manifest-label">{group.label}</span>
                          </div>
                          <span className="sb-manifest-count">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {exportError&&<p style={{color:'#f87171',fontSize:'0.75rem',marginTop:8}}>{exportError}</p>}
            </div>
          )}
        </div>

        <div className="sb-footer">
          {sidebarPhase < 4 ? (
            <button className="sb-phase-next-btn" onClick={()=>setSidebarPhase(sidebarPhase+1)}>
              Continue to {['','Environment','Logistics','Safety Review'][sidebarPhase]} →
            </button>
          ) : (
            <div className="sb-footer-actions">
              {isGenerating ? (
                <div style={{background:'rgba(15,23,42,0.8)', padding:'12px', borderRadius:'10px', border:'1px solid #1e293b'}}>
                  <div style={{display:'flex', justifyContent:'space-between', marginBottom:'8px', fontSize:'0.75rem', color:'#38bdf8', fontWeight:600}}>
                    <span>{genProgress.state || 'Initializing...'}</span>
                    <span>{Math.round(genProgress.percent)}%</span>
                  </div>
                  <div style={{height:'6px', background:'#1e293b', borderRadius:'3px', overflow:'hidden'}}>
                    <div style={{height:'100%', width:`${genProgress.percent}%`, background:'linear-gradient(90deg, #0ea5e9, #38bdf8)', transition:'width 0.3s ease-out'}}/>
                  </div>
                </div>
              ) : (
                <button className="sb-generate-btn" style={{margin:0,width:'100%'}} onClick={onGenerate} disabled={!az?.coords?.length}>
                  ⚡ Generate Plan for {az?.name||'Zone'}
                </button>
              )}
              
              {hasAnyGenerated && !isGenerating && (
                <button className="sb-pdf-btn" style={{marginTop:10,borderRadius:8}} onClick={exportToPDF} disabled={isExporting}>
                  {isExporting?'Exporting…':`↓ Download PDF (${zones.length} zone${zones.length>1?'s':''})`}
                </button>
              )}
            </div>
          )}
        </div>

        <button className={`sidebar-interactive-edge ${!isOpen?'collapsed':''}`} onClick={onToggle} aria-label={isOpen?'Collapse sidebar':'Expand sidebar'}>
          <div className="edge-handle">
            <div className="edge-handle-line"/>
            <div className="edge-handle-line"/>
          </div>
        </button>

      </aside>
    </div>
  );
};

export default memo(Sidebar);
