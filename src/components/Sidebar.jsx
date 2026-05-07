// src/components/Sidebar.jsx
import React, { useState, useMemo, memo } from 'react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import useStore from '../store/useStore';

// ─── ASSET CATALOGUE ─────────────────────────────────────────────────────────
const ASSET_CATALOGUE = [
  { types:['cone'],          label:'Traffic Cones',         pip:'cone',       purpose:'Perimeter delineation and lane channelisation',                         standard:'Space at calculated intervals per speed limit (IRC SP 55)',       unit:'EA'     },
  { types:['sign-roadwork'], label:'Road Work Ahead Signs', pip:'cone',       purpose:'Advance warning to approaching traffic of work zone',                   standard:'Position at minimum advance warning distance upstream',           unit:'EA'     },
  { types:['sign-merge'],    label:'Lane Merge Signs',      pip:'cone',       purpose:'Warn drivers of lane reduction and required merge',                     standard:'Install before taper start; repeat at mid-taper if >50 m',      unit:'EA'     },
  { types:['sign-slow'],     label:'Slow Down Signs',       pip:'cone',       purpose:'Speed reduction advisory on approach to work zone',                     standard:'Space at 50 m intervals; minimum 2 signs per approach',          unit:'EA'     },
  { types:['sign-detour'],   label:'Detour Signs',          pip:'cone',       purpose:'Route diversion guidance for diverted road users',                      standard:'Install at all junction approaches on nominated detour route',    unit:'EA'     },
  { types:['barrier'],       label:'Water-Filled Barriers', pip:'barrier',    purpose:'Physical separation and impact protection between traffic and workers',  standard:'Deploy at high-risk sections; anti-ram couplings (IRC §6.4)',    unit:'EA'     },
  { types:['truck'],         label:'TMA Trucks',            pip:'truck',      purpose:'Truck-mounted attenuator — rear impact protection for work crew',       standard:'Position at tail of zone facing oncoming traffic',               unit:'EA'     },
  { types:['sign'],          label:'Signal / Light Points', pip:'sign',       purpose:'Temporary traffic signal control at zone entry and exit',               standard:'Min 75 m sight distance to signal head (IRC §8.3)',              unit:'EA'     },
  { types:['flagger'],       label:'Flaggers',              pip:'flagger',    purpose:'Manual traffic control at zone boundaries during active work',           standard:'Stop/slow paddle per IRC §7.2; radio comms mandatory',           unit:'PERSON' },
  { types:['supervisor'],    label:'Site Supervisors',      pip:'supervisor', purpose:'On-site safety compliance oversight and incident response',              standard:'Min 1 supervisor per 200 m of active zone (IRC §5.1)',           unit:'PERSON' },
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

const C = {
  bg:[2,6,23],surface:[15,23,42],surf2:[20,30,55],border:[30,41,59],
  accent:[14,165,233],accentDk:[37,99,235],success:[16,185,129],
  warning:[245,158,11],danger:[239,68,68],white:[255,255,255],
  tMain:[248,250,252],tMuted:[148,163,184],tDim:[71,85,105],tFaint:[51,65,85],
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
  const {
    zones, activeZoneId, getActiveZone,
    setActiveZoneId, addZone, deleteZone, renameZone, updateActiveZone,
    isWazeSync, setIsWazeSync,
    projectName, setProjectField, permitNumber, contractorName, clientName,
    startDate, endDate, superintendent, safetyOfficer, emergencyContact,
    isGenerating, genProgress, saveStatus,
    isExporting, setIsExporting,
    mapInstance
  } = useStore();

  const [exportError,  setExportError]  = useState(null);
  const [activePhase,  setActivePhase]  = useState(1);
  const [renamingId,   setRenamingId]   = useState(null);
  const [renameVal,    setRenameVal]    = useState('');

  // Active zone helpers
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

  const assetCounts = useMemo(()=>countByType(az?.placedAssets||[]),[az?.placedAssets]);
  const totalAssets = (az?.placedAssets||[]).length;

  const saveIndicator =
    saveStatus==='saving'?{label:'Saving…',cls:'saving',color:'#f59e0b'}:
    saveStatus==='error'? {label:'Save failed',cls:'error',color:'#ef4444'}:
                          {label:'Saved',cls:'',color:'#10b981'};

  // ── Per-zone setters ──────────────────────────────────────────────────────
  const setZ = (field) => (val) => updateActiveZone({ [field]: val });
  const setP = (field) => (val) => setProjectField(field, val);

  // ── PDF HELPERS ───────────────────────────────────────────────────────────
  const buildPDF = async () => {
    if (!mapInstance) {
      alert("Map is initializing. Please wait a moment.");
      return;
    }
    setIsExporting(true);
    const originalView = {
      center: mapInstance.getCenter(),
      zoom: mapInstance.getZoom(),
      pitch: mapInstance.getPitch(),
      bearing: mapInstance.getBearing()
    };

    const pdf = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    const W=pdf.internal.pageSize.getWidth(), H=pdf.internal.pageSize.getHeight(), M=14, UW=W-M*2;
    const now=new Date();
    const dateStr=now.toLocaleDateString('en-IN',{day:'2-digit',month:'long',year:'numeric'});
    const timeStr=now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});

    const F  =(...a)=>pdf.setFillColor(...a);
    const S  =(...a)=>pdf.setDrawColor(...a);
    const TC =(...a)=>pdf.setTextColor(...a);
    const FS =(n)=>pdf.setFontSize(n);
    const FB =()=>pdf.setFont('helvetica','bold');
    const FN =()=>pdf.setFont('helvetica','normal');
    const T  =(s,x,y,o)=>pdf.text(String(s),x,y,o);
    const R  =(x,y,w,h,m)=>pdf.rect(x,y,w,h,m||'F');
    const RR =(x,y,w,h,r,m)=>pdf.roundedRect(x,y,w,h,r||2,r||2,m||'FD');
    const LW =(n)=>pdf.setLineWidth(n);
    const LN =(x1,y1,x2,y2)=>pdf.line(x1,y1,x2,y2);
    const pageBg=()=>{F(...C.bg);R(0,0,W,H);};
    const needsPage=(cy,n)=>cy+n>H-16;

    const totalZones = zones.length;
    const totalPagesEst = 1 + totalZones * 2 + 1; // cover + (map+manifest per zone) + params

    const pageHeader=(num,total,sub)=>{
      F(...C.surface);R(0,0,W,11);S(...C.border);LW(0.2);LN(0,11,W,11);
      TC(...C.accent);FB();FS(6.5);T('MARG RAKSHAK  ·  TRAFFIC MANAGEMENT PLAN'+(sub?`  ·  ${sub}`:''),M,7.5);
      TC(...C.tDim);FN();FS(6);T(`Page ${num} of ${total}`,W-M,7.5,{align:'right'});
      return 17;
    };
    const pageFooter=()=>{
      S(...C.border);LW(0.2);LN(M,H-10,W-M,H-10);
      TC(...C.tDim);FN();FS(5.5);T('Marg Rakshak  ·  Verify all parameters with local road authority before implementation.',M,H-5.5);
      T(`Ref: ${reportId}  ·  ${dateStr}`,W-M,H-5.5,{align:'right'});
    };
    const secHead=(label,sy,rgb)=>{
      const ac=rgb||C.accent;F(...ac);R(M,sy,2.5,7);F(...C.surf2);R(M+2.5,sy,UW-2.5,7);
      TC(...ac);FB();FS(7.5);T(label,M+6,sy+5);return sy+12;
    };

    // ── PAGE 1: COVER ────────────────────────────────────────────────────────
    pageBg();
    F(...C.accent);R(0,0,W,52);F(...C.accentDk);R(0,32,W,20);
    TC(...C.white);FB();FS(15);T('MARG RAKSHAK',M,17);
    TC(210,240,255);FN();FS(7.5);T('Intelligent Traffic Management Platform',M,23);
    F(...C.bg);R(0,52,W,H-52);
    TC(...C.white);FB();
    if(projectName){FS(11);T(projectName.toUpperCase(),M,41);FS(20);T('TRAFFIC MANAGEMENT',M,56);T('PLAN',M,67);}
    else{FS(20);T('TRAFFIC MANAGEMENT',M,44);T('PLAN',M,60);}
    F(...C.accent);R(M,projectName?71:64,44,1.5);

    let curY=projectName?78:72;
    F(...C.surface);RR(M,curY,90,12,2,'F');
    TC(...C.tDim);FN();FS(6);T('REPORT ID',M+4,curY+4.5);
    TC(...C.accent);FB();FS(9);T(reportId,M+4,curY+10);
    F(...C.success);RR(W-M-36,curY,36,12,2,'F');
    TC(...C.white);FB();FS(7);T(`${totalZones} ZONE${totalZones>1?'S':''}`,W-M-33,curY+7.5);
    curY+=18;

    const c1=M,c2=M+UW/2+3,cw=UW/2-3;
    F(...C.surf2);RR(c1,curY,cw,6,1,'F');RR(c2,curY,cw,6,1,'F');
    TC(...C.tDim);FB();FS(5.5);T('PROJECT DETAILS',c1+3,curY+4.2);T('DOCUMENT INFO',c2+3,curY+4.2);
    curY+=8;

    const leftKV=[
      ['Project Name',projectName||'—'],['Client / Owner',clientName||'—'],
      ['Contractor',contractorName||'—'],['Permit No.',permitNumber||'—'],
      ['Total Zones',String(totalZones)],['Work Zones',zones.map(z=>z.name).join(', ')],
    ];
    const rightKV=[
      ['Report ID',reportId],['Generated',dateStr],['Time',timeStr],
      ['Total Assets',String(zones.reduce((s,z)=>s+z.placedAssets.length,0))],
      ['Start Date',startDate||'—'],['End Date',endDate||'—'],
    ];
    for(let i=0;i<leftKV.length;i++){
      if(i%2===0){F(...C.surface);R(c1,curY-1,cw,11);R(c2,curY-1,cw,11);}
      TC(...C.tDim);FN();FS(5.5);T(leftKV[i][0],c1+3,curY+2.5);T(rightKV[i][0],c2+3,curY+2.5);
      TC(...C.tMain);FB();FS(8);T(leftKV[i][1],c1+3,curY+8);T(rightKV[i][1],c2+3,curY+8);
      curY+=11;
    }
    curY+=5;

    // Zone index table
    F(...C.surf2);RR(M,curY,UW,7,2,'F');
    TC(...C.accent);FB();FS(6.5);T('ZONE INDEX',M+4,curY+5);curY+=10;
    zones.forEach((zone,i)=>{
      if(i%2===0){F(...C.surface);R(M,curY-1,UW,10);}
      TC(...C.tDim);FN();FS(5.5);T(`Zone ${i+1}`,M+3,curY+3);
      TC(...C.tMain);FB();FS(7.5);T(zone.name,M+16,curY+7);
      TC(...C.tMuted);FN();FS(5.5);
      T(`${zone.speedLimit}km/h  ·  ${zone.closureType}  ·  ${zone.placedAssets.length} assets  ·  ${zone.coords?.length>0?'Boundary set':'No boundary'}`,M+16,curY+3);
      const zc=zone.color||'#0ea5e9';const rgb=parseInt(zc.slice(1),16);
      F((rgb>>16)&255,(rgb>>8)&255,rgb&255);R(M+3,curY+1,10,6);
      curY+=10;
    });

    F(...C.surface);R(0,H-18,W,18);S(...C.border);LW(0.2);LN(0,H-18,W,H-18);
    TC(...C.tDim);FN();FS(6);T('CONFIDENTIAL — FOR AUTHORISED SITE USE ONLY',M,H-12);
    T('Verify all parameters with local road authority before implementation.',M,H-7);
    TC(...C.tDim);T(`Page 1 of ${totalPagesEst}  ·  Ref: ${reportId}`,W-M,H-12,{align:'right'});T(dateStr,W-M,H-7,{align:'right'});

    // ── PAGE 2: PROJECT RESOURCE AGGREGATION ─────────────────────────────────
    pdf.addPage(); pageBg();
    let pageNum = 2;
    pageHeader(pageNum++, totalPagesEst, 'PROJECT RESOURCE SUMMARY');
    curY = secHead('PROJECT RESOURCE AGGREGATION  (FLEET OVERVIEW)', 17);
    
    // Calculate global counts
    const globalCounts = {};
    zones.forEach(z => {
      z.placedAssets.forEach(a => {
        globalCounts[a.type] = (globalCounts[a.type] || 0) + 1;
      });
    });

    F(...C.surf2);R(M, curY, UW, 15);
    TC(...C.accent);FB();FS(12);T('TOTAL EQUIPMENT ROLL-OUT', M+5, curY+9);
    TC(...C.tMuted);FN();FS(7);T(`Aggregated requirement across all ${totalZones} work zones`, M+5, curY+13);
    curY += 20;

    const printGlobalTblHdr=(ty)=>{
      F(...C.surface);R(M,ty,UW,8);S(...C.border);LW(0.2);R(M,ty,UW,8,'D');
      TC(...C.tDim);FB();FS(6);
      T('EQUIPMENT CATEGORY',M+5,ty+5.3);T('TOTAL QTY',W-M-3,ty+5.3,{align:'right'});
      return ty+9;
    };
    curY = printGlobalTblHdr(curY);

    ASSET_CATALOGUE.forEach((asset, idx) => {
      const count = asset.types.reduce((s,t) => s + (globalCounts[t] || 0), 0);
      if (count === 0) return;
      const rH = 10;
      idx%2===0?F(...C.bg):F(...C.surface);R(M,curY,UW,rH);
      TC(...C.tMain);FS(8);FB();T(asset.label, M+5, curY+6.5);
      TC(...C.accent);FS(10);T(String(count), W-M-3, curY+6.5, {align:'right'});
      curY += rH;
    });

    curY += 15;
    curY = secHead('SITE LOGISTICS & PROTOCOL', curY, C.success);
    F(...C.surface);RR(M, curY, UW, 25, 2, 'F');
    TC(...C.tMain);FS(7);FB();T('DEPLOYMENT GUIDELINES', M+4, curY+7);
    TC(...C.tMuted);FN();FS(6);
    pdf.text(pdf.splitTextToSize('1. All equipment must be inspected for reflectivity and battery life (if applicable) prior to deployment.\n2. Cones and barriers should be placed in the downstream-to-upstream direction for setup safety.\n3. TMA trucks must be the first items placed and last items removed from the live carriageway.\n4. Site supervisors must verify all sign placements against the site map before active work commences.', UW-8), M+4, curY+11);
    
    pageFooter();

    // ── PAGES 3+: ONE MAP PAGE + ONE MANIFEST PAGE PER ZONE ─────────────────
    const mapEl = document.querySelector('.maplibregl-canvas-container') || document.querySelector('.maplibregl-map');

    for (const zone of zones) {
      const zsp = SAFETY_PARAMS[zone.speedLimit||'50']||SAFETY_PARAMS['50'];
      const zCounts = countByType(zone.placedAssets);
      const zTotal  = zone.placedAssets.length;

      let zStats = null;
      if (zone.coords?.length>=2) {
        const isPath=zone.shapeType==='polyline';
        const loopLimit=isPath?zone.coords.length-1:zone.coords.length;
        let perim=0;
        for(let i=0;i<loopLimit;i++) perim+=haversineDist(zone.coords[i],zone.coords[(i+1)%zone.coords.length]);
        const area=polygonAreaM2(zone.coords);
        const center={lat:zone.coords.reduce((s,c)=>s+c.lat,0)/zone.coords.length,lng:zone.coords.reduce((s,c)=>s+c.lng,0)/zone.coords.length};
        const minPerim=({30:50,50:100,80:200})[zone.speedLimit]||100;
        zStats={perim,area,center,minPerim,compliant:perim>=minPerim,isPath};
      }

      pdf.addPage(); pageBg();
      curY = pageHeader(pageNum++, totalPagesEst, `${zone.name.toUpperCase()} — SITE MAP`);
      curY = secHead(`ZONE: ${zone.name}  —  SITE MAP & GEOMETRY`, curY);

      if (zStats) {
        const cards=[
          {lbl:zStats.isPath?'PATH LENGTH':'PERIMETER',val:fmtDist(zStats.perim),hi:false},
          {lbl:zStats.isPath?'FOOTPRINT':'ENCLOSED AREA',val:zStats.isPath?'N/A':fmtArea(zStats.area),hi:false},
          {lbl:'COMPLIANCE',val:zStats.compliant?'PASS':'REVIEW',hi:true},
          {lbl:'CENTROID LAT',val:zStats.center.lat.toFixed(5)+'°',hi:false},
          {lbl:'CENTROID LNG',val:zStats.center.lng.toFixed(5)+'°',hi:false},
          {lbl:'TOTAL ASSETS',val:String(zTotal),hi:false},
        ];
        const cW=(UW-10)/3,cH=18;
        cards.forEach((card,i)=>{
          const cx=M+(i%3)*(cW+5),cy=curY+Math.floor(i/3)*(cH+4);
          F(...C.surface);S(...C.border);LW(0.2);RR(cx,cy,cW,cH,2,'FD');
          const topC=card.hi?(zStats.compliant?C.success:C.warning):C.accent;
          F(...topC);R(cx,cy,cW,2);
          TC(...C.tDim);FN();FS(5.5);T(card.lbl,cx+4,cy+7.5);
          if(card.hi){TC(...(zStats.compliant?C.success:C.warning));}else TC(...C.tMain);
          FB();FS(10.5);T(card.val,cx+4,cy+13.5);
        });
        curY+=2*(cH+4)+6;
      }

      F(...C.surf2);S(...C.border);LW(0.15);RR(M,curY,UW,9,2,'FD');
      TC(...C.tMuted);FN();FS(6.5);
      T(`Speed: ${zone.speedLimit}km/h  ·  WZ Speed: ${zone.workZoneSpeed}km/h  ·  Lanes: ${zone.laneCount}×${zone.laneWidth}m  ·  Surface: ${zone.surfaceType}  ·  Closure: ${zone.closureType}  ·  Spacing: ${zsp.coneSpacing}`,M+4,curY+6);
      curY+=14;

      curY=secHead('SITE MAP  —  AERIAL VIEW',curY);
      if(mapInstance){
        try{
          // Focus map on zone
          if (zone.coords.length > 0) {
            const lngs = zone.coords.map(c => c.lng);
            const lats = zone.coords.map(c => c.lat);
            const bounds = [
              [Math.min(...lngs), Math.min(...lats)],
              [Math.max(...lngs), Math.max(...lats)]
            ];
            mapInstance.fitBounds(bounds, { padding: 60, animate: false });
            // Wait for render
            await new Promise(r => {
              mapInstance.once('idle', r);
              setTimeout(r, 1000); 
            });
          }

          const canvas = mapInstance.getCanvas();
          const img = canvas.toDataURL('image/jpeg', 0.95);
          
          const aspect = canvas.height / canvas.width;
          const mapH = Math.min(H - curY - 28, aspect * UW);
          
          S(...C.accent); LW(0.5); RR(M-1, curY-1, UW+2, mapH+2, 2, 'D');
          pdf.addImage(img, 'JPEG', M, curY, UW, mapH);
          
          if(zStats){
            TC(...C.tDim);FN();FS(6);
            T(`Centroid: ${zStats.center.lat.toFixed(6)}°N, ${zStats.center.lng.toFixed(6)}°E  ·  ${zStats.isPath?'Length':'Perimeter'}: ${fmtDist(zStats.perim)}${zStats.isPath?'':`  ·  Area: ${fmtArea(zStats.area)}`}`,W/2,curY+mapH+5,{align:'center'});
          }
        }catch(e){
          TC(...C.tFaint);FN();FS(8);T('Map capture unavailable',W/2,curY+30,{align:'center'});
        }
      }
      pageFooter();

      pdf.addPage(); pageBg();
      curY = pageHeader(pageNum++, totalPagesEst, `${zone.name.toUpperCase()} — EQUIPMENT`);
      curY = secHead(`ZONE: ${zone.name}  —  EQUIPMENT MANIFEST`,curY);

      F(...C.accent);R(M,curY,UW,14);
      TC(...C.white);FB();FS(20);T(String(zTotal),M+6,curY+11);
      FS(7.5);FN();T(`Total equipment items — ${zone.name}`,M+22,curY+7);
      TC(200,235,255);FS(6.5);T(`Speed: ${zone.speedLimit}km/h  ·  Risk: ${zsp.riskLevel}  ·  ${dateStr}`,M+22,curY+12);
      curY+=19;

      const printTblHdr=(ty)=>{
        F(...C.surf2);R(M,ty,UW,8);S(...C.border);LW(0.2);R(M,ty,UW,8,'D');
        TC(...C.tDim);FB();FS(6);
        T('EQUIPMENT TYPE',M+5,ty+5.3);T('PURPOSE',M+68,ty+5.3);
        T('IRC STANDARD',M+118,ty+5.3);T('QTY',W-M-3,ty+5.3,{align:'right'});
        return ty+9;
      };
      curY=printTblHdr(curY);

      let grand=0;
      ASSET_CATALOGUE.forEach((asset,idx)=>{
        const count=asset.types.reduce((s,t)=>s+(zCounts[t]||0),0);
        grand+=count;
        const rH=15;
        if(needsPage(curY,rH+12)){pageFooter();pdf.addPage();pageBg();curY=pageHeader(pageNum-1,totalPagesEst,`${zone.name.toUpperCase()} — EQUIPMENT (cont.)`);curY=printTblHdr(curY);}
        idx%2===0?F(...C.surface):F(...C.bg);R(M,curY,UW,rH);
        F(...(count>0?C.accent:C.border));R(M,curY,2.5,rH);
        TC(...(count>0?C.tMain:C.tFaint));FB();FS(7.5);T(asset.label,M+5,curY+5.5);
        TC(...C.tFaint);FN();FS(5);T(`types: ${asset.types.join(', ')}  ·  unit: ${asset.unit}`,M+5,curY+10.5);
        TC(...(count>0?C.tMuted:C.tFaint));FS(5.8);
        pdf.text(pdf.splitTextToSize(asset.purpose,47).slice(0,2),M+68,curY+5.5);
        pdf.text(pdf.splitTextToSize(asset.standard,52).slice(0,2),M+118,curY+5.5);
        if(count>0){TC(...C.accent);FB();FS(13);T(String(count),W-M-3,curY+10.5,{align:'right'});}
        else{TC(...C.tFaint);FN();FS(9);T('—',W-M-3,curY+9,{align:'right'});}
        S(...C.border);LW(0.12);LN(M,curY+rH,W-M,curY+rH);
        curY+=rH;
      });
      curY+=2;
      F(...C.accentDk);R(M,curY,UW,12);
      TC(...C.white);FB();FS(7.5);T(`TOTAL — ${zone.name.toUpperCase()}`,M+5,curY+8);
      FS(15);T(String(grand),W-M-3,curY+9,{align:'right'});
      pageFooter();
    }

    pdf.addPage(); pageBg();
    curY = pageHeader(pageNum, totalPagesEst, 'PARAMETERS & SIGN-OFF');
    curY = secHead('SAFETY PARAMETERS  (IRC SP 55:2014)', curY);

    zones.forEach((zone, zi) => {
      const zsp=SAFETY_PARAMS[zone.speedLimit||'50']||SAFETY_PARAMS['50'];
      F(...C.surf2);S(...C.border);LW(0.15);RR(M,curY,UW,8,2,'FD');
      TC(...C.accent);FB();FS(7);T(zone.name,M+4,curY+5.5);
      TC(...C.tMuted);FN();FS(6);
      T(`${zone.speedLimit}km/h  ·  Taper: ${zsp.taperLen}  ·  Spacing: ${zsp.coneSpacing}  ·  Adv Warning: ${zsp.advWarn}  ·  Risk: ${zsp.riskLevel}  ·  Closure: ${zone.closureType}`,M+40,curY+5.5);
      curY+=11;
    });
    curY+=4;

    curY=secHead('PROJECT & PERSONNEL',curY,C.success);
    const pRows=[
      ['Project Name',projectName||'—','Permit / Auth. No.',permitNumber||'—'],
      ['Client / Owner',clientName||'—','Contractor',contractorName||'—'],
      ['Superintendent',superintendent||'—','Safety Officer',safetyOfficer||'—'],
      ['Emergency Tel.',emergencyContact||'—','Night Works',az?.nightWork?'Yes — lighting req.':'No'],
      ['Work Period',(startDate&&endDate)?`${startDate} to ${endDate}`:(startDate||endDate||'—'),'Working Hours',az?.workingHours||'07:00–17:00'],
    ];
    const pColW=(UW-4)/2;
    pRows.forEach((row,i)=>{
      const ry=curY+i*14;
      if(i%2===0){F(...C.surface);R(M,ry,UW,14);}
      TC(...C.tDim);FN();FS(5.5);T(row[0],M+3,ry+4.5);T(row[2],M+pColW+7,ry+4.5);
      TC(...C.tMain);FB();FS(7.5);T(row[1],M+3,ry+10.5);T(row[3],M+pColW+7,ry+10.5);
      S(...C.border);LW(0.1);LN(M,ry+14,M+UW,ry+14);
    });
    curY+=pRows.length*14+8;

    curY=secHead('APPROVAL & SIGN-OFF',curY);
    const signers=[
      {title:'SITE SUPERINTENDENT',name:superintendent,role:'On-site execution and equipment deployment'},
      {title:'SAFETY OFFICER',name:safetyOfficer,role:'IRC SP 55 compliance verification authority'},
      {title:'AUTHORITY APPROVAL',name:'',role:'Road authority / Municipal corporation rep.'},
    ];
    const sigW=(UW-8)/3,sigH=46;
    signers.forEach((sig,i)=>{
      const sx=M+i*(sigW+4);
      F(...C.surface);S(...C.border);LW(0.25);RR(sx,curY,sigW,sigH,2,'FD');
      F(...C.accent);RR(sx,curY,sigW,8,2,'F');R(sx,curY+4,sigW,4);
      TC(...C.white);FB();FS(6);T(sig.title,sx+4,curY+5.5);
      if(sig.name){TC(...C.tMuted);FN();FS(6.5);T(sig.name,sx+4,curY+14);}
      TC(...C.tDim);FN();FS(5.5);pdf.text(pdf.splitTextToSize(sig.role,sigW-8).slice(0,2),sx+4,sig.name?curY+19:curY+13);
      S(...C.border);LW(0.3);
      LN(sx+4,curY+30,sx+sigW-4,curY+30);TC(...C.tFaint);FN();FS(5.5);T('Signature',sx+4,curY+34);
      LN(sx+4,curY+39,sx+sigW-4,curY+39);T('Full Name & Designation',sx+4,curY+43);
      TC(...C.tDim);T(`Date: ${dateStr}`,sx+sigW-4,curY+43,{align:'right'});
    });

    F(...C.surface);R(0,H-16,W,16);S(...C.border);LW(0.2);LN(0,H-16,W,H-16);
    F(...C.accent);R(0,H-16,3,16);
    TC(...C.tDim);FN();FS(6);T('Marg Rakshak  ·  Intelligent Traffic Management Platform',M,H-10);
    T('Verify all plan parameters with local road authority before implementation.',M,H-5.5);
    FB();T(`Report: ${reportId}  ·  ${dateStr}, ${timeStr}`,W-M,H-10,{align:'right'});
    T(`Page ${pageNum} of ${totalPagesEst}`,W-M,H-5.5,{align:'right'});

    // Restore view
    mapInstance.jumpTo(originalView);
    setIsExporting(false);

    pdf.save(`MargRakshak_TMP_${reportId}.pdf`);
  };

  const exportToPDF = async () => {
    setIsExporting(true); setExportError(null);
    try { await buildPDF(); }
    catch(e) { console.error('PDF export error:', e); setExportError('Export failed.'); }
    finally  { setIsExporting(false); }
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
      <aside className="main-sidebar" style={{pointerEvents:isExporting?'none':'auto'}} aria-busy={isExporting}>

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
          <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
            <button onClick={() => document.body.classList.toggle('light-mode')} style={{background: 'transparent', border: '1px solid var(--sb-border-2)', borderRadius: '4px', cursor: 'pointer', padding: '2px 4px', fontSize: '12px'}} title="Toggle Light Mode for outdoor visibility">☀️</button>
            <div className={`sb-save-badge sb-save-badge--${saveIndicator.cls}`} role="status">
              <span className="sb-save-dot"/>
              {saveIndicator.label}
            </div>
          </div>
        </div>

        <div className="sb-stepper">
          <PhaseBtn num="01" label="Zones"    active={activePhase===1} onClick={()=>setActivePhase(1)}/>
          <div className="sb-step-line"/>
          <PhaseBtn num="02" label="Env"      active={activePhase===2} onClick={()=>setActivePhase(2)}/>
          <div className="sb-step-line"/>
          <PhaseBtn num="03" label="Logistics"active={activePhase===3} onClick={()=>setActivePhase(3)}/>
          <div className="sb-step-line"/>
          <PhaseBtn num="04" label="Safety"   active={activePhase===4} onClick={()=>setActivePhase(4)}/>
        </div>

        <div className="sb-body">

          {activePhase===1 && (
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

              <button className="sz-add-btn" onClick={addZone}>
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

          {activePhase===2 && (
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

          {activePhase===3 && (
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
              <Field id="superintendent" label="Superintendent">
                <Input id="superintendent" value={superintendent} onChange={setP('superintendent')} placeholder="Name"/>
              </Field>
              <Field id="safety-officer" label="Safety Officer">
                <Input id="safety-officer" value={safetyOfficer} onChange={setP('safetyOfficer')} placeholder="Name"/>
              </Field>
              <Field id="emergency-contact" label="Emergency Contact">
                <Input id="emergency-contact" type="tel" value={emergencyContact} onChange={setP('emergencyContact')} placeholder="+91"/>
              </Field>
            </div>
          )}

          {activePhase===4 && (
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
                      <span className="sz-summary-meta">{zHasZone?'✓':''} {zone.placedAssets.length}assets</span>
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
                      <div className="sb-zone-stat"><span className="sb-zone-stat-val">{fmtDist(zoneStats.perim)}</span><span className="sb-zone-stat-lbl">Perim</span></div>
                      {!zoneStats.isPath&&<div className="sb-zone-stat"><span className="sb-zone-stat-val">{fmtArea(zoneStats.area)}</span><span className="sb-zone-stat-lbl">Area</span></div>}
                    </div>
                  ):<p className="sb-zone-empty">Draw zone boundary first.</p>}
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
          {activePhase < 4 ? (
            <button className="sb-phase-next-btn" onClick={()=>setActivePhase(p=>p+1)}>
              Continue to {['','Environment','Logistics','Safety Review'][activePhase]} →
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
