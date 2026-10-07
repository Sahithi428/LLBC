/* =========================================================
   LandLensAI — Advanced app.js
   Full Three.js 3D Studio + all existing features
   ========================================================= */

const $ = id => document.getElementById(id);
const state = {
  image: null, analysis: null, layout: null, building: null, boundaryPoints: [], boundaryCalibration: {width: null, length: null}, boundarySideCalibration: [0,0,0,0],
  cost: null, construction: null, selectedPlot: null, theme: 'dark', three: null, exported: false, currentProjectId: null
};

/* ── helpers ─────────────────────────────────────────────── */
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window.__toast);
  window.__toast = setTimeout(() => t.classList.remove('show'), 2800);
}
window.addEventListener('error', (e) => {
  console.error('LandLensAI frontend error:', e.error || e.message);
  try { toast('A frontend error occurred. Check the browser console.'); } catch (_) {}
});

async function api(url, opts = {}) {
  const r = await fetch(url, opts);
  let d = {};
  try { d = await r.json(); } catch {}
  if (!r.ok || d.success === false) throw new Error(d.error || 'Request failed');
  return d.data ?? d;
}
function money(v) { return v == null ? '—' : '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 }); }
function esc(s) { return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

/* ── measurements ────────────────────────────────────────── */
function addMeasurement(name = '', value = '', removable = true) {
  const row = document.createElement('div');
  row.className = 'measure-row';
  row.innerHTML = `<input class="mname" placeholder="Side name" value="${esc(name)}"><input class="mval" type="number" min="0" step="0.01" placeholder="ft" value="${value}">${removable?'<button title="Remove">×</button>':'<span class="measure-lock" title="Four-side calibration">↔</span>'}`;
  row.querySelector('button')?.addEventListener('click', () => row.remove());
  $('measurements').appendChild(row);
  bindMeasurementScaling();
}

/* ── measurement-driven boundary scaling ─────────────────── */
function measurementValues(){
  // Keep row indexes stable: Side 5 must stay Side 5 even when some later
  // measurements are still empty. This is important for irregular polygons.
  return [...document.querySelectorAll('.measure-row')].map(r=>({
    name:(r.querySelector('.mname')?.value||'Side').trim(),
    value:Number(r.querySelector('.mval')?.value||0)
  }));
}
function positiveMeasurementValues(){ return measurementValues().filter(x=>x.value>0); }
function ensureMeasurementRows(count){
  const rows=document.querySelectorAll('.measure-row').length;
  for(let i=rows;i<count;i++) addMeasurement(`Side ${i+1}`, '', true);
}
// IMPORTANT: the four land sides are independent.
// Never copy one entered dimension into another side.
function syncOppositeMeasurements(){ return; }
function rescaleBoundaryToMeasurements(changedIndex=0){
  if(!state.image || state.boundaryPoints.length<3) return;
  const vals=measurementValues();
  const pts=state.boundaryPoints.map(p=>({...p}));
  const i=Math.max(0,Math.min(pts.length-1,Number(changedIndex)||0));
  if(!vals[i] || !(Number(vals[i].value)>0)) return;
  const entered=Number(vals[i].value||0);

  // Scale only the edited edge. For an irregular polygon we keep the first
  // endpoint fixed and translate the remaining chain so the edited edge grows
  // or shrinks without copying its value into another measurement field.
  const n=pts.length, a=pts[i], b=pts[(i+1)%n];
  const oldPx=Math.max(1,Math.hypot(b.x-a.x,b.y-a.y));
  let oldFt=Number(state.boundarySideCalibration?.[i]) || 0;
  if(!(oldFt>0)){
    const known=[];
    for(let k=0;k<n;k++){
      const ft=Number(state.boundarySideCalibration?.[k]||vals[k]?.value||0);
      if(ft>0){ const aa=pts[k],bb=pts[(k+1)%n]; known.push(Math.hypot(bb.x-aa.x,bb.y-aa.y)/ft); }
    }
    const pxPerFt=known.length?known.reduce((a,b)=>a+b,0)/known.length:Math.max(1,state.image.width/100);
    oldFt=oldPx/Math.max(pxPerFt,0.001);
  }
  const targetPx=Math.max(6,oldPx*(entered/oldFt));
  const ux=(b.x-a.x)/oldPx, uy=(b.y-a.y)/oldPx;
  const dx=(ux*targetPx)-(b.x-a.x), dy=(uy*targetPx)-(b.y-a.y);

  if(i < n-1){
    for(let j=i+1;j<n;j++){ pts[j].x+=dx; pts[j].y+=dy; }
  } else {
    // Closing edge: keep the last point fixed and move the earlier chain.
    for(let j=0;j<n-1;j++){ pts[j].x-=dx; pts[j].y-=dy; }
  }

  const marginX=Math.min(state.image.width*.05,40), marginY=Math.min(state.image.height*.05,40);
  const minX=Math.min(...pts.map(q=>q.x)), maxX=Math.max(...pts.map(q=>q.x));
  const minY=Math.min(...pts.map(q=>q.y)), maxY=Math.max(...pts.map(q=>q.y));
  let sx=0,sy=0;
  if(minX<marginX)sx=marginX-minX; else if(maxX>state.image.width-marginX)sx=state.image.width-marginX-maxX;
  if(minY<marginY)sy=marginY-minY; else if(maxY>state.image.height-marginY)sy=state.image.height-marginY-maxY;
  state.boundaryPoints=pts.map(q=>({id:q.id,x:q.x+sx,y:q.y+sy}));
  state.boundarySideCalibration=vals.map(v=>Number(v.value)||0);
  state.boundaryCalibration={
    width:Number(vals[1]?.value||state.boundaryCalibration.width||0),
    length:Number(vals[0]?.value||state.boundaryCalibration.length||0)
  };
  renderBoundaryPicker();
  const badge=$('boundaryCount');
  if(badge) badge.textContent=`${pts.length} corners · ${vals.slice(0,pts.length).map(v=>v.value||'—').join(' × ')} ft`;
}

function bindMeasurementScaling(){
  document.querySelectorAll('.measure-row .mval').forEach((input,index)=>{
    if(input.__scaleBound) return; input.__scaleBound=true;
    const update=()=>{ rescaleBoundaryToMeasurements(index); };
    input.addEventListener('input',update);
    input.addEventListener('change',update);
    input.addEventListener('blur',update);
  });
}

/* ── image boundary calibration ─────────────────────────── */
function setBoundaryPoints(points){
  state.boundaryPoints=(points||[]).slice(0,20).map((p,i)=>({id:`P${i+1}`,x:Number(p.x),y:Number(p.y)}));
  ensureMeasurementRows(state.boundaryPoints.length);
  const vals=positiveMeasurementValues();
  if(vals.length>=2) state.boundaryCalibration={width:vals[1].value,length:vals[0].value}; state.boundarySideCalibration=measurementValues().map(x=>Number(x.value)||0);
  renderBoundaryPicker();
}
function renderBoundaryPicker(){
  const wrap=$('boundaryPicker'), svg=$('boundaryPickerSvg'), img=$('landPreview');
  if(!wrap||!svg||!state.image) return;
  wrap.classList.remove('hidden');
  img.src=state.image.url; img.classList.remove('hidden');
  svg.setAttribute('viewBox',`0 0 ${state.image.width} ${state.image.height}`);
  const pts=state.boundaryPoints;
  const poly=pts.length>=3?`<polygon points="${pts.map(p=>`${p.x},${p.y}`).join(' ')}" class="picker-polygon"/>`:'';
  const lines=pts.length>=2?pts.map((p,i)=>{const q=pts[(i+1)%pts.length];return `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" class="picker-line"/>`;}).join(''):'';
  const circles=pts.map((p,i)=>`<g class="picker-point"><circle cx="${p.x}" cy="${p.y}" r="${Math.max(state.image.width,state.image.height)/85}"/><text x="${p.x+14}" y="${p.y-12}">P${i+1}</text></g>`).join('');
  const vals=measurementValues();
  const dims=pts.length>=3 ? pts.map((p,i)=>{const q=pts[(i+1)%pts.length]; const v=vals[i]?.value; if(!v)return ''; return `<text class="picker-dimension" x="${(p.x+q.x)/2}" y="${(p.y+q.y)/2-8}" text-anchor="middle">${v} ft</text>`;}).join('') : '';
  svg.innerHTML=poly+lines+dims+circles;
  $('boundaryCount').textContent=`${pts.length} corners · ${pts.length<3?'add at least 3':'irregular polygon ready'}`;
}
function imagePointFromEvent(e){
  const svg=$('boundaryPickerSvg'); const rect=svg.getBoundingClientRect();
  return {x:Math.max(0,Math.min(state.image.width,(e.clientX-rect.left)/rect.width*state.image.width)),y:Math.max(0,Math.min(state.image.height,(e.clientY-rect.top)/rect.height*state.image.height))};
}
function initBoundaryPicker(){
  const svg=$('boundaryPickerSvg'); if(!svg||svg.__bound) return; svg.__bound=true;
  let dragIndex=-1, moved=false;
  svg.addEventListener('click',e=>{
    if(moved){moved=false;return;}
    if(!state.image) return;
    if(state.boundaryPoints.length>=20) return toast('Maximum 20 boundary points reached.');
    const p=imagePointFromEvent(e); state.boundaryPoints.push({id:`P${state.boundaryPoints.length+1}`,...p});
    ensureMeasurementRows(state.boundaryPoints.length);
    renderBoundaryPicker();
  });
  svg.addEventListener('pointerdown',e=>{
    const g=e.target.closest?.('.picker-point'); if(!g) return;
    const circles=[...svg.querySelectorAll('.picker-point')]; dragIndex=circles.indexOf(g); moved=false; svg.setPointerCapture?.(e.pointerId); e.preventDefault();
  });
  svg.addEventListener('pointermove',e=>{
    if(dragIndex<0||!state.image)return; const p=imagePointFromEvent(e); state.boundaryPoints[dragIndex]={...state.boundaryPoints[dragIndex],x:p.x,y:p.y}; moved=true; renderBoundaryPicker();
  });
  svg.addEventListener('pointerup',()=>{dragIndex=-1;});
  $('resetBoundary').onclick=()=>{state.boundaryPoints=[];renderBoundaryPicker();toast('Boundary corners reset.');};
  $('autoBoundary').onclick=()=>{if(!state.image)return;const m=state.image;setBoundaryPoints([{x:m.width*.08,y:m.height*.10},{x:m.width*.92,y:m.height*.10},{x:m.width*.92,y:m.height*.90},{x:m.width*.08,y:m.height*.90}]);toast('Image rectangle selected. Drag the blue corners to match the real boundary.');};
}
initBoundaryPicker();

/* ── premium project progress ───────────────────────────── */
function updateProjectProgress() {
  const stages=[
    {label:'Land image',sub:'Upload',done:!!state.image},
    {label:'AI measurement',sub:'Analyze',done:!!state.analysis},
    {label:'Plot planning',sub:'Generate',done:!!state.layout},
    {label:'Building design',sub:'Construct',done:!!state.building},
    {label:'3D studio',sub:'Explore',done:!!state.building},
    {label:'Cost estimate',sub:'Estimate',done:!!state.cost},
    {label:'Build timeline',sub:'Time + workers',done:!!state.construction},
    {label:'Project export',sub:'Save / PDF',done:!!state.exported}
  ];
  const completed=stages.filter(x=>x.done).length, percent=Math.round(completed/stages.length*100);
  const bar=$('progressBar'),pct=$('progressPercent'),steps=$('progressSteps'),msg=$('progressMessage');
  if(!bar||!pct||!steps) return;
  bar.style.width=percent+'%'; pct.textContent=percent+'%';
  const next=stages.find(x=>!x.done);
  msg.textContent=next?`Next up: ${next.label}. ${next.sub} to keep your concept moving.`:'Concept complete — your land, building, 3D view, estimate and export are ready.';
  steps.innerHTML=stages.map((x,i)=>`<div class="progress-step ${x.done?'done':''} ${!x.done&&(!i||stages[i-1].done)?'current':''}"><span>${x.done?'✓':String(i+1).padStart(2,'0')}</span><div><b>${x.label}</b><small>${x.done?'Completed':x.sub}</small></div></div>`).join('');
  if($('heroMeasureStatus')) $('heroMeasureStatus').textContent=state.analysis?`${state.analysis.confidence||'Calibrated'} confidence`:state.image?'Image uploaded':'Ready to calibrate';
  if($('heroDesignStatus')) $('heroDesignStatus').textContent=state.building?`${state.building.floors} floors · ${state.building.room_count} rooms`:'Conceptual BIM';
}
addMeasurement('Front Length', '60', false);
addMeasurement('Right Width', '100', false);
addMeasurement('Back Length', '60', false);
addMeasurement('Left Width', '100', false);
bindMeasurementScaling();
// The standard land workflow uses exactly four sides: Front/Back = Length and Left/Right = Width.
document.querySelectorAll('.measure-row .mval').forEach((el,i)=>el.setAttribute('aria-label', i%2===0?'Length in feet':'Width in feet'));
const addMeasureBtn = $('addMeasure');
if (addMeasureBtn) addMeasureBtn.onclick = () => addMeasurement(`Side ${document.querySelectorAll('.measure-row').length + 1}`, '');

/* ── click-only workspace navigation ─────────────────────── */
const WORKSPACES=['dashboard','land','site','building','constructor2d','advanced','visual','cost','construction','reports'];
function showWorkspace(id, push=true){
  const target=WORKSPACES.includes(id)?id:'dashboard';
  document.querySelectorAll('main > .section').forEach(s=>s.classList.remove('workspace-active'));
  document.querySelectorAll('[data-scroll]').forEach(b=>b.classList.toggle('active',b.dataset.scroll===target));
  const dash=$('dashboard'), prog=$('projectProgress'), stats=document.querySelector('.stats');
  const home=target==='dashboard';
  // Dashboard is a real workspace, never a persistent page underneath other screens.
  if(dash) dash.classList.toggle('dashboard-workspace-active',home);
  if(prog) prog.style.display=home?'block':'none';
  if(stats) stats.style.display=home?'grid':'none';
  const sec=$(target);
  if(!home && sec) sec.classList.add('workspace-active');
  window.scrollTo({top:0,behavior:'auto'});
  if(push) history.replaceState({workspace:target},'', '#'+target);
}
document.querySelectorAll('[data-scroll]').forEach(b=>b.onclick=()=>showWorkspace(b.dataset.scroll));
window.addEventListener('popstate',()=>showWorkspace(location.hash.slice(1)||'dashboard',false));
if(location.hash && WORKSPACES.includes(location.hash.slice(1))) showWorkspace(location.hash.slice(1),false); else showWorkspace('dashboard',false);

$('themeBtn').onclick = () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.body.classList.toggle('light', state.theme === 'light');
  $('themeBtn').textContent = state.theme === 'dark' ? '☾' : '☀';
};

/* ── image upload ────────────────────────────────────────── */
$('imageInput').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  const fd = new FormData();
  fd.append('image', f);
  try {
    state.image = await api('/api/upload', { method: 'POST', body: fd });
    state.boundaryPoints=[];
    state.boundaryCalibration={width:null,length:null}; state.boundarySideCalibration=[0,0,0,0];
    renderBoundaryPicker();
    $('landPreview').src = state.image.url;
    $('landPreview').classList.remove('hidden');
    updateProjectProgress();
    toast('Land image uploaded.');
  } catch (e) { toast(e.message); }
};

/* ── analyze ─────────────────────────────────────────────── */
$('analyzeBtn').onclick = async () => {
  if (!state.image) return toast('Upload a land image first.');
  const measurements = [...document.querySelectorAll('.measure-row')]
    .map(r => ({ name: r.querySelector('.mname').value || 'Side', value: r.querySelector('.mval').value }))
    .filter(x => Number(x.value) > 0);
  if (!measurements.length) return toast('Enter real measurements.');
  try {
    rescaleBoundaryToMeasurements(0);
    state.analysis = await api('/api/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: state.image.filename, measurements, points: state.boundaryPoints, length_ft: measurements[0]?.value, width_ft: measurements[1]?.value, dimension_locked: true })
    });
    renderAnalysis();
    updateProjectProgress();
    toast('Boundary calibrated and points marked.');
  } catch (e) { toast(e.message); }
};

function renderAnalysis() {
  const a = state.analysis;
  $('confidenceBadge').textContent = a.confidence;
  if(!state.boundaryPoints || state.boundaryPoints.length<3){
    state.boundaryPoints=(a.points||[]).map((p,i)=>({id:`P${i+1}`,x:p.x,y:p.y}));
  }
  state.boundaryCalibration={width:Number(a.width_ft||state.boundaryCalibration.width||0),length:Number(a.length_ft||state.boundaryCalibration.length||0)};
  ensureMeasurementRows(state.boundaryPoints.length);
  renderBoundaryPicker();
  $('analysisCards').innerHTML = [
    ['Area', `${a.area_sqft.toLocaleString()} sq.ft`],
    ['Length', `${a.length_ft} ft`],
    ['Width', `${a.width_ft} ft`],
    ['Perimeter', `${a.perimeter_ft} ft`],
    ['Sq.Yards', a.sq_yards],
    ['Cents', a.cents]
  ].map(x => `<div class="mini"><small>${x[0]}</small><b>${x[1]}</b></div>`).join('');
  $('warnings').innerHTML = a.warnings.map(x => `⚠ ${esc(x)}`).join('<br>');
  $('statArea').textContent = a.area_sqft.toLocaleString() + ' ft²';
  const wrap = $('landCanvas');
  wrap.innerHTML = `<img src="${state.image.url}" alt="Land"><svg class="land-svg" viewBox="0 0 ${a.image_width} ${a.image_height}" preserveAspectRatio="xMidYMid meet">${a.points.map((p, i) => {
    const q = a.points[(i + 1) % a.points.length], d = a.boundary_dimensions[i];
    return `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="#54b7ff" stroke-width="${Math.max(a.image_width, a.image_height) / 260}"/><circle cx="${p.x}" cy="${p.y}" r="${Math.max(a.image_width, a.image_height) / 65}" fill="#1977eb" stroke="#fff" stroke-width="3"/><text x="${p.x + 10}" y="${p.y - 10}" class="point-label">${p.id}</text><text x="${(p.x + q.x) / 2}" y="${(p.y + q.y) / 2 - 10}" class="dimension-label">${d.ft} ft</text>`;
  }).join('')}</svg>`;
}

/* ── site layout ─────────────────────────────────────────── */
$('generateLayouts').onclick = async () => {
  if (!state.analysis) return toast('Analyze land first.');
  try {
    const res = await api('/api/layouts/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ area_sqft: state.analysis.area_sqft, plots: $('plotCount').value, main_road_ft: $('mainRoad').value, internal_road_ft: $('internalRoad').value, park_pct: $('parkPct')?.value || 10, parking_pct: $('parkingPct')?.value || 7, boundary_points: (state.boundaryPoints||state.analysis.points||[]).map(p=>({id:p.id,x:p.x/Math.max(1,state.analysis.image_width)*100,y:p.y/Math.max(1,state.analysis.image_height)*100})), boundary_dimensions: measurementValues().map(x=>Number(x.value)), length_ft: Number(measurementValues()[0]?.value||state.analysis.length_ft||0), width_ft: Number(measurementValues()[1]?.value||state.analysis.width_ft||0) })
    });
    $('layoutOptions').innerHTML = res.layouts.map((x, i) => `<div class="layout-option"><b>${esc(x.name)}</b><small>${esc(x.description)}</small><button class="secondary" data-layout="${i}">Use this layout</button></div>`).join('');
    res.layouts.forEach((x, i) => $('layoutOptions').querySelectorAll('[data-layout]')[i].onclick = () => useLayout(x.layout));
    useLayout(res.layouts[0].layout);
    toast('Three optimized site layouts generated.');
  } catch (e) { toast(e.message); }
};

function useLayout(l) {
  state.layout = l;
  state.selectedPlot = null;
  $('selectedPlotBadge').textContent = 'No plot selected';
  renderSite();
  fillPlotSelect();
  $('statPlots').textContent = l.plots.length;
  refreshPlotEditor();
  updateProjectProgress();
}

function renderSite() {
  const l = state.layout;
  if (!l) return;
  const boundary=(l.land_boundary||[{x:5,y:8},{x:95,y:8},{x:95,y:92},{x:5,y:92}]).map(p=>`${p.x},${p.y}`).join(' ');
  const plotSvg = l.plots.map(p => { const a=p.amenities||{}; const parkPct=Math.max(5,Math.min(60,Number(a.park_size_pct||25))), parkW=Math.min(.42,parkPct/100+.12), park=a.park?`<rect class="plot-amenity park-amenity" x="${p.x+p.w*.06}" y="${p.y+p.h*.07}" width="${p.w*parkW}" height="${p.h*.25}" rx="1"/><text class="site-small amenity-label" x="${p.x+p.w*(.06+parkW/2)}" y="${p.y+p.h*.21}" text-anchor="middle">PARK</text>`:''; const parkingPct=Math.max(5,Math.min(60,Number(a.parking_size_pct||20))), parkingW=Math.min(.42,parkingPct/100+.12), parking=a.parking?`<rect class="plot-amenity parking-amenity" x="${p.x+p.w*(.94-parkingW)}" y="${p.y+p.h*.07}" width="${p.w*parkingW}" height="${p.h*.25}" rx="1"/><text class="site-small amenity-label" x="${p.x+p.w*(.94-parkingW/2)}" y="${p.y+p.h*.21}" text-anchor="middle">PARKING</text>`:''; return `<g class="plotGroup"><rect class="plot" data-plot="${p.plot_no}" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="1"/>${park}${parking}<text class="site-label" x="${p.x + p.w / 2}" y="${p.y + p.h / 2 - 1}" text-anchor="middle">PLOT ${p.plot_no}</text><text class="site-small" x="${p.x + p.w / 2}" y="${p.y + p.h / 2 + 3}" text-anchor="middle">${Math.round(p.area_sqft)} ft² · ${p.width_ft}×${p.length_ft}</text></g>`; }).join('');
  const clipId='landClip_'+Date.now();
  $('sitePlan').innerHTML = `<svg class="site-svg" viewBox="0 0 100 100" preserveAspectRatio="none"><defs><clipPath id="${clipId}"><polygon points="${boundary}"/></clipPath></defs><rect width="100" height="100" fill="#07101a"/><polygon class="land-boundary-fill" points="${boundary}"/><g clip-path="url(#${clipId})"><rect class="road" x="0" y="91" width="100" height="9"/><rect class="road" x="44" y="0" width="12" height="100"/><rect class="park" x="3" y="3" width="24" height="15" rx="1"/><text class="site-label" x="15" y="11" text-anchor="middle">COMMON PARK</text><rect class="parking" x="72" y="3" width="25" height="15" rx="1"/><text class="site-label" x="84" y="11" text-anchor="middle">COMMON PARKING</text>${plotSvg}</g><polygon class="land-boundary-stroke" points="${boundary}"/><text class="site-label" x="50" y="97">MAIN ENTRY / EXIT</text></svg>`;
  document.querySelectorAll('.plot').forEach(el => el.onclick = () => selectPlot(Number(el.dataset.plot)));
}
function refreshPlotEditor(){
  const p=state.selectedPlot; if(!p)return;
  if($('selectedPlotWidth')) $('selectedPlotWidth').value=p.width_ft||'';
  if($('selectedPlotLength')) $('selectedPlotLength').value=p.length_ft||'';
  const a=p.amenities||{}; if($('plotParkSize')) $('plotParkSize').value=a.park_size_pct||25; if($('plotParkingSize')) $('plotParkingSize').value=a.parking_size_pct||20; if($('plotAmenityStatus')) $('plotAmenityStatus').textContent=[a.park?'Park':'',a.parking?'Parking':''].filter(Boolean).join(' + ') || 'No plot amenity selected.';
}
function refreshPlotNumbers(){
  (state.layout?.plots||[]).forEach((p,i)=>p.plot_no=i+1);
  $('plotCount').value=state.layout?.plots?.length||0;
  $('statPlots').textContent=state.layout?.plots?.length||0;
  fillPlotSelect(state.selectedPlot?.plot_no);
  renderSite();
}
$('addPlot').onclick=()=>{
  if(!state.layout)return toast('Generate a layout first.');
  const plots=state.layout.plots, base=plots[plots.length-1]||{x:8,y:8,w:15,h:15,area_sqft:500,width_ft:20,length_ft:25};
  const p={...base,plot_no:plots.length+1,x:Math.min(82,base.x+3),y:Math.min(82,base.y+3),area_sqft:Math.round((base.width_ft||20)*(base.length_ft||25)),width_ft:base.width_ft||20,length_ft:base.length_ft||25};
  plots.push(p); state.selectedPlot=p; refreshPlotNumbers(); selectPlot(p.plot_no); toast('Plot added. Drag-free conceptual placement can be refined through its dimensions.');
};
$('removePlot').onclick=()=>{
  if(!state.layout||!state.selectedPlot)return toast('Select a plot first.');
  if(state.layout.plots.length<=2)return toast('Keep at least two plots.');
  state.layout.plots=state.layout.plots.filter(p=>p!==state.selectedPlot); state.selectedPlot=null; refreshPlotNumbers(); $('selectedPlotBadge').textContent='No plot selected'; toast('Selected plot removed.');
};
$('applyPlotDimensions').onclick=()=>{
  if(!state.selectedPlot)return toast('Select a plot first.');
  const w=Number($('selectedPlotWidth').value), l=Number($('selectedPlotLength').value);
  if(!(w>0&&l>0))return toast('Enter valid plot width and length.');
  state.selectedPlot.width_ft=Number(w.toFixed(2)); state.selectedPlot.length_ft=Number(l.toFixed(2)); state.selectedPlot.area_sqft=Number((w*l).toFixed(2));
  renderSite(); refreshPlotEditor(); toast(`Plot ${state.selectedPlot.plot_no} updated to ${w} × ${l} ft.`);
};
function updatePlotAmenity(type, enabled){
  if(!state.selectedPlot) return toast('Select a plot first.');
  state.selectedPlot.amenities=state.selectedPlot.amenities||{};
  state.selectedPlot.amenities[type]=enabled;
  state.selectedPlot.amenities.park_size_pct=Number($('plotParkSize')?.value||25);
  state.selectedPlot.amenities.parking_size_pct=Number($('plotParkingSize')?.value||20);
  const status=$('plotAmenityStatus');
  const parts=[]; if(state.selectedPlot.amenities.park) parts.push('Park'); if(state.selectedPlot.amenities.parking) parts.push('Parking');
  if(status) status.textContent=parts.length?`Plot ${state.selectedPlot.plot_no}: ${parts.join(' + ')} enabled.`:'No plot amenity selected.';
  renderSite(); refreshPlotEditor();
}
$('addPlotPark').onclick=()=>updatePlotAmenity('park',!(state.selectedPlot?.amenities?.park));
$('addPlotParking').onclick=()=>updatePlotAmenity('parking',!(state.selectedPlot?.amenities?.parking));
$('plotParkSize').onchange=()=>{if(state.selectedPlot){state.selectedPlot.amenities=state.selectedPlot.amenities||{};state.selectedPlot.amenities.park_size_pct=Number($('plotParkSize').value||25);renderSite();}};
$('plotParkingSize').onchange=()=>{if(state.selectedPlot){state.selectedPlot.amenities=state.selectedPlot.amenities||{};state.selectedPlot.amenities.parking_size_pct=Number($('plotParkingSize').value||20);renderSite();}};


function selectPlot(no) {
  state.selectedPlot = state.layout.plots.find(p => p.plot_no === no);
  $('selectedPlotBadge').textContent = `Plot ${no} · ${Math.round(state.selectedPlot.area_sqft)} ft²`;
  $('buildingPlot').value = String(no);
  document.querySelectorAll('.plot').forEach(p => p.classList.toggle('selected', Number(p.dataset.plot) === no));
  refreshPlotEditor();
  showWorkspace('building');
}

function fillPlotSelect(selected) {
  $('buildingPlot').innerHTML = state.layout ? state.layout.plots.map(p => `<option value="${p.plot_no}" ${selected === p.plot_no ? 'selected' : ''}>Plot ${p.plot_no} · ${Math.round(p.area_sqft)} ft²</option>`).join('') : '';
}
$('buildingPlot').onchange = () => { if (state.layout) selectPlot(Number($('buildingPlot').value)); };

/* ── building type selection ─────────────────────────────── */
const BUILDING_TYPE_INFO={
  'House': 'Independent residential house with practical family rooms.',
  'Villa': 'Premium residence with larger bedrooms, lounges and terraces.',
  'Apartment Building': 'Multi-unit residential concept with lobby, circulation and repeated living floors.',
  'Duplex': 'Two-level home with internal staircase and family spaces.',
  'Commercial Building': 'Commercial concept for reception, offices, meeting and service spaces.',
  'Office': 'Professional office building with workspaces, cabins and meeting areas.',
  'Hotel': 'Hospitality concept with reception, restaurant, guest rooms and suites.',
  'Warehouse': 'Storage and logistics concept with loading, office and utility areas.',
  'Mixed-use': 'Combined residential and commercial concept across multiple floors.'
};
function setBuildingType(type){
  const normalized=Object.prototype.hasOwnProperty.call(BUILDING_TYPE_INFO,type)?type:'House';
  $('buildingType').value=normalized;
  document.querySelectorAll('.btype-card').forEach(card=>card.classList.toggle('active',card.dataset.btype===normalized));
  if($('btypeDesc')) $('btypeDesc').textContent=BUILDING_TYPE_INFO[normalized];
  if($('customBuildingType')) $('customBuildingType').value=normalized;
  // Sensible defaults for each building family. Users can still change them.
  const defaults={
    'House':[24,30,3], 'Villa':[30,40,3], 'Apartment Building':[42,55,4], 'Duplex':[28,34,2],
    'Commercial Building':[36,50,3], 'Office':[40,55,4], 'Hotel':[45,65,4], 'Warehouse':[50,80,2], 'Mixed-use':[38,55,3]
  }[normalized]||[24,30,3];
  $('bWidth').value=defaults[0]; $('bLength').value=defaults[1]; $('floors').value=String(defaults[2]);
  toast(`${normalized} selected — click Generate Building.`);
}
document.querySelectorAll('.btype-card').forEach(card=>card.addEventListener('click',()=>setBuildingType(card.dataset.btype)));
setBuildingType($('buildingType')?.value||'House');

/* ── building generate ───────────────────────────────────── */
$('generateBuilding').onclick = async () => {
  if (!state.layout) return toast('Generate a site layout first.');
  const plot = state.layout.plots.find(p => p.plot_no === Number($('buildingPlot').value)) || state.layout.plots[0];
  try {
    state.building = await api('/api/buildings/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plot, building_type: $('buildingType').value, name: $('customBuildingName')?.value || 'My Building', style: $('buildingStyle').value,
        width_ft: $('bWidth').value, length_ft: $('bLength').value, floors: $('floors').value,
        setbacks: { front: $('setFront').value, rear: $('setRear').value, left: $('setLeft').value, right: $('setRight').value }, quality: $('quality').value, rate_per_sqft: Number($('rateSqft').value || 2200)
      })
    });
    renderBuilding();
    await calculateCost();
    await calculateConstruction();
    await renderAdvanced();
    render3D();
    updateProjectProgress();
    showWorkspace('building');
    toast('Complete multi-floor building generated. Open 2D or 3D when you are ready.');
  } catch (e) { toast(e.message); }
};

function renderBuilding() {
  (state.building?.floor_data||[]).forEach(f=>(f.rooms||[]).forEach(r=>normalizeRoomFurniture(r)));
  const b = state.building;
  $('buildingSummary').innerHTML = `Plot ${b.plot_no}<br>Built-up: <b>${b.built_up_sqft.toLocaleString()} ft²</b><br>Floors: ${b.floors} · Style: ${esc(b.style)}<br><span class="badge">${b.room_count} rooms</span>`;
  const tabs = $('floorTabs');
  tabs.innerHTML = b.floor_data.map((f, i) => `<button data-floor="${i}" class="${i === 0 ? 'active' : ''}">${f.label}</button>`).join('');
  tabs.querySelectorAll('button').forEach(x => x.onclick = () => renderFloor(Number(x.dataset.floor)));
  renderFloor(0);
  render2DConstructor(0);
}

function openCustomizeBuilding(){
  const b=state.building;
  $('customBuildingName').value=b?.name||'My Building';
  $('customBuildingType').value=b?.building_type||$('buildingType')?.value||'House';
  $('customBuildingWidth').value=b?.width_ft||$('bWidth')?.value||24;
  $('customBuildingLength').value=b?.length_ft||$('bLength')?.value||30;
  $('customBuildingFloors').value=String(b?.floors||$('floors')?.value||1);
  $('customBuildingStyle').value=b?.style||$('buildingStyle')?.value||'Modern Contemporary';
  $('customBuildingQuality').value=b?.quality||$('quality')?.value||'standard';
  $('customBuildingRate').value=b?.rate_per_sqft||$('rateSqft')?.value||2200;
  $('buildingCustomizeModal').classList.remove('hidden');
  $('buildingCustomizeModal').setAttribute('aria-hidden','false');
}
function closeCustomizeBuilding(){
  $('buildingCustomizeModal').classList.add('hidden');
  $('buildingCustomizeModal').setAttribute('aria-hidden','true');
}
$('customizeBuildingBtn').onclick=openCustomizeBuilding;
$('closeCustomizeBuilding').onclick=closeCustomizeBuilding;
$('cancelCustomizeBuilding').onclick=closeCustomizeBuilding;
$('buildingCustomizeModal').addEventListener('click',e=>{if(e.target.id==='buildingCustomizeModal')closeCustomizeBuilding();});
$('applyCustomizeBuilding').onclick=()=>{
  if(!state.layout) return toast('Generate a site layout first.');
  setBuildingType($('customBuildingType').value);
  $('bWidth').value=$('customBuildingWidth').value;
  $('bLength').value=$('customBuildingLength').value;
  $('floors').value=$('customBuildingFloors').value;
  $('buildingStyle').value=$('customBuildingStyle').value;
  $('quality').value=$('customBuildingQuality').value;
  $('rateSqft').value=$('customBuildingRate').value;
  closeCustomizeBuilding();
  $('generateBuilding').click();
};
$('addBuildingBtn').onclick=()=>{
  if(!state.layout) return toast('Generate a site layout first.');
  // Reuse the same building designer for another plot; the current building remains saved in project state until a new one is generated.
  const first=state.layout.plots?.[0];
  if(first){$('buildingPlot').value=String(first.plot_no);selectPlot(first.plot_no);}
  state.building=null;
  $('buildingSummary').innerHTML='<div class="empty-state">Configure the new building and click Generate Building.</div>';
  $('floorPlan').innerHTML='<div class="empty-state">Choose a type, dimensions and floors for the new building.</div>';
  setBuildingType('House');
  showWorkspace('building');
  toast('New building workspace ready. Choose a plot and building type.');
};

function renderFloor(i) {
  roomEditorFloor = i;

  const f = state.building.floor_data[i], b = state.building;
  document.querySelectorAll('#floorTabs button').forEach(x => x.classList.toggle('active', Number(x.dataset.floor) === i));
  const sx = 100 / b.width_ft, sy = 70 / b.length_ft;
  $('floorPlan').innerHTML = `<svg class="floor-svg" viewBox="0 0 100 80"><rect x="1" y="1" width="98" height="70" fill="#081728" stroke="#6aaee0" stroke-width="1"/>${f.rooms.map(r => {
    const x = 2 + r.x_ft * sx, y = 2 + r.y_ft * sy, w = Math.max(4, r.width_ft * sx), h = Math.max(4, r.length_ft * sy);
    return `<g><rect class="room ${r.type === 'stair' ? 'stair' : ''}" x="${x}" y="${y}" width="${w}" height="${h}" rx="1"/><text class="room-text" x="${x + w / 2}" y="${y + h / 2 - 1}" text-anchor="middle">${esc(r.name)}</text><text class="room-dim" x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle">${r.width_ft} × ${r.length_ft} ft</text></g>`;
  }).join('')}<text x="50" y="77" class="room-dim" text-anchor="middle">${b.width_ft} × ${b.length_ft} ft · conceptual floor plan</text></svg>`;
  if ($('roomEditor')) renderRoomEditor();
  if ($('constructor2dPlan')) render2DConstructor(i);
}


// ── dedicated 2D constructor ───────────────────────────────
function constructorRoomClass(name){
  const n=String(name).toLowerCase();
  if(n.includes('living')||n.includes('lounge')) return 'living';
  if(n.includes('bed')) return 'bed';
  if(n.includes('bath')||n.includes('wash')) return 'bath';
  if(n.includes('kitchen')) return 'kitchen';
  if(n.includes('dining')) return 'dining';
  return 'utility';
}
function render2DConstructor(floorIndex=0){
  const plan=$('constructor2dPlan'); if(!plan) return;
  if(!state.building){plan.innerHTML='<div class="empty-state">Generate a building in Building Constructor first.</div>';return;}
  const b=state.building, f=b.floor_data[floorIndex]||b.floor_data[0];
  const tabs=$('constructor2dTabs'); tabs.innerHTML=b.floor_data.map((fl,i)=>`<button data-c2dfloor="${i}" class="${i===floorIndex?'active':''}">${esc(fl.label)}</button>`).join('');
  tabs.querySelectorAll('[data-c2dfloor]').forEach(btn=>btn.onclick=()=>render2DConstructor(Number(btn.dataset.c2dfloor)));
  $('constructor2dMeta').textContent=`Plot ${b.plot_no} · ${b.width_ft} × ${b.length_ft} ft · ${b.room_count} rooms`;
  $('constructor2dBuilding').textContent=b.building_type; $('constructor2dFloor').textContent=f.label; $('constructor2dRooms').textContent=f.rooms.length; $('constructor2dDims').textContent=`${b.width_ft} × ${b.length_ft} ft`;
  const sx=88/Math.max(1,b.width_ft), sy=62/Math.max(1,b.length_ft);
  function furnitureSVG(r,x,y,w,h){
    const n=String(r.name).toLowerCase(); const items=Array.isArray(r.furniture_items)?r.furniture_items:((r.furniture&&r.furniture!=='none')?[r.furniture]:[]); let out='';
    const types=items.length?items:(r.furniture==='default'?[]:[]);
    types.forEach(ftype=>{
      if(ftype==='bed-set'||(ftype==='default'&&n.includes('bed'))) out+=`<rect class="c2d-furniture" x="${x+w*.18}" y="${y+h*.18}" width="${w*.48}" height="${h*.28}" rx=".7"/><rect class="c2d-furniture" x="${x+w*.22}" y="${y+h*.19}" width="${w*.12}" height="${h*.08}"/>`;
      else if(ftype==='sofa-set'||(ftype==='default'&&(n.includes('living')||n.includes('lounge')))) out+=`<rect class="c2d-furniture" x="${x+w*.18}" y="${y+h*.58}" width="${w*.62}" height="${h*.16}" rx="1"/><rect class="c2d-furniture" x="${x+w*.36}" y="${y+h*.38}" width="${w*.28}" height="${h*.12}"/>`;
      else if(ftype==='dining-set'||(ftype==='default'&&n.includes('dining'))) out+=`<ellipse class="c2d-furniture" cx="${x+w*.5}" cy="${y+h*.5}" rx="${w*.20}" ry="${h*.14}"/>`;
      else if(ftype==='kitchen-set'||(ftype==='default'&&n.includes('kitchen'))) out+=`<rect class="c2d-furniture" x="${x+w*.08}" y="${y+h*.08}" width="${w*.84}" height="${h*.15}" rx=".5"/>`;
      else if(ftype==='bath-fixtures'||(ftype==='default'&&(n.includes('bath')||n.includes('wash')))) out+=`<circle class="c2d-fixture" cx="${x+w*.30}" cy="${y+h*.35}" r="${Math.max(.8,w*.035)}"/><rect class="c2d-fixture" x="${x+w*.48}" y="${y+h*.22}" width="${w*.22}" height="${h*.24}" rx="1"/>`;
      else if(ftype==='study-set'||n.includes('study')||n.includes('office')) out+=`<rect class="c2d-furniture" x="${x+w*.18}" y="${y+h*.20}" width="${w*.55}" height="${h*.14}"/>`;
      else if(ftype==='wardrobe') out+=`<rect class="c2d-furniture" x="${x+w*.70}" y="${y+h*.08}" width="${w*.20}" height="${h*.58}"/>`;
      else if(ftype==='tv-unit') out+=`<rect class="c2d-furniture" x="${x+w*.28}" y="${y+h*.08}" width="${w*.44}" height="${h*.08}"/>`;
      else if(ftype==='toilet') out+=`<ellipse class="c2d-fixture" cx="${x+w*.70}" cy="${y+h*.35}" rx="${w*.08}" ry="${h*.10}"/>`;
      else if(ftype==='shower') out+=`<rect class="c2d-fixture" x="${x+w*.08}" y="${y+h*.62}" width="${w*.28}" height="${h*.22}"/>`;
      else if(ftype==='plant') out+=`<circle class="c2d-fixture" cx="${x+w*.84}" cy="${y+h*.82}" r="${Math.max(.8,w*.045)}"/>`;
    });
    return out;
  }
  const rooms=f.rooms.map(r=>{
    const x=6+r.x_ft*sx,y=6+r.y_ft*sy,w=Math.max(7,r.width_ft*sx),h=Math.max(6,r.length_ft*sy),cls=constructorRoomClass(r.name),short=String(r.name).length>18?String(r.name).slice(0,16)+'…':String(r.name);
    const winCount=Math.min(4,Number(r.window_count??2)); const windows=Array.from({length:winCount},(_,i)=>`<line class="c2d-window" x1="${x+w*(.18+i*.18)}" y1="${y}" x2="${x+w*(.26+i*.18)}" y2="${y}"/>`).join('');
    const doorX=r.door_position==='right'?x+w:x+w*.45, doorY=r.door_position==='right'?y+h*.45:y; const door=`<path class="c2d-door" d="M ${doorX} ${doorY} q ${w*.12} ${h*.08} ${w*.12} ${h*.16}"/>`;
    return `<g class="c2d-room ${cls}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.2"/><text class="c2d-room-name" x="${x+w/2}" y="${y+h*.42}">${esc(short)}</text><text class="c2d-room-dim" x="${x+w/2}" y="${y+h*.54}">${r.width_ft} × ${r.length_ft} ft</text>${furnitureSVG(r,x,y,w,h)}${windows}${door}</g>`;
  }).join('');
  plan.innerHTML=`<svg class="constructor2d-svg" viewBox="0 0 100 76" role="img" aria-label="${esc(f.label)} floor plan"><rect class="c2d-boundary" x="3" y="3" width="94" height="67" rx="2"/>${rooms}<text class="c2d-title" x="50" y="74">${esc(f.label)} · ${b.width_ft} × ${b.length_ft} ft · ARCHITECTURAL CONCEPT</text></svg>`;
}
$('open2dConstructor').onclick=()=>{render2DConstructor(roomEditorFloor||0);showWorkspace('constructor2d');};
$('2dBackToBuilding').onclick=()=>showWorkspace('building');
$('2dTo3d').onclick=()=>showWorkspace('visual');
$('constructor2dEditRooms').onclick=()=>showWorkspace('building');

/* ── cost ────────────────────────────────────────────────── */
async function calculateCost() {
  state.cost = await api('/api/buildings/estimate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...state.building, rate_per_sqft: Number($('rateSqft')?.value || state.building.rate_per_sqft || 2200), quality: $('quality')?.value || state.building.quality || 'standard', site_area_sqft: Number(state.analysis?.area_sqft||0), selected_plot_area_sqft: Number(state.selectedPlot?.area_sqft||0), plot_count: Number(state.layout?.plots?.length||0), site_road_area_sqft: Number((state.layout?.main_road?.area_sqft||0)+(state.layout?.internal_road?.area_sqft||0)), site_amenity_area_sqft: Number((state.layout?.common_park?.area_sqft||0)+(state.layout?.common_parking?.area_sqft||0)), land_perimeter_ft: Number(state.analysis?.perimeter_ft||0), land_length_ft: Number(state.analysis?.length_ft||0), land_width_ft: Number(state.analysis?.width_ft||0) })
  });
  state.building.quality=$('quality')?.value||state.building.quality||'standard'; state.building.rate_per_sqft=state.cost.rate_per_sqft;
  $('statBuilding').textContent = `G+${state.building.floors - 1}`;
  $('statCost').textContent = money(state.cost.project_total_inr||state.cost.approx_cost_inr);
  updateProjectProgress();
  const cards = [
    ['Project total', money(state.cost.project_total_inr||state.cost.approx_cost_inr)],['Building cost', money(state.cost.approx_cost_inr)],['Land area', Number(state.cost.site_area_sqft||0).toLocaleString() + ' ft²'],['Selected plot', Number(state.cost.selected_plot_area_sqft||0).toLocaleString() + ' ft²'],['Cement', state.cost.cement_tonnes + ' t'],['Steel', state.cost.steel_tonnes + ' t'],
    ['Bricks/blocks', state.cost.bricks_blocks.toLocaleString()],['Sand', state.cost.sand_cuft.toLocaleString() + ' ft³'],['Flooring', state.cost.flooring_sqft.toLocaleString() + ' ft²'],['Paint', state.cost.paint_sqft.toLocaleString() + ' ft²'],['Rate', money(state.cost.rate_per_sqft) + '/ft²'],['Site development', money(state.cost.site_development_inr||0)],['Project total', money(state.cost.project_total_inr||state.cost.approx_cost_inr)]
  ];
  $('costPanel').innerHTML = cards.map(c => `<div class="cost-card"><small>${c[0]}</small><b>${c[1]}</b></div>`).join('');
  const total=state.cost.project_total_inr||state.cost.approx_cost_inr, material=state.cost.material_inr, labour=state.cost.labour_inr, siteDev=state.cost.site_development_inr||0, other=Math.max(0,total-material-labour-siteDev);
  const costParts=[['Materials',material,'#2e8cff'],['Labour',labour,'#48d597'],['Site development',siteDev,'#8b7cff'],['Other',other,'#ffbe63']];
  renderDonut('costDonut','costLegend',costParts,total,'Project total');
  const mats=[['Steel',state.cost.steel_tonnes*1000,'#4b9cff'],['Cement',state.cost.cement_tonnes*1000,'#6fc2ff'],['Bricks',state.cost.bricks_blocks/100,'#8fd6a9'],['Sand',state.cost.sand_cuft/10,'#f3c36b'],['Flooring',state.cost.flooring_sqft/20,'#d39cff'],['Paint',state.cost.paint_sqft/40,'#ff8c9a']];
  const matTotal=mats.reduce((a,x)=>a+x[1],0); renderDonut('materialDonut','materialLegend',mats,matTotal,'Materials');
  return;
  
}
function renderDonut(chartId,legendId,parts,total,label){
  const chart=$(chartId), legend=$(legendId); if(!chart||!legend)return;
  let start=0; const stops=parts.map(p=>{const pct=total?Math.max(0,p[1]/total*100):0;const s=`${p[2]} ${start.toFixed(2)}% ${(start+pct).toFixed(2)}%`;start+=pct;return s;});
  chart.style.background=`conic-gradient(${stops.join(',')})`;
  chart.innerHTML=`<div class="donut-hole"><b>${label==='Total'?money(total):'100%'}</b><small>${label}</small></div>`;
  legend.innerHTML=parts.map(p=>{const pct=total?Math.round(p[1]/total*100):0;return `<div class="legend-row"><span><i style="background:${p[2]}"></i>${esc(p[0])}</span><b>${pct}%</b></div>`}).join('');
}

/* ── construction time + workforce ───────────────────────── */
async function calculateConstruction() {
  if (!state.building) return;
  try {
    state.construction = await api('/api/buildings/construction', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({building:state.building})
    });
    const c=state.construction;
    $('constructionSummary').innerHTML=[
      ['Approx. duration', `${c.months} months`, `${c.total_days} days`],
      ['Peak workforce', `${c.peak_workers} workers`, 'highest active phase'],
      ['Average workforce', `${c.average_workers} workers`, 'across phases'],
      ['Project scale', `${Number(c.area_sqft).toLocaleString()} ft²`, `${c.floors} floors · ${c.rooms} rooms`]
    ].map(x=>`<div class="construction-kpi"><small>${x[0]}</small><strong>${x[1]}</strong><span>${x[2]}</span></div>`).join('');
    $('constructionTimeline').innerHTML=c.phases.map((p,i)=>`<div class="timeline-row"><div class="timeline-dot">${i+1}</div><div class="timeline-main"><div class="timeline-title"><b>${esc(p.phase)}</b><span>${p.days} days · ${p.workers} workers</span></div><div class="timeline-bar"><i style="width:${Math.max(12,Math.min(100,p.days/Math.max(...c.phases.map(x=>x.days))*100))}%"></i></div><small>${esc(p.description)}</small></div></div>`).join('');
    $('workforcePanel').innerHTML=c.phases.map(p=>`<div class="workforce-row"><div><b>${esc(p.phase)}</b><small>${p.days} days</small></div><strong>${p.workers}</strong></div>`).join('');
    updateProjectProgress();
  } catch(e) { console.warn(e); toast(e.message); }
}

/* ── advanced / AI ───────────────────────────────────────── */
async function renderAdvanced() {
  if (!state.building) return;
  try {
    const [v, s] = await Promise.all([
      api('/api/buildings/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.building) }),
      api('/api/buildings/sustainability', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.building) })
    ]);
    $('validationPanel').innerHTML = `<div class="advanced-card"><b>Plan validation</b><strong>${v.score}/100</strong><small>${v.valid ? '✓ Layout passes conceptual checks' : '⚠ Review warnings'}</small>${v.warnings.map(x => `<span>• ${esc(x)}</span>`).join('')}</div><div class="advanced-card"><b>Sustainability</b><strong>${s.score}/100</strong><small>Lighting ${s.lighting} · Ventilation ${s.ventilation}</small><span>Solar potential ${s.solar_potential}</span></div>`;
    $('sunPanel').innerHTML = `<div class="advanced-card"><b>☀ Sun &amp; ventilation</b><strong>${s.daylight_index}/100</strong><small>${esc(s.recommendation)}</small></div>`;
  } catch (e) { console.warn(e); }
}

$('aiCustomize').onclick = async () => {
  if (!state.building) return toast('Generate a building first.');
  const cmd = $('aiCommand').value.trim();
  if (!cmd) return toast('Describe a change first.');
  try {
    state.building = await api('/api/buildings/customize', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ building: state.building, command: cmd })
    });
    renderBuilding();
    await calculateCost();
    await calculateConstruction();
    await renderAdvanced();
    render3D();
    $('aiCommand').value = '';
    updateProjectProgress();
    toast('AI-style building change applied.');
  } catch (e) { toast(e.message); }
};

/* ========================================================
   ADVANCED THREE.JS 3D STUDIO
   ======================================================== */
/* =============================================================
   HELPERS — 3D construction
   ============================================================= */

function roomColor(name) {
  const n = name.toLowerCase();
  if (n.includes('bed')) return 0x264a6a;
  if (n.includes('bath') || n.includes('wash')) return 0x245560;
  if (n.includes('kitchen')) return 0x5a3e28;
  if (n.includes('living')) return 0x3a4a60;
  if (n.includes('dining')) return 0x5a4030;
  if (n.includes('stair')) return 0x2e3c48;
  if (n.includes('balcon') || n.includes('terrace')) return 0x2e5a3e;
  if (n.includes('study') || n.includes('office')) return 0x3e4e6a;
  if (n.includes('parking')) return 0x404848;
  return 0x384858;
}

function buildLighting(scene, b, FH) {
  const ambient = new THREE.AmbientLight(0x405060, 0.7);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xfff5e0, 2.2);
  sun.position.set(30, 50, 20);
  sun.castShadow = true;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 300;
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.001;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x8fb0d0, 0.4);
  fill.position.set(-20, 10, -10);
  scene.add(fill);

  const hemi = new THREE.HemisphereLight(0x6090b0, 0x0a1828, 0.5);
  scene.add(hemi);

  // Point lights inside floors
  for (let i = 0; i < (b.floors || 1); i++) {
    const pl = new THREE.PointLight(0xfff8e0, 0.6, 20);
    pl.position.set(b.width_ft * 0.3048 / 2, i * FH + FH * 0.6, b.length_ft * 0.3048 / 2);
    scene.add(pl);
  }

  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x8bb8d4, 60, 250);

  return { ambient, sun, fill, hemi };
}

function buildMaterials() {
  return {
    exterior: new THREE.MeshStandardMaterial({ color: 0xdde8f0, roughness: 0.55, metalness: 0.05 }),
    slab: new THREE.MeshStandardMaterial({ color: 0xc8d4dc, roughness: 0.45, metalness: 0.05 }),
    partition: new THREE.MeshStandardMaterial({ color: 0xbcc8d2, roughness: 0.7, metalness: 0.0 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x263744, roughness: 0.75, metalness: 0.1 }),
    stair: new THREE.MeshStandardMaterial({ color: 0x6a7880, roughness: 0.6, metalness: 0.05 }),
    railing: new THREE.MeshStandardMaterial({ color: 0x8090a0, roughness: 0.4, metalness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x88c8f8, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x8b5e3c, roughness: 0.8, metalness: 0.0 }),
    boundary: new THREE.MeshStandardMaterial({ color: 0x4a6070, roughness: 0.8, metalness: 0.05 }),
  };
}

function buildExteriorWalls(group, BW, BL, FH, baseY, wallThick, mats, fi, totalFloors) {
  // Window parameters
  const winH = FH * 0.42, winY = baseY + FH * 0.3, winW = 1.2;
  const doorH = FH * 0.72, doorW = 1.0;

  // Helper to make a wall panel with window openings
  function wallPanel(x, y, z, w, h, d, isGround, hasDoor) {
    const wallMat = mats.exterior;

    if (!isGround && !hasDoor) {
      // simple solid panel
      const geo = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Mesh(geo, wallMat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    } else {
      // wall with windows: place top, bottom, and side panels around windows
      const numWins = Math.max(1, Math.floor(w / (winW * 2.5)));
      const panelH_bottom = winY - baseY;
      const panelH_top = baseY + FH - (winY + winH);
      const segment = w / numWins;

      // bottom band
      const bBot = new THREE.BoxGeometry(w, Math.max(0.1, panelH_bottom), d);
      const mBot = new THREE.Mesh(bBot, wallMat);
      mBot.position.set(x, baseY + panelH_bottom / 2, z);
      mBot.castShadow = true; group.add(mBot);

      // top band
      const bTop = new THREE.BoxGeometry(w, Math.max(0.1, panelH_top), d);
      const mTop = new THREE.Mesh(bTop, wallMat);
      mTop.position.set(x, winY + winH + panelH_top / 2, z);
      mTop.castShadow = true; group.add(mTop);

      for (let wi = 0; wi < numWins; wi++) {
        const wx = x - w / 2 + segment * wi + segment / 2;
        const gapRatio = hasDoor && wi === 0 ? doorW : winW;
        const sideW = (segment - gapRatio) / 2;

        // left side
        const bL = new THREE.BoxGeometry(sideW, winH, d);
        const mL = new THREE.Mesh(bL, wallMat);
        mL.position.set(wx - gapRatio / 2 - sideW / 2, winY + winH / 2, z);
        mL.castShadow = true; group.add(mL);

        // right side
        const bR = new THREE.BoxGeometry(sideW, winH, d);
        const mR = new THREE.Mesh(bR, wallMat);
        mR.position.set(wx + gapRatio / 2 + sideW / 2, winY + winH / 2, z);
        mR.castShadow = true; group.add(mR);

        if (hasDoor && wi === 0) {
          // door panel (solid, dark)
          const doorMat = new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.8, metalness: 0.1 });
          const dBot = new THREE.BoxGeometry(doorW - 0.04, doorH, d * 0.6);
          const dMesh = new THREE.Mesh(dBot, doorMat);
          dMesh.position.set(wx, baseY + doorH / 2, z);
          group.add(dMesh);
        } else {
          // glass window
          const gGeo = new THREE.BoxGeometry(gapRatio - 0.06, winH - 0.06, d * 0.4);
          const gMesh = new THREE.Mesh(gGeo, mats.glass);
          gMesh.position.set(wx, winY + winH / 2, z);
          group.add(gMesh);
        }
      }
    }
  }

  // front wall (Z=0) with door on ground floor
  wallPanel(BW / 2, baseY + FH / 2, wallThick / 2, BW, FH, wallThick, false, fi === 0);
  // back wall
  wallPanel(BW / 2, baseY + FH / 2, BL - wallThick / 2, BW, FH, wallThick, fi === 0, false);
  // left wall (X=0)
  wallPanel(wallThick / 2, baseY + FH / 2, BL / 2, wallThick, FH, BL, fi === 0, false);
  // right wall
  wallPanel(BW - wallThick / 2, baseY + FH / 2, BL / 2, wallThick, FH, BL, fi === 0, false);
}

function buildInteriorPartitions(rx, rz, rw, rl, baseY, FH, mat) {
  const t = 0.08, h = FH * 0.75;
  const meshes = [];
  function wall(x, y, z, w, d) {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    meshes.push(m);
  }
  // just two inner walls per room (avoid double-counting)
  wall(rx + rw, baseY, rz + rl / 2, t, rl);
  wall(rx + rw / 2, baseY, rz + rl, rw, t);
  return meshes;
}

function buildStaircase(group, rx, baseY, rz, rw, rl, FH, mat) {
  const steps = 12;
  const stepH = FH / steps;
  const stepD = rl / steps;
  for (let i = 0; i < steps; i++) {
    const g = new THREE.BoxGeometry(rw * 0.7, stepH, stepD);
    const m = new THREE.Mesh(g, mat);
    m.position.set(rx + rw / 2, baseY + stepH / 2 + i * stepH, rz + stepD / 2 + i * stepD);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  // railing
  const railMat = new THREE.MeshStandardMaterial({ color: 0x8090a8, roughness: 0.4, metalness: 0.5 });
  const railGeo = new THREE.BoxGeometry(0.05, FH * 0.85, rl);
  const rail = new THREE.Mesh(railGeo, railMat);
  rail.position.set(rx + rw * 0.2, baseY + FH * 0.85 / 2, rz + rl / 2);
  group.add(rail);
}

function buildFurniture(roomName, rx, baseY, rz, rw, rl, FT) {
  const n = roomName.toLowerCase();
  const meshes = [];
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x7a5535, roughness: 0.85, metalness: 0.0 });
  const cushMat = new THREE.MeshStandardMaterial({ color: 0x3a4a6a, roughness: 0.9, metalness: 0.0 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xdde8f0, roughness: 0.5, metalness: 0.05 });

  function box3(cx, cy, cz, w, h, d, mat) {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(g, mat);
    m.position.set(cx, cy, cz);
    m.castShadow = true;
    m.receiveShadow = true;
    meshes.push(m);
  }

  if (n.includes('bed')) {
    // bed frame
    box3(rx + rw * 0.5, baseY + 0.25, rz + rl * 0.45, rw * 0.55, 0.3, rl * 0.55, woodMat);
    // mattress
    box3(rx + rw * 0.5, baseY + 0.44, rz + rl * 0.45, rw * 0.52, 0.12, rl * 0.5, cushMat);
    // headboard
    box3(rx + rw * 0.5, baseY + 0.7, rz + rl * 0.18, rw * 0.52, 0.55, 0.08, woodMat);
    // bedside table
    box3(rx + rw * 0.82, baseY + 0.3, rz + rl * 0.35, 0.3, 0.45, 0.3, woodMat);
  } else if (n.includes('living')) {
    // sofa
    box3(rx + rw * 0.5, baseY + 0.24, rz + rl * 0.62, rw * 0.65, 0.38, rl * 0.22, cushMat);
    // backrest
    box3(rx + rw * 0.5, baseY + 0.5, rz + rl * 0.7, rw * 0.65, 0.35, 0.1, cushMat);
    // coffee table
    box3(rx + rw * 0.5, baseY + 0.22, rz + rl * 0.42, rw * 0.35, 0.06, rl * 0.18, woodMat);
  } else if (n.includes('dining')) {
    // table
    box3(rx + rw * 0.5, baseY + 0.37, rz + rl * 0.5, rw * 0.5, 0.05, rl * 0.35, woodMat);
    // table legs
    [[-0.22, -0.14], [0.22, -0.14], [-0.22, 0.14], [0.22, 0.14]].forEach(([dx, dz]) => {
      box3(rx + rw * 0.5 + dx * rw, baseY + 0.19, rz + rl * 0.5 + dz * rl, 0.05, 0.38, 0.05, woodMat);
    });
    // chairs
    [[-0.32, 0], [0.32, 0], [0, -0.22], [0, 0.22]].forEach(([dx, dz]) => {
      box3(rx + rw * 0.5 + dx * rw, baseY + 0.2, rz + rl * 0.5 + dz * rl, rw * 0.12, 0.36, 0.12, woodMat);
    });
  } else if (n.includes('kitchen')) {
    // counter
    box3(rx + rw * 0.5, baseY + 0.45, rz + rl * 0.12, rw * 0.85, 0.9, rl * 0.18, woodMat);
    box3(rx + rw * 0.5, baseY + 0.92, rz + rl * 0.12, rw * 0.85, 0.04, rl * 0.18, whiteMat);
    // upper cabinet
    box3(rx + rw * 0.5, baseY + 1.7, rz + rl * 0.1, rw * 0.75, 0.5, rl * 0.14, woodMat);
  } else if (n.includes('study') || n.includes('office')) {
    // desk
    box3(rx + rw * 0.38, baseY + 0.37, rz + rl * 0.2, rw * 0.6, 0.04, rl * 0.26, woodMat);
    // chair
    box3(rx + rw * 0.38, baseY + 0.22, rz + rl * 0.35, rw * 0.2, 0.4, rw * 0.2, cushMat);
    // monitor (simple)
    box3(rx + rw * 0.38, baseY + 0.75, rz + rl * 0.14, rw * 0.22, 0.3, 0.04, whiteMat);
  }

  return meshes;
}

function buildRoof(BW, BL, roofY, mats) {
  const group = new THREE.Group();
  group.name = 'roof';

  // flat slab parapet
  const slabGeo = new THREE.BoxGeometry(BW + 0.3, 0.18, BL + 0.3);
  const slab = new THREE.Mesh(slabGeo, mats.roof);
  slab.position.set(BW / 2, roofY + 0.09, BL / 2);
  slab.castShadow = true;
  slab.receiveShadow = true;
  group.add(slab);

  // parapet walls
  const parapetH = 0.9, parapetT = 0.18;
  const parapetMat = new THREE.MeshStandardMaterial({ color: 0x2a3a4a, roughness: 0.7, metalness: 0.1 });
  function parapet(x, y, z, w, d) {
    const g = new THREE.BoxGeometry(w, parapetH, d);
    const m = new THREE.Mesh(g, parapetMat);
    m.position.set(x, y + parapetH / 2, z);
    m.castShadow = true;
    group.add(m);
  }
  parapet(BW / 2, roofY + 0.18, parapetT / 2, BW + 0.3, parapetT);
  parapet(BW / 2, roofY + 0.18, BL - parapetT / 2, BW + 0.3, parapetT);
  parapet(parapetT / 2, roofY + 0.18, BL / 2, parapetT, BL);
  parapet(BW - parapetT / 2, roofY + 0.18, BL / 2, parapetT, BL);

  // overhead water tank
  const tankGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.1, 12);
  const tankMat = new THREE.MeshStandardMaterial({ color: 0x607080, roughness: 0.5, metalness: 0.4 });
  const tank = new THREE.Mesh(tankGeo, tankMat);
  tank.position.set(BW * 0.75, roofY + 1.18 + 0.55, BL * 0.25);
  tank.castShadow = true;
  group.add(tank);

  // solar panel array
  const solarMat = new THREE.MeshStandardMaterial({ color: 0x1a2840, roughness: 0.3, metalness: 0.6 });
  for (let i = 0; i < 3; i++) {
    const sg = new THREE.BoxGeometry(1.6, 0.05, 0.8);
    const sm = new THREE.Mesh(sg, solarMat);
    sm.position.set(BW * 0.3 + i * 1.8, roofY + 0.35, BL * 0.35);
    sm.rotation.x = -Math.PI / 8;
    group.add(sm);
  }

  return group;
}

function buildBoundary(BW, BL, mats) {
  const group = new THREE.Group();
  group.name = 'boundary';
  const wallH = 1.8, wallT = 0.22;

  function wall(x, y, z, w, d) {
    const g = new THREE.BoxGeometry(w, wallH, d);
    const m = new THREE.Mesh(g, mats.boundary);
    m.position.set(x, y + wallH / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }

  const pad = 2.5;
  wall(BW / 2, -0.05, -pad + wallT / 2, BW + 2 * pad, wallT);
  wall(BW / 2, -0.05, BL + pad - wallT / 2, BW + 2 * pad, wallT);
  wall(-pad + wallT / 2, -0.05, BL / 2, wallT, BL + 2 * pad);
  wall(BW + pad - wallT / 2, -0.05, BL / 2, wallT, BL + 2 * pad);

  // driveway
  const drvGeo = new THREE.BoxGeometry(BW * 0.3, 0.02, pad);
  const drvMat = new THREE.MeshStandardMaterial({ color: 0x2a3540, roughness: 0.95, metalness: 0.05 });
  const drv = new THREE.Mesh(drvGeo, drvMat);
  drv.position.set(BW / 2, 0.01, -pad / 2);
  drv.receiveShadow = true;
  group.add(drv);

  // gate posts
  [BW / 2 - BW * 0.17, BW / 2 + BW * 0.17].forEach(px => {
    const g = new THREE.BoxGeometry(0.3, 2.2, 0.3);
    const m = new THREE.Mesh(g, mats.boundary);
    m.position.set(px, 1.1, -pad + 0.15);
    m.castShadow = true;
    group.add(m);
  });

  // landscape: trees (simple cylinders)
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3a1a, roughness: 0.9, metalness: 0 });
  const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2e5c2e, roughness: 0.95, metalness: 0 });
  function tree(x, z) {
    const tg = new THREE.CylinderGeometry(0.08, 0.12, 1.2, 6);
    const tm = new THREE.Mesh(tg, trunkMat);
    tm.position.set(x, 0.6, z);
    tm.castShadow = true;
    group.add(tm);
    const lg = new THREE.SphereGeometry(0.55, 6, 5);
    const lm = new THREE.Mesh(lg, leavesMat);
    lm.position.set(x, 1.8, z);
    lm.castShadow = true;
    group.add(lm);
  }
  [[-1.5, 1], [-1.5, BL - 1], [BW + 1.5, 1], [BW + 1.5, BL - 1]].forEach(([x, z]) => tree(x, z));

  return group;
}

/* ── inline orbit controls (no import needed) ── */
function buildOrbitControls(camera, domElement) {
  const ctrl = {
    enabled: true,
    target: new THREE.Vector3(),
    minDistance: 1, maxDistance: 300,
    minPolarAngle: 0, maxPolarAngle: Math.PI * 0.9,
    enableDamping: true, dampingFactor: 0.08,
    _spherical: new THREE.Spherical(),
    _delta: new THREE.Spherical(),
    _panOffset: new THREE.Vector3(),
    _dragging: false, _button: -1,
    _lastMouse: { x: 0, y: 0 },
    _scale: 1,
    dispose() {
      domElement.removeEventListener('pointerdown', onDown);
      domElement.removeEventListener('pointermove', onMove);
      domElement.removeEventListener('pointerup', onUp);
      domElement.removeEventListener('wheel', onWheel);
      domElement.removeEventListener('contextmenu', onCtx);
    }
  };

  // Initialise spherical from current camera position
  function syncSpherical() {
    const offset = new THREE.Vector3().subVectors(camera.position, ctrl.target);
    ctrl._spherical.setFromVector3(offset);
  }
  syncSpherical();

  function onDown(e) {
    if (!ctrl.enabled) return;
    ctrl._dragging = true;
    ctrl._button = e.button;
    ctrl._lastMouse.x = e.clientX;
    ctrl._lastMouse.y = e.clientY;
    domElement.setPointerCapture(e.pointerId);
  }

  function onMove(e) {
    if (!ctrl._dragging || !ctrl.enabled) return;
    const dx = e.clientX - ctrl._lastMouse.x;
    const dy = e.clientY - ctrl._lastMouse.y;
    ctrl._lastMouse.x = e.clientX;
    ctrl._lastMouse.y = e.clientY;

    const rect = domElement.getBoundingClientRect();
    if (ctrl._button === 0) {
      // orbit
      ctrl._spherical.theta -= (dx / rect.width) * Math.PI * 1.6;
      ctrl._spherical.phi -= (dy / rect.height) * Math.PI * 1.2;
      ctrl._spherical.phi = Math.max(ctrl.minPolarAngle + 0.01, Math.min(ctrl.maxPolarAngle - 0.01, ctrl._spherical.phi));
    } else if (ctrl._button === 2) {
      // pan
      const dist = ctrl._spherical.radius;
      const factor = dist * 0.0015;
      const right = new THREE.Vector3();
      const up = new THREE.Vector3();
      right.crossVectors(camera.getWorldDirection(new THREE.Vector3()), camera.up).normalize();
      up.copy(camera.up).normalize();
      ctrl._panOffset.addScaledVector(right, -dx * factor);
      ctrl._panOffset.addScaledVector(up, dy * factor);
    }
    _applyToCamera();
  }

  function onUp() { ctrl._dragging = false; }

  function onWheel(e) {
    if (!ctrl.enabled) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? 1.08 : 0.92;
    ctrl._spherical.radius = Math.max(ctrl.minDistance, Math.min(ctrl.maxDistance, ctrl._spherical.radius * delta));
    _applyToCamera();
  }

  function onCtx(e) { e.preventDefault(); }

  function _applyToCamera() {
    ctrl._spherical.makeSafe();
    const offset = new THREE.Vector3().setFromSpherical(ctrl._spherical);
    ctrl.target.add(ctrl._panOffset);
    ctrl._panOffset.set(0, 0, 0);
    camera.position.copy(ctrl.target).add(offset);
    camera.lookAt(ctrl.target);
  }

  ctrl.update = () => {
    syncSpherical();
    _applyToCamera();
  };

  domElement.addEventListener('pointerdown', onDown);
  domElement.addEventListener('pointermove', onMove);
  domElement.addEventListener('pointerup', onUp);
  domElement.addEventListener('wheel', onWheel, { passive: false });
  domElement.addEventListener('contextmenu', onCtx);

  return ctrl;
}

/* ── text label sprite ── */
function makeTextSprite(line1, line2) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 80;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(12,26,44,0.72)';
  ctx.fillRect(4, 4, 248, 72);
  ctx.fillStyle = '#e8f4ff';
  ctx.font = 'bold 22px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(line1, 128, 34);
  ctx.fillStyle = '#88b8d8';
  ctx.font = '16px Arial';
  ctx.fillText(line2, 128, 58);

  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2.2, 0.7, 1);
  return sprite;
}

/* ── 3D control buttons ── */
$('allFloors').onclick = () => {
  if (!state.three) return;
  state.three.floorGroups.forEach((g, i) => {
    g.visible = true;
    state.three.furnitureGroups[i].visible = $('furnitureMode').value === 'on';
  });
  document.querySelectorAll('.fvis-btn').forEach(b => b.classList.add('active'));
};

$('explode').onclick = () => {
  if (!state.three) return;
  const next = !state.three.exploded;
  state.three.setExplode(next);
  $('explode').textContent = next ? 'Collapse' : 'Explode';
};

$('roofBtn').onclick = () => {
  if (!state.three) return;
  state.three.roofVisible = !state.three.roofVisible;
  $('roofBtn').textContent = state.three.roofVisible ? 'Hide Roof' : 'Show Roof';
};

$('walkBtn').onclick = () => {
  if (!state.three) return toast('Generate the building first.');
  const now = !state.three.walkthrough;
  state.three.walkthrough = now;
  $('walkBtn').textContent = now ? 'Exit Walkthrough' : 'Walkthrough';
  if (now) toast('Walkthrough mode — use W/A/S/D or arrow keys to move');
};

$('resetCam').onclick = () => {
  if (!state.three) return;
  state.three.resetCamera();
  $('explode').textContent = 'Explode';
  $('walkBtn').textContent = 'Walkthrough';
};

$('apply3d').onclick = () => {
  if (!state.three) return toast('Generate a building first.');
  state.three.applyVisualization();
  toast('Visualization updated.');
};
$('apply3dColors').onclick=saveVisualColors;
$('applyFurniturePreset').onclick=applyFurniturePreset;
$('clearRoomFurniture').onclick=clearRoomFurniture;

$('full3d').onclick = () => {
  const wrap = $('threeWrap');
  if (wrap.requestFullscreen) wrap.requestFullscreen();
  else if (wrap.webkitRequestFullscreen) wrap.webkitRequestFullscreen();
};
$('interiorCutaway').onclick=()=>{ if(!state.three)return toast('Generate a building first.'); const next=!state.three.interiorCutaway; state.three.setInteriorCutaway(next); $('interiorCutaway').textContent=next?'Standard 3D':'Interior Cutaway'; $('roofBtn').textContent=next?'Show Roof':'Hide Roof'; toast(next?'Interior cutaway enabled — rooms and furniture are exposed.':'Standard architectural 3D restored.'); };

/* ── project save / load ── */
$('saveProject').onclick = async () => {
  if (!state.analysis) return toast('Analyze the land first.');
  try {
    const saved = await api('/api/projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: $('projectName').value || 'My LandLens Project', state: { analysis: state.analysis, layout: state.layout, building: state.building, cost: state.cost, construction: state.construction, image: state.image } })
    });
    state.currentProjectId=saved.id; $('deleteCurrentProject').disabled=false; state.exported=true;
    updateProjectProgress();
    toast('Project saved.');
    loadHistory();
  } catch (e) { toast(e.message); }
};

$('downloadReport').onclick = async () => {
  if (!state.analysis) return toast('Analyze the land first.');
  try {
    const p = await api('/api/reports/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: { analysis: state.analysis, layout: state.layout, building: state.building, cost: state.cost, construction: state.construction } })
    });
    state.exported=true;
    updateProjectProgress();
    window.location.href = p.url;
  } catch (e) { toast(e.message); }
};

async function deleteProject(pid, refresh=true){
  if(!confirm('Delete this project permanently?')) return;
  try{await api('/api/projects/'+encodeURIComponent(pid),{method:'DELETE'}); if(refresh) loadHistory(); if(state.currentProjectId===pid){state.currentProjectId=null; $('deleteCurrentProject').disabled=true;} toast('Project deleted.');}
  catch(e){toast(e.message)}
}
$('deleteCurrentProject').onclick=()=>{if(state.currentProjectId) deleteProject(state.currentProjectId); else toast('Save or open a project first.');};

async function loadHistory() {
  try {
    const list = await api('/api/projects');
    $('projectHistory').innerHTML = list.length
      ? list.map(p => `<div class="history-item"><div><b>${esc(p.name)}</b><small style="display:block;color:#8298ad">${new Date(p.updated_at).toLocaleString()}</small></div><div class="history-actions"><button class="secondary" data-open="${p.id}">Open</button><button class="danger-mini" data-delete="${p.id}">🗑</button></div></div>`).join('')
      : '<div class="empty-state">No saved projects yet.</div>';
    document.querySelectorAll('[data-open]').forEach(b => b.onclick = async () => {
      const p = await api('/api/projects/' + b.dataset.open);
      if (p.state) {
        Object.assign(state, p.state);
        if (state.analysis) renderAnalysis();
        if (state.layout) { renderSite(); fillPlotSelect(); }
        if (state.building) { renderBuilding(); await calculateCost(); await renderAdvanced(); render3D(); }
      }
      updateProjectProgress();
      state.currentProjectId=p.id; $('deleteCurrentProject').disabled=false;
      toast('Project loaded.');
    });
    document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>deleteProject(b.dataset.delete));
  } catch {}
}

$('newProject').onclick = () => location.reload();
updateProjectProgress();
loadHistory();

/* ============================================================
   OFFLINE 3D RENDERER — Photorealistic Isometric Engine
   High-quality Canvas 2D with realistic materials & lighting
   ============================================================ */
function ensureVisualSettings(){
  if(!state.building) return;
  state.building.visual=state.building.visual||{};
  state.building.visual.buildingColor=state.building.visual.buildingColor||'#e8e4dc';
  state.building.visual.floorColors=state.building.visual.floorColors||[];
  (state.building.floor_data||[]).forEach((f,i)=>{
    if(!state.building.visual.floorColors[i]) state.building.visual.floorColors[i]=state.building.visual.buildingColor;
  });
}
function renderFloorColorControls(){
  const wrap=$('floorColorControls'); if(!wrap||!state.building)return;
  ensureVisualSettings();
  if($('buildingColor')) $('buildingColor').value=state.building.visual.buildingColor;
  wrap.innerHTML=(state.building.floor_data||[]).map((f,i)=>`<label>${esc(f.label||`Floor ${i+1}`)}<input type="color" data-floor-color="${i}" value="${state.building.visual.floorColors[i]}"></label>`).join('');
}
function saveVisualColors(){
  if(!state.building)return;
  ensureVisualSettings();
  state.building.visual.buildingColor=$('buildingColor')?.value||state.building.visual.buildingColor;
  document.querySelectorAll('[data-floor-color]').forEach(el=>{state.building.visual.floorColors[Number(el.dataset.floorColor)]=el.value;});
  render3D();
  toast('Building and floor colors updated.');
}
function normalizeRoomFurniture(r){
  if(!r) return [];
  if(Array.isArray(r.furniture_items)) return r.furniture_items;
  const f=r.furniture||'default';
  if(!f || f==='none') return [];
  r.furniture_items=[f];
  return r.furniture_items;
}
function furnitureLabel(type){
  return ({'bed-set':'Bed + side tables','wardrobe':'Wardrobe','sofa-set':'Sofa + coffee table','dining-set':'Dining table + chairs','kitchen-set':'Kitchen counter','bath-fixtures':'Bathroom fixtures','study-set':'Study desk + chair','car':'Car / parking','tv-unit':'TV unit','toilet':'Toilet / WC','shower':'Shower','plant':'Indoor plant','coffee-table':'Coffee table','chair':'Chair','sink':'Wash basin / sink','bathtub':'Bathtub','bookshelf':'Bookshelf','fridge':'Refrigerator','stove':'Stove / hob','cabinet':'Storage cabinet'})[type]||type;
}
function updateFurniturePresetOptions(room){
  const select=$('furniturePreset'); if(!select||!room) return;
  const n=String(room.name||'').toLowerCase();
  let options=[
    ['bed-set','🛏 Bed'],['wardrobe','🚪 Wardrobe'],['sofa-set','🛋 Sofa'],['coffee-table','☕ Coffee table'],
    ['dining-set','🍽 Dining table'],['kitchen-set','🍳 Kitchen counter'],['fridge','🧊 Refrigerator'],['stove','🔥 Stove / hob'],
    ['bath-fixtures','🚿 Bathroom fixtures'],['toilet','🚽 Toilet / WC'],['shower','🚿 Shower'],['sink','🧼 Wash basin'],['bathtub','🛁 Bathtub'],
    ['study-set','🖥 Study desk'],['chair','🪑 Chair'],['tv-unit','📺 TV unit'],['bookshelf','📚 Bookshelf'],['cabinet','🗄 Storage cabinet'],
    ['plant','🌿 Indoor plant'],['car','🚗 Car / parking']
  ];
  if(n.includes('bed')) options=[['bed-set','🛏 Bed'],['wardrobe','🚪 Wardrobe'],['tv-unit','📺 TV unit'],['bookshelf','📚 Bookshelf'],['plant','🌿 Indoor plant']];
  else if(n.includes('bath')||n.includes('wash')) options=[['toilet','🚽 Toilet / WC'],['shower','🚿 Shower'],['sink','🧼 Wash basin'],['bathtub','🛁 Bathtub'],['bath-fixtures','🚿 Bathroom set']];
  else if(n.includes('living')||n.includes('lounge')) options=[['sofa-set','🛋 Sofa set'],['coffee-table','☕ Coffee table'],['tv-unit','📺 TV unit'],['plant','🌿 Indoor plant'],['chair','🪑 Chair']];
  else if(n.includes('dining')) options=[['dining-set','🍽 Dining table'],['chair','🪑 Chair'],['plant','🌿 Indoor plant']];
  else if(n.includes('kitchen')) options=[['kitchen-set','🍳 Kitchen counter'],['fridge','🧊 Refrigerator'],['stove','🔥 Stove / hob'],['cabinet','🗄 Cabinet']];
  else if(n.includes('study')||n.includes('office')) options=[['study-set','🖥 Desk + monitor'],['chair','🪑 Chair'],['bookshelf','📚 Bookshelf'],['cabinet','🗄 Cabinet'],['plant','🌿 Indoor plant']];
  else if(n.includes('parking')) options=[['car','🚗 Car / parking']];
  const current=select.value;
  select.innerHTML=options.map(([v,l])=>`<option value="${v}">${l}</option>`).join('')+`<option value="none">− Remove all furniture</option>`;
  if([...select.options].some(o=>o.value===current)) select.value=current;
}

function renderFurnitureRoomSelect(){
  const floorSel=$('furnitureFloorSelect'), sel=$('furnitureRoomSelect'); if(!sel||!state.building)return;
  if(floorSel){
    floorSel.innerHTML=(state.building.floor_data||[]).map((f,i)=>`<option value="${i}" ${i===roomEditorFloor?'selected':''}>${esc(f.label||`Floor ${i+1}`)}</option>`).join('');
    if(!floorSel.__bound){ floorSel.__bound=true; floorSel.onchange=()=>{roomEditorFloor=Number(floorSel.value||0); renderFurnitureRoomSelect(); renderRoomEditor();}; }
  }
  const floor=state.building.floor_data?.[roomEditorFloor]||state.building.floor_data?.[0];
  if(!floor){sel.innerHTML='';return;}
  sel.innerHTML=floor.rooms.map((r,i)=>`<option value="${i}">${esc(r.name)} · ${r.width_ft}×${r.length_ft} ft</option>`).join('');
  const r=floor.rooms[Number(sel.value||0)];
  updateFurniturePresetOptions(r);
  const list=$('roomFurnitureList');
  if(list) list.innerHTML=normalizeRoomFurniture(r).map((x,i)=>`<span class="furniture-chip">${esc(furnitureLabel(x))}<button type="button" data-remove-furniture="${i}" title="Remove">×</button></span>`).join('') || '<small class="three-control-help">No furniture added to this room.</small>';
  list?.querySelectorAll('[data-remove-furniture]').forEach(btn=>btn.onclick=()=>removeFurnitureItem(Number(btn.dataset.removeFurniture)));
  if(!sel.__roomBound){ sel.__roomBound=true; sel.onchange=()=>renderFurnitureRoomSelect(); }
}
function removeFurnitureItem(itemIndex){
  const idx=Number($('furnitureRoomSelect')?.value||0), r=state.building?.floor_data?.[roomEditorFloor]?.rooms?.[idx]; if(!r)return;
  const items=normalizeRoomFurniture(r); items.splice(itemIndex,1); r.furniture_items=items; r.furniture=items[items.length-1]||'none';
  renderFurnitureRoomSelect(); render3D(); render2DConstructor(roomEditorFloor); toast('Furniture removed from the room.');
}
function clearRoomFurniture(){
  const idx=Number($('furnitureRoomSelect')?.value||0), r=state.building?.floor_data?.[roomEditorFloor]?.rooms?.[idx]; if(!r)return;
  r.furniture_items=[]; r.furniture='none'; renderFurnitureRoomSelect(); render3D(); render2DConstructor(roomEditorFloor); toast('All furniture removed from the room.');
}
async function applyFurniturePreset(){
  if(!state.building)return toast('Generate a building first.');
  const idx=Number($('furnitureRoomSelect')?.value||0), preset=$('furniturePreset')?.value||'default';
  const r=state.building.floor_data?.[roomEditorFloor]?.rooms?.[idx]; if(!r)return toast('Select a room first.');
  if(preset==='none'){clearRoomFurniture();return;}
  const items=normalizeRoomFurniture(r);
  if(preset==='default'){
    const n=r.name.toLowerCase();
    const auto=n.includes('bed')?'bed-set':n.includes('living')||n.includes('lounge')?'sofa-set':n.includes('dining')?'dining-set':n.includes('kitchen')?'kitchen-set':n.includes('bath')||n.includes('wash')?'bath-fixtures':n.includes('study')||n.includes('office')?'study-set':null;
    if(auto) items.push(auto);
  }else items.push(preset);
  r.furniture_items=items; r.furniture=items[items.length-1]||'none';
  renderFurnitureRoomSelect(); renderRoomEditor(); render3D(); render2DConstructor(roomEditorFloor); toast(`${r.name}: ${furnitureLabel(preset)} added.`);
}


function render3D() {
  ensureVisualSettings();
  renderFloorColorControls();
  renderFurnitureRoomSelect();
  const wrap = $('threeWrap');
  if (state.three && state.three.dispose) { try { state.three.dispose(); } catch (e) {} }
  state.three = null;
  wrap.innerHTML = '';
  $('floorVisPanel').style.display = 'block';

  if (!state.building) {
    wrap.innerHTML = '<div id="threeLoading">Generate a building first.</div>';
    $('floorVisPanel').style.display = 'none';
    return;
  }

  const b = state.building;
  const canvas = document.createElement('canvas');
  canvas.className = 'offline-3d-canvas';
  canvas.setAttribute('aria-label', 'Interactive 3D building visualization');
  wrap.appendChild(canvas);

  const studioHud = document.createElement('div');
  studioHud.className = 'studio-hud';
  studioHud.innerHTML = `
    <div class="studio-hud-top">
      <span class="studio-live"><i></i> LIVE MODEL</span>
      <span class="studio-chip">OFFLINE ENGINE</span>
      <span class="studio-chip">${esc(b.building_type || 'Residential')}</span>
    </div>
    <div class="studio-model-info">
      <b>${esc(b.building_type || 'Residential')} · Architectural Concept</b>
      <span>${b.floors} floors · ${b.room_count || 0} rooms · ${Number(b.built_up_sqft || 0).toLocaleString()} ft&sup2;</span>
    </div>
    <div class="studio-compass"><span>N</span><div></div><small>ORBIT</small></div>`;
  wrap.appendChild(studioHud);
  if($('interiorCutaway')) $('interiorCutaway').textContent='Standard 3D';
  if($('roofBtn')) $('roofBtn').textContent='Show Roof';

  const ctx = canvas.getContext('2d');
  if (!ctx) { wrap.innerHTML = '<div id="threeLoading">Your browser could not create the 3D canvas.</div>'; return; }

  const floorGroups = (b.floor_data || []).map(() => ({ visible: true }));
  const furnitureGroups = (b.floor_data || []).map(() => ({ visible: $('furnitureMode').value === 'on' }));
  let roofVisible = false, exploded = false, walkthrough = false, interiorCutaway = true;
  let yaw = -0.55, pitch = 0.48, zoom = 1.0, panX = 0, panY = 8;
  let drag = false, lastX = 0, lastY = 0;

  const matPalettes = {
    white:    { wallTop:'#f0ece4', wallFront:'#e8e4dc', wallSide:'#d0ccc4' },
    stone:    { wallTop:'#c8c4b8', wallFront:'#b8b4ac', wallSide:'#a4a09c' },
    brick:    { wallTop:'#c4745a', wallFront:'#b86850', wallSide:'#9a5040' },
    concrete: { wallTop:'#c0c4c8', wallFront:'#b0b4b8', wallSide:'#9ca0a4' }
  };
  const roomFills = {
    bedroom: { top:'#5b7fa8', front:'#4a6a90', side:'#3d5878' },
    bath:    { top:'#4a8898', front:'#3d7888', side:'#326878' },
    kitchen: { top:'#a87848', front:'#906438', side:'#784e2c' },
    living:  { top:'#607890', front:'#506880', side:'#40586e' },
    dining:  { top:'#a07858', front:'#886448', side:'#705038' },
    stair:   { top:'#607278', front:'#506268', side:'#405258' },
    balcony: { top:'#48886a', front:'#387858', side:'#2c6848' },
    study:   { top:'#647898', front:'#546888', side:'#445878' },
    parking: { top:'#5a6264', front:'#4a5254', side:'#3c4244' },
    def:     { top:'#5c7080', front:'#4c6070', side:'#3c5060' }
  };

  function getRoomFill(name) {
    const n = String(name).toLowerCase();
    if (n.includes('bath')||n.includes('wash')) return roomFills.bath;
    if (n.includes('bed')||n.includes('master')) return roomFills.bedroom;
    if (n.includes('kitchen')) return roomFills.kitchen;
    if (n.includes('living')||n.includes('lounge')) return roomFills.living;
    if (n.includes('dining')) return roomFills.dining;
    if (n.includes('stair')||n.includes('lift')) return roomFills.stair;
    if (n.includes('balcon')||n.includes('terrace')) return roomFills.balcony;
    if (n.includes('study')||n.includes('office')) return roomFills.study;
    if (n.includes('parking')) return roomFills.parking;
    return roomFills.def;
  }

  function shadeHex(hex, amt) {
    if (!hex||!hex.startsWith('#')) return hex||'#888';
    const h = hex.replace(/ /g,'').slice(1).padEnd(6,'0');
    const n = parseInt(h,16);
    const r = Math.max(0,Math.min(255,(n>>16)+amt));
    const g = Math.max(0,Math.min(255,((n>>8)&255)+amt));
    const bl= Math.max(0,Math.min(255,(n&255)+amt));
    return '#'+[r,g,bl].map(v=>v.toString(16).padStart(2,'0')).join('');
  }

  function iso(x,y,z) {
    const cosY=Math.cos(yaw), sinY=Math.sin(yaw);
    const rx=x*cosY-y*sinY, ry=x*sinY+y*cosY;
    const maxDim=Math.max(b.width_ft,b.length_ft)*0.3048;
    const scale=Math.min(canvas.clientWidth/Math.max(1,maxDim*1.7),canvas.clientHeight/Math.max(1,maxDim*1.8))*zoom;
    const vS=0.94+pitch*0.30;
    return [canvas.clientWidth/2+panX+(rx-ry)*scale*0.82,
            canvas.clientHeight/2+panY+((rx+ry)*0.30-z*vS)*scale];
  }

  function poly(pts,fill,stroke,lw=0.8){
    if(!pts.length) return;
    ctx.beginPath(); pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.closePath();
    ctx.fillStyle=fill; ctx.fill();
    if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lw;ctx.stroke();}
  }

  function polyGrad(pts,cTop,cBot,stroke,lw=0.8){
    if(!pts.length) return;
    const minX=Math.min(...pts.map(p=>p[0])),maxX=Math.max(...pts.map(p=>p[0]));
    const minY=Math.min(...pts.map(p=>p[1])),maxY=Math.max(...pts.map(p=>p[1]));
    try{
      const grad=ctx.createLinearGradient(minX,minY,maxX,maxY);
      grad.addColorStop(0,cTop); grad.addColorStop(1,cBot);
      ctx.beginPath(); pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.closePath();
      ctx.fillStyle=grad; ctx.fill();
    }catch(e){poly(pts,cTop,stroke,lw);return;}
    if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=lw;ctx.stroke();}
  }

  function box3d(x,y,z,w,d,h,cTop,cFront,cSide,label='',alpha=1,sk='rgba(0,0,0,0.14)'){
    const p000=iso(x,y,z),     p100=iso(x+w,y,z);
    const p010=iso(x,y+d,z),   p110=iso(x+w,y+d,z);
    const p001=iso(x,y,z+h),   p101=iso(x+w,y,z+h);
    const p011=iso(x,y+d,z+h), p111=iso(x+w,y+d,z+h);
    ctx.globalAlpha=alpha;
    polyGrad([p001,p101,p111,p011], shadeHex(cTop,18), cTop, sk, 0.6);
    polyGrad([p000,p100,p101,p001], cFront, shadeHex(cFront,-15), sk, 0.6);
    polyGrad([p100,p110,p111,p101], cSide, shadeHex(cSide,-20), sk, 0.6);
    if(label){
      const cx=(p001[0]+p111[0])/2, cy=(p001[1]+p111[1])/2;
      ctx.save();
      ctx.font='600 9px Segoe UI,Arial'; ctx.textAlign='center'; ctx.textBaseline='middle';
      const text=label.length>14?label.slice(0,13)+'...':label;
      const tw=ctx.measureText(text).width+10;
      ctx.fillStyle='rgba(4,12,24,0.80)'; ctx.strokeStyle='rgba(180,218,240,0.45)'; ctx.lineWidth=0.7;
      ctx.beginPath(); if(ctx.roundRect) ctx.roundRect(cx-tw/2,cy-7.5,tw,15,3); else ctx.rect(cx-tw/2,cy-7.5,tw,15);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle='#f0f8ff'; ctx.fillText(text,cx,cy+0.3);
      ctx.restore();
    }
    ctx.globalAlpha=1;
  }

  function drawWindow(x,y,z,w,d,h,side='front'){
    const p000=iso(x,y,z),p100=iso(x+w,y,z),p010=iso(x,y+d,z),p110=iso(x+w,y+d,z);
    const p001=iso(x,y,z+h),p101=iso(x+w,y,z+h),p011=iso(x,y+d,z+h),p111=iso(x+w,y+d,z+h);
    ctx.save();
    if(side==='front'){
      const t=0.15, b1=0.85;
      const ax=p000[0]+(p100[0]-p000[0])*t, ay=p000[1]+(p100[1]-p000[1])*t;
      const bx=p000[0]+(p100[0]-p000[0])*b1, by=p000[1]+(p100[1]-p000[1])*b1;
      const ddx=p001[0]-p000[0], ddy=p001[1]-p000[1];
      const pts=[[ax+ddx*0.08,ay+ddy*0.08],[bx+ddx*0.08,by+ddy*0.08],[bx+ddx*0.92,by+ddy*0.92],[ax+ddx*0.92,ay+ddy*0.92]];
      const gg=ctx.createLinearGradient(pts[0][0],pts[0][1],pts[2][0],pts[2][1]);
      gg.addColorStop(0,'rgba(140,215,255,0.72)'); gg.addColorStop(0.4,'rgba(160,228,255,0.52)'); gg.addColorStop(1,'rgba(90,185,235,0.60)');
      ctx.beginPath(); pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.closePath();
      ctx.fillStyle=gg; ctx.fill();
      ctx.strokeStyle='rgba(200,240,255,0.70)'; ctx.lineWidth=0.6; ctx.stroke();
      const mx=(pts[0][0]+pts[1][0])/2, my=(pts[0][1]+pts[1][1])/2;
      const mx2=(pts[2][0]+pts[3][0])/2, my2=(pts[2][1]+pts[3][1])/2;
      ctx.beginPath(); ctx.moveTo(mx,my); ctx.lineTo(mx2,my2); ctx.strokeStyle='rgba(255,255,255,0.55)'; ctx.lineWidth=0.5; ctx.stroke();
    } else {
      const t=0.15,b1=0.85;
      const ax=p010[0]+(p110[0]-p010[0])*t,ay=p010[1]+(p110[1]-p010[1])*t;
      const bx=p010[0]+(p110[0]-p010[0])*b1,by=p010[1]+(p110[1]-p010[1])*b1;
      const ddx=p011[0]-p010[0],ddy=p011[1]-p010[1];
      const pts=[[ax+ddx*0.08,ay+ddy*0.08],[bx+ddx*0.08,by+ddy*0.08],[bx+ddx*0.92,by+ddy*0.92],[ax+ddx*0.92,ay+ddy*0.92]];
      const gg=ctx.createLinearGradient(pts[0][0],pts[0][1],pts[2][0],pts[2][1]);
      gg.addColorStop(0,'rgba(80,180,220,0.50)'); gg.addColorStop(1,'rgba(50,150,200,0.40)');
      ctx.beginPath(); pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.closePath();
      ctx.fillStyle=gg; ctx.fill();
      ctx.strokeStyle='rgba(200,238,255,0.50)'; ctx.lineWidth=0.5; ctx.stroke();
    }
    ctx.restore();
  }

  function drawDoor(x,y,z,w,d,h){
    const p0=iso(x,y,z),p1=iso(x+w,y,z),p2=iso(x+w,y,z+h),p3=iso(x,y,z+h);
    ctx.save();
    const dg=ctx.createLinearGradient(p0[0],p0[1],p1[0],p1[1]);
    dg.addColorStop(0,'#5a3820'); dg.addColorStop(0.5,'#7a5030'); dg.addColorStop(1,'#5a3820');
    ctx.beginPath(); [p0,p1,p2,p3].forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.closePath();
    ctx.fillStyle=dg; ctx.fill(); ctx.strokeStyle='rgba(220,185,140,0.70)'; ctx.lineWidth=0.8; ctx.stroke();
    const kx=(p0[0]+p1[0])/2+(p2[0]-p1[0])*0.15, ky=(p0[1]+p1[1])/2+(p2[1]-p1[1])*0.15;
    ctx.fillStyle='#e0b44a'; ctx.beginPath(); ctx.arc(kx,ky,1.8,0,Math.PI*2); ctx.fill();
    ctx.restore();
  }

  function drawTree(x,y,z,scale=1){
    const base=iso(x,y,z), top2=iso(x,y,z+0.9*scale);
    ctx.save();
    ctx.strokeStyle='#6a4820'; ctx.lineWidth=5*scale; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(base[0],base[1]); ctx.lineTo(top2[0],top2[1]); ctx.stroke();
    ctx.fillStyle='rgba(0,0,0,0.10)';
    ctx.beginPath(); ctx.ellipse(base[0],base[1]+3*scale,13*scale,4.5*scale,0,0,Math.PI*2); ctx.fill();
    [[0,-15*scale,13*scale,'#3a9e3a'],[-7*scale,-8*scale,9*scale,'#348a34'],[7*scale,-8*scale,9*scale,'#348a34'],
     [-4*scale,-4*scale,8*scale,'#2d7e2d'],[4*scale,-4*scale,8*scale,'#2d7e2d']].forEach(([ox,oy,r,c])=>{
      const cg=ctx.createRadialGradient(top2[0]+ox-2,top2[1]+oy-2,0,top2[0]+ox,top2[1]+oy,r);
      cg.addColorStop(0,shadeHex(c,30)); cg.addColorStop(0.6,c); cg.addColorStop(1,shadeHex(c,-20));
      ctx.beginPath(); ctx.arc(top2[0]+ox,top2[1]+oy,r,0,Math.PI*2); ctx.fillStyle=cg; ctx.fill();
    });
    ctx.restore();
  }

  function drawFurniture(room,x,y,z,w,d,h,furnitureType="default"){
    if($('furnitureMode').value!=='on') return;
    const n=String(room).toLowerCase();
    const ft=furnitureType||'default';
    if(ft==='none') return;
    const accent='#8b6037', soft='#65758a', light='#e8edf1', green='#3f8f52';
    if(ft==='bed-set'||(ft==='default'&&n.includes('bed'))){
      box3d(x+w*.08,y+d*.10,z+h*.03,w*.62,d*.48,h*.13,light,'#b9c2ca','#939da5');
      box3d(x+w*.08,y+d*.08,z+h*.16,w*.62,d*.05,h*.25,accent,'#6a492e','#4f3826');
      box3d(x+w*.76,y+d*.10,z+h*.03,w*.14,d*.52,h*.48,accent,'#68492f','#4e3827');
      box3d(x+w*.18,y+d*.16,z+h*.16,w*.20,d*.11,h*.08,'#ffffff','#dfe5ea','#c3ccd2');
    } else if(ft==='wardrobe'){box3d(x+w*.72,y+d*.08,z+h*.03,w*.20,d*.62,h*.72,accent,'#67472f','#4d3625');}
    else if(ft==='sofa-set'||(ft==='default'&&(n.includes('living')||n.includes('lounge')))){
      box3d(x+w*.12,y+d*.56,z+h*.03,w*.70,d*.20,h*.22,soft,'#536579','#414f60');
      box3d(x+w*.15,y+d*.40,z+h*.03,w*.62,d*.10,h*.22,soft,'#536579','#414f60');
      box3d(x+w*.38,y+d*.28,z+h*.03,w*.25,d*.14,h*.07,accent,'#754f2d','#593b23');
    } else if(ft==='coffee-table'){box3d(x+w*.34,y+d*.40,z+h*.03,w*.32,d*.18,h*.07,accent,'#744e2d','#55381f');}
    else if(ft==='dining-set'||(ft==='default'&&n.includes('dining'))){
      box3d(x+w*.22,y+d*.28,z+h*.03,w*.56,d*.30,h*.08,accent,'#7c5733','#5d4025');
      [[.20,.25],[.80,.25],[.20,.75],[.80,.75]].forEach(([px,pz])=>box3d(x+w*px-.05,y+d*pz-.05,z+h*.03,.10,.10,.34,accent,'#6c492b','#51371f'));
    } else if(ft==='kitchen-set'||(ft==='default'&&n.includes('kitchen'))){box3d(x+w*.05,y+d*.06,z+h*.03,w*.88,d*.18,h*.34,light,'#aab5bc','#87939b');}
    else if(ft==='fridge'){box3d(x+w*.72,y+d*.07,z+h*.03,w*.18,d*.20,h*.78,light,'#b8c2c9','#8d999f');}
    else if(ft==='stove'){box3d(x+w*.30,y+d*.06,z+h*.38,w*.32,d*.18,h*.04,'#2b3036','#1f2429','#171b20');}
    else if(ft==='bath-fixtures'||(ft==='default'&&(n.includes('bath')||n.includes('wash')))){
      box3d(x+w*.08,y+d*.10,z+h*.03,w*.34,d*.28,h*.12,light,'#c5d0d7','#a4b2bb');
      box3d(x+w*.55,y+d*.10,z+h*.03,w*.22,d*.18,h*.22,light,'#c9d3d9','#a8b4bc');
      box3d(x+w*.58,y+d*.52,z+h*.03,w*.20,d*.18,h*.15,light,'#c9d3d9','#a8b4bc');
    } else if(ft==='toilet'){box3d(x+w*.68,y+d*.18,z+h*.03,w*.16,d*.24,h*.12,light,'#c9d3d9','#a8b4bc');}
    else if(ft==='shower'){box3d(x+w*.08,y+d*.62,z+h*.03,w*.28,d*.24,h*.06,'#9ecfe3','#6ca7bd','#4e8aa0');}
    else if(ft==='sink'){box3d(x+w*.48,y+d*.08,z+h*.35,w*.22,d*.16,h*.08,light,'#bfcbd2','#9daab2');}
    else if(ft==='bathtub'){box3d(x+w*.06,y+d*.48,z+h*.03,w*.40,d*.28,h*.12,light,'#c5d0d7','#a4b2bb');}
    else if(ft==='study-set'){box3d(x+w*.12,y+d*.12,z+h*.03,w*.56,d*.20,h*.24,accent,'#704b2a','#56391f'); box3d(x+w*.30,y+d*.38,z+h*.03,w*.18,d*.15,h*.26,soft,'#4f6072','#3d4b5b'); box3d(x+w*.25,y+d*.08,z+h*.40,w*.30,d*.03,h*.25,'#b9d9e8','#87b6ca','#6796aa');}
    else if(ft==='chair'){box3d(x+w*.40,y+d*.42,z+h*.03,w*.18,d*.18,h*.32,soft,'#536579','#414f60');}
    else if(ft==='tv-unit'){box3d(x+w*.28,y+d*.08,z+h*.30,w*.44,d*.05,h*.26,'#1f2730','#151b22','#10151b'); box3d(x+w*.25,y+d*.07,z+h*.03,w*.50,d*.10,h*.10,accent,'#6d4a2b','#51371f');}
    else if(ft==='bookshelf'||ft==='cabinet'){box3d(x+w*.72,y+d*.08,z+h*.03,w*.20,d*.55,h*.72,accent,'#67472f','#4d3625');}
    else if(ft==='plant'){box3d(x+w*.78,y+d*.72,z+h*.03,w*.12,d*.12,h*.12,accent,'#704a2b','#54351f'); box3d(x+w*.84,y+d*.78,z+h*.14,w*.06,d*.06,h*.42,green,'#337440','#255c31');}
    else if(ft==='car'){box3d(x+w*.16,y+d*.22,z+h*.03,w*.68,d*.38,h*.18,'#48596a','#344352','#283542'); box3d(x+w*.30,y+d*.28,z+h*.20,w*.40,d*.24,h*.12,'#86b8d0','#5e8fa8','#4c7489');}
  }

  function drawGround(wallW,wallL,groundPad,light){
    const g=[iso(-groundPad,-groundPad,0),iso(wallW+groundPad,-groundPad,0),
             iso(wallW+groundPad,wallL+groundPad,0),iso(-groundPad,wallL+groundPad,0)];
    const gg=ctx.createLinearGradient(g[0][0],g[0][1],g[2][0],g[2][1]);
    if(light==='night'){gg.addColorStop(0,'#0a1a14');gg.addColorStop(1,'#071210');}
    else if(light==='evening'){gg.addColorStop(0,'#2a5040');gg.addColorStop(1,'#1e3c30');}
    else{gg.addColorStop(0,'#3a7a48');gg.addColorStop(1,'#2e6038');}
    ctx.beginPath(); g.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.closePath();
    ctx.fillStyle=gg; ctx.fill();
    ctx.save(); ctx.globalAlpha=0.055; ctx.strokeStyle='#80c080'; ctx.lineWidth=0.5;
    const gd=Math.max(0.9,Math.min(1.6,Math.max(wallW,wallL)/14));
    for(let gx=-groundPad;gx<=wallW+groundPad;gx+=gd){const a=iso(gx,-groundPad,0.005),zz=iso(gx,wallL+groundPad,0.005);ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(zz[0],zz[1]);ctx.stroke();}
    for(let gy=-groundPad;gy<=wallL+groundPad;gy+=gd){const a=iso(-groundPad,gy,0.005),zz=iso(wallW+groundPad,gy,0.005);ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(zz[0],zz[1]);ctx.stroke();}
    ctx.restore();
    const dw=wallW*0.28;
    const drv=[iso(wallW/2-dw/2,-groundPad,0.01),iso(wallW/2+dw/2,-groundPad,0.01),
               iso(wallW/2+dw/2,0,0.01),iso(wallW/2-dw/2,0,0.01)];
    const drvG=ctx.createLinearGradient(drv[0][0],drv[0][1],drv[2][0],drv[2][1]);
    drvG.addColorStop(0,'#2a3540'); drvG.addColorStop(1,'#3a4550');
    ctx.beginPath(); drv.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.closePath();
    ctx.fillStyle=drvG; ctx.fill();
  }

  function drawBoundary(wallW,wallL,groundPad){
    const wallH=0.45,wallT=0.18;
    const wc='#5a6878',wd='#4a5868',wt='#6a7888';
    const gateW=wallW*0.28, lW=(wallW+2*groundPad-gateW)/2;
    box3d(-groundPad,-groundPad,0,lW,wallT,wallH,wt,wc,wd);
    box3d(-groundPad+lW+gateW,-groundPad,0,wallW+2*groundPad-lW-gateW,wallT,wallH,wt,wc,wd);
    box3d(-groundPad+lW-0.22,-groundPad,0,0.28,0.28,wallH+0.5,'#485870','#384860','#2c3850');
    box3d(-groundPad+lW+gateW,-groundPad,0,0.28,0.28,wallH+0.5,'#485870','#384860','#2c3850');
    box3d(-groundPad,-groundPad,0,wallT,wallL+2*groundPad,wallH,wt,wc,wd);
    box3d(wallW+groundPad-wallT,-groundPad,0,wallT,wallL+2*groundPad,wallH,wt,wc,wd);
    box3d(-groundPad,wallL+groundPad-wallT,0,wallW+2*groundPad,wallT,wallH,wt,wc,wd);
  }

  function drawRoof(wallW,wallL,baseZ,light){
    const ov=0.26;
    const rc=light==='night'?'#1a2028':light==='evening'?'#3a2820':'#c87840';
    const rd=shadeHex(rc,-28),rs=shadeHex(rc,-46);
    box3d(-ov,-ov,baseZ,wallW+2*ov,wallL+2*ov,0.22,rc,rd,rs);
    const pT=0.16,pH=0.72;
    const pc=light==='night'?'#1c2430':'#d8d0c0',pd=shadeHex(pc,-18),ps=shadeHex(pc,-32);
    box3d(-ov,-ov,baseZ+0.22,wallW+2*ov,pT,pH,pc,pd,ps);
    box3d(-ov,wallL+ov-pT,baseZ+0.22,wallW+2*ov,pT,pH,pc,pd,ps);
    box3d(-ov,-ov,baseZ+0.22,pT,wallL+2*ov,pH,pc,pd,ps);
    box3d(wallW+ov-pT,-ov,baseZ+0.22,pT,wallL+2*ov,pH,pc,pd,ps);
    box3d(wallW*0.65,wallL*0.18,baseZ+0.22+pH,1.0,1.0,1.1,'#608090','#485e6e','#384a5a');
    for(let si=0;si<3;si++){ box3d(wallW*0.18+si*1.7,wallL*0.35,baseZ+0.22+pH+0.08,1.5,0.78,0.06,'#1a2840','#101c2c','#0c1420'); }
  }

  function drawTypeSpecificArchitecture(wallW, wallL, baseZ, FH, light){
    const type=String(b.building_type||'House').toLowerCase();
    const wall=state.building.visual?.buildingColor || '#e8e4dc';
    const dark=shadeHex(wall,-35), mid=shadeHex(wall,-18);
    const glass='#6db7d8';
    const trim='#f4efe5';

    // Distinct exterior signatures — these deliberately differ by building type.
    if(type==='villa'){
      box3d(-0.30,-0.22,baseZ+FH*0.62,wallW+0.60,0.22,0.22,trim,mid,dark);
      box3d(wallW*0.18,-0.55,baseZ+FH*0.72,wallW*0.64,0.22,0.18,trim,mid,dark);
      box3d(wallW*0.12,wallL*0.02,baseZ+FH*0.45,wallW*0.76,0.12,0.12,trim,mid,dark);
    } else if(type==='duplex'){
      box3d(wallW*0.47,-0.22,baseZ+0.20,0.16,0.30,FH*0.60,trim,mid,dark);
      box3d(wallW*0.05,-0.35,baseZ+FH*0.67,wallW*0.90,0.18,0.18,trim,mid,dark);
    } else if(type.includes('apartment')){
      for(let fi=0;fi<3;fi++){
        const z=baseZ+FH*(0.40+fi*0.18);
        box3d(wallW*0.05,-0.30,z,wallW*0.90,0.18,0.13,trim,mid,dark);
        box3d(wallW*0.68,-0.55,z+0.08,wallW*0.22,0.30,0.10,glass,'#467f9d','#315b72');
      }
    } else if(type.includes('commercial')){
      box3d(wallW*0.08,-0.26,baseZ+FH*0.15,wallW*0.84,0.12,FH*0.65,glass,'#477d94','#315768');
      for(let i=0;i<5;i++) box3d(wallW*(0.08+i*0.18),-0.34,baseZ+FH*0.18,0.045,0.08,FH*0.58,trim,mid,dark);
    } else if(type==='office'){
      for(let i=0;i<4;i++){
        box3d(wallW*(0.10+i*0.22),-0.34,baseZ+FH*0.25,wallW*0.15,0.08,FH*0.45,glass,'#477d94','#315768');
      }
    } else if(type==='hotel'){
      for(let i=0;i<4;i++){
        const z=baseZ+FH*(0.25+i*0.15);
        box3d(wallW*0.10,-0.40,z,wallW*0.80,0.22,0.12,trim,mid,dark);
        box3d(wallW*0.16,-0.52,z+0.02,wallW*0.14,0.18,0.08,glass,'#477d94','#315768');
        box3d(wallW*0.43,-0.52,z+0.02,wallW*0.14,0.18,0.08,glass,'#477d94','#315768');
        box3d(wallW*0.70,-0.52,z+0.02,wallW*0.14,0.18,0.08,glass,'#477d94','#315768');
      }
    } else if(type==='warehouse'){
      box3d(wallW*0.16,-0.38,baseZ+0.20,wallW*0.68,0.14,FH*0.55,mid,dark,'#242d35');
      box3d(wallW*0.34,-0.48,baseZ+0.22,wallW*0.32,0.08,FH*0.48,'#69747b','#4e5960','#3a444a');
      box3d(wallW*0.08,-0.30,baseZ+FH*0.70,wallW*0.84,0.18,0.14,trim,mid,dark);
    } else if(type==='mixed-use'){
      box3d(wallW*0.06,-0.35,baseZ+0.18,wallW*0.40,0.10,FH*0.62,glass,'#477d94','#315768');
      box3d(wallW*0.52,-0.32,baseZ+FH*0.62,wallW*0.38,0.12,0.16,trim,mid,dark);
    } else { // House / Residential
      box3d(wallW*0.18,-0.28,baseZ+FH*0.66,wallW*0.64,0.14,0.14,trim,mid,dark);
    }
  }

  function draw(){
    const cw=canvas.clientWidth||900, ch=canvas.clientHeight||680;
    const light=$('lightMode')?.value||'day';
    const vizMode=$('visualMode')?.value||'realistic';
    const wallMatKey=$('wallMat')?.value||'white';
    const matPal=matPalettes[wallMatKey]||matPalettes.white;

    ctx.clearRect(0,0,cw,ch);
    const sky=ctx.createLinearGradient(0,0,0,ch);
    if(light==='night'){sky.addColorStop(0,'#03080f');sky.addColorStop(0.6,'#060d18');sky.addColorStop(1,'#080f20');}
    else if(light==='evening'){sky.addColorStop(0,'#1a1230');sky.addColorStop(0.38,'#8b2020');sky.addColorStop(0.65,'#e06030');sky.addColorStop(1,'#24301a');}
    else{sky.addColorStop(0,'#87ceeb');sky.addColorStop(0.42,'#b8dff5');sky.addColorStop(0.72,'#d8f0f8');sky.addColorStop(1,'#3a6a48');}
    ctx.fillStyle=sky; ctx.fillRect(0,0,cw,ch);

    if(light==='night'){
      ctx.save(); ctx.fillStyle='rgba(255,255,255,0.7)';
      for(let s=0;s<80;s++){ctx.beginPath();ctx.arc((s*73)%cw,(s*47)%(ch*0.5),(s%3===0?1.4:0.7),0,Math.PI*2);ctx.fill();}
      ctx.restore();
    }

    const FT=0.3048, FH=(b.floor_height_ft||10)*FT;
    const wallW=b.width_ft*FT, wallL=b.length_ft*FT;
    const groundPad=Math.max(wallW,wallL)*0.55;
    const gap=exploded?FH*0.32:0;

    drawGround(wallW,wallL,groundPad,light);

    if(vizMode==='realistic'){
      drawTree(-groundPad*0.42,wallL*0.28,0.02,0.95);
      drawTree(wallW+groundPad*0.35,wallL*0.68,0.02,0.80);
      drawTree(wallW*0.22,wallL+groundPad*0.30,0.02,0.70);
      drawTree(-groundPad*0.38,wallL*0.72,0.02,0.75);
      drawTree(wallW+groundPad*0.30,wallL*0.22,0.02,0.88);
      drawBoundary(wallW,wallL,groundPad);
    }

    (b.floor_data||[]).forEach((floor,fi)=>{
      if(!floorGroups[fi].visible) return;
      const baseZ=fi*(FH+gap);
      const slabC=light==='night'?'#1a2530':'#c8d4dc';
      const slabF=light==='night'?'#141e28':'#a8b4bc';
      const slabS=light==='night'?'#101820':'#8898a4';
      box3d(0,0,baseZ,wallW,wallL,0.15,slabC,slabF,slabS);

      (floor.rooms||[]).forEach(room=>{
        const rx=Number(room.x_ft||0)*FT, ry=Number(room.y_ft||0)*FT;
        const rw=Math.max(0.6,Number(room.width_ft||8)*FT), rd=Math.max(0.7,Number(room.length_ft||8)*FT);
        const fill=getRoomFill(room.name);
        const roomH=FH*0.70;
        if(interiorCutaway && vizMode==='realistic') {
          // Open-top architectural cutaway: floor surface + low perimeter walls keep furniture and rooms visible.
          box3d(rx,ry,baseZ+0.15,rw,rd,0.08,fill.top,fill.front,fill.side,'',0.98);
          const wh=Math.max(0.65,FH*0.46), wt=0.08;
          const wallBase=state.building.visual?.floorColors?.[fi] || state.building.visual?.buildingColor || '#e8e4dc';
          const wallFront=shadeHex(wallBase,-8), wallSide=shadeHex(wallBase,-22);
          box3d(rx,ry,baseZ+0.23,rw,wt,wh,wallBase,wallFront,wallSide,'',0.90);
          box3d(rx,ry+rd-wt,baseZ+0.23,rw,wt,wh,wallBase,wallFront,wallSide,'',0.90);
          box3d(rx,ry,baseZ+0.23,wt,rd,wh,wallBase,wallFront,wallSide,'',0.90);
          box3d(rx+rw-wt,ry,baseZ+0.23,wt,rd,wh,wallBase,wallFront,wallSide,'',0.90);
          ctx.save(); ctx.strokeStyle='rgba(30,45,60,.85)'; ctx.lineWidth=1.0;
          const tl=iso(rx,ry,baseZ+wh+0.23),tr=iso(rx+rw,ry,baseZ+wh+0.23),br=iso(rx+rw,ry+rd,baseZ+wh+0.23),bl=iso(rx,ry+rd,baseZ+wh+0.23);
          ctx.beginPath();ctx.moveTo(tl[0],tl[1]);ctx.lineTo(tr[0],tr[1]);ctx.lineTo(br[0],br[1]);ctx.lineTo(bl[0],bl[1]);ctx.closePath();ctx.stroke();ctx.restore();
        } else {
          box3d(rx,ry,baseZ+0.15,rw,rd,roomH,fill.top,fill.front,fill.side,room.name,0.95);
        }
        const furnitureItems=normalizeRoomFurniture(room);
        if(furnitureItems.length){ furnitureItems.forEach(item=>drawFurniture(room.name,rx,ry,baseZ+0.15,rw,rd,roomH,item)); }
        else if(room.furniture==='default') drawFurniture(room.name,rx,ry,baseZ+0.15,rw,rd,roomH,'default');
        if(vizMode==='realistic'){
          const nm=String(room.name).toLowerCase();
          if(!nm.includes('parking')&&!nm.includes('stair')&&!nm.includes('utility')){
            drawWindow(rx+rw*0.10,ry,baseZ+FH*0.32,rw*0.80,rd,FH*0.30,'front');
          }
          if(nm.includes('living')||nm.includes('bed')||nm.includes('office')){
            drawWindow(rx,ry+rd*0.06,baseZ+FH*0.34,rw,rd*0.75,FH*0.26,'side');
          }
          if((nm.includes('living')||nm.includes('foyer')||nm.includes('reception'))&&fi===0){
            drawDoor(rx+rw*0.36,ry,baseZ+0.15,rw*0.28,rd,FH*0.60);
          }
        }
      });

      drawTypeSpecificArchitecture(wallW,wallL,baseZ,FH,light);

      const floorColor=state.building.visual?.floorColors?.[fi] || state.building.visual?.buildingColor || matPal.wallFront;
      const capC=floorColor, capF=shadeHex(floorColor,-8), capS=shadeHex(floorColor,-22);
      box3d(0,0,baseZ+FH*0.70,wallW,0.08,FH*0.30,capC,capF,capS);
      box3d(0,wallL-0.08,baseZ+FH*0.70,wallW,0.08,FH*0.30,capC,capF,capS);
      box3d(0,0,baseZ+FH*0.70,0.08,wallL,FH*0.30,capC,capF,capS);
      box3d(wallW-0.08,0,baseZ+FH*0.70,0.08,wallL,FH*0.30,capC,capF,capS);

      ctx.save(); ctx.strokeStyle='rgba(220,240,255,0.55)'; ctx.lineWidth=1.2;
      ctx.beginPath();
      [[0,0],[wallW,0],[wallW,wallL],[0,wallL],[0,0]].forEach(([ex,ey],i)=>{const p=iso(ex,ey,baseZ+0.16);i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]);});
      ctx.stroke(); ctx.restore();

      ctx.save(); ctx.font='700 10px Segoe UI,Arial';
      const lz=baseZ+FH*0.52, lp=iso(-0.3,wallL*0.06,lz);
      const lbl=floor.label||('Floor '+(fi+1));
      const tw=ctx.measureText(lbl).width+14;
      ctx.fillStyle='rgba(6,16,28,0.88)'; ctx.strokeStyle='rgba(150,200,230,0.4)'; ctx.lineWidth=0.8;
      ctx.beginPath(); if(ctx.roundRect) ctx.roundRect(lp[0]-3,lp[1]-9,tw,18,4); else ctx.rect(lp[0]-3,lp[1]-9,tw,18);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle='#d0ecff'; ctx.textAlign='left'; ctx.fillText(lbl,lp[0]+4,lp[1]+0.5);
      ctx.restore();
    });

    if(roofVisible){
      const roofBase=(b.floor_data||[]).length*(FH+gap);
      drawRoof(wallW,wallL,roofBase,light);
    }

    ctx.fillStyle=light==='night'?'rgba(180,220,255,0.85)':'rgba(240,250,255,0.92)';
    ctx.font='700 13px Segoe UI,Arial'; ctx.textAlign='left';
    ctx.fillText(vizMode==='realistic'?'REALISTIC ARCHITECTURAL VIEW':'OFFLINE 3D BUILDING VIEW',18,28);
    ctx.font='11px Segoe UI,Arial'; ctx.fillStyle=light==='night'?'rgba(130,180,220,0.7)':'rgba(100,150,180,0.8)';
    ctx.fillText(b.floors+' floor(s) · '+b.room_count+' rooms · '+Number(b.built_up_sqft||0).toLocaleString()+' ft² · drag=rotate · wheel=zoom',18,47);
    ctx.font='9px Arial'; ctx.fillStyle='rgba(180,210,230,0.60)';
    ctx.fillText('CONCEPTUAL · NOT FOR CONSTRUCTION',18,ch-14);
    ctx.textAlign='right'; ctx.fillStyle='rgba(180,210,230,0.70)';
    ctx.font='10px Arial'; ctx.fillText(walkthrough?'Walkthrough mode':'Orbit mode',cw-16,28); ctx.textAlign='left';
  }

  function setExplode(v){exploded=!!v;draw();}
  function setInteriorCutaway(v){interiorCutaway=!!v; if(interiorCutaway){roofVisible=false;} draw();}
  function applyVisualization(){furnitureGroups.forEach(g=>g.visible=$('furnitureMode').value==='on');draw();}
  function resetCamera(){yaw=-0.55;pitch=0.48;zoom=1;panX=0;panY=8;exploded=false;walkthrough=false;$('explode').textContent='Explode';$('walkBtn').textContent='Walkthrough';draw();}

  function resize(){
    const dpr=Math.min(window.devicePixelRatio||1,2);
    const w=Math.max(320,wrap.clientWidth||900),h=Math.max(420,wrap.clientHeight||680);
    canvas.width=Math.floor(w*dpr); canvas.height=Math.floor(h*dpr);
    canvas.style.width=w+'px'; canvas.style.height=h+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0); draw();
  }

  canvas.addEventListener('pointerdown',e=>{drag=true;lastX=e.clientX;lastY=e.clientY;canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{
    if(!drag) return;
    const dx=e.clientX-lastX,dy=e.clientY-lastY;
    lastX=e.clientX; lastY=e.clientY;
    if(e.buttons===1){yaw+=dx*0.008;pitch=Math.max(0.22,Math.min(0.92,pitch+dy*0.003));}
    else if(e.buttons===2){panX+=dx;panY+=dy;}
    draw();
  });
  canvas.addEventListener('pointerup',()=>drag=false);
  canvas.addEventListener('pointercancel',()=>drag=false);
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(0.65,Math.min(2.8,zoom*(e.deltaY<0?1.1:0.91)));draw();},{passive:false});

  const onKey=e=>{
    if(!walkthrough) return;
    const k=e.key.toLowerCase();
    if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)) e.preventDefault();
    if(k==='a'||k==='arrowleft') yaw-=0.08;
    if(k==='d'||k==='arrowright') yaw+=0.08;
    if(k==='w'||k==='arrowup') zoom=Math.min(2.8,zoom*1.05);
    if(k==='s'||k==='arrowdown') zoom=Math.max(0.65,zoom*0.95);
    draw();
  };
  const onTypeKey=e=>{
    if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)) return;
    const map={h:'House',v:'Villa',a:'Apartment Building',d:'Duplex',c:'Commercial Building',o:'Office',t:'Hotel',w:'Warehouse',m:'Mixed-use'};
    const type=map[e.key.toLowerCase()];
    if(type){setBuildingType(type);}
  };
  window.addEventListener('keydown',onKey); window.addEventListener('keydown',onTypeKey);

  const fpanel=$('floorVisPanel'),fvbtns=$('floorVisButtons'); fvbtns.innerHTML='';
  (b.floor_data||[]).forEach((f,i)=>{
    const btn=document.createElement('button'); btn.className='fvis-btn active'; btn.textContent=f.label||('Floor '+(i+1));
    btn.onclick=()=>{floorGroups[i].visible=!floorGroups[i].visible;btn.classList.toggle('active',floorGroups[i].visible);draw();};
    fvbtns.appendChild(btn);
  });
  fpanel.style.display=(b.floor_data||[]).length?'block':'none';

  state.three={
    canvas,floorGroups,furnitureGroups,
    get exploded(){return exploded;},setExplode,
    get roofVisible(){return roofVisible;},set roofVisible(v){roofVisible=!!v;draw();},
    get walkthrough(){return walkthrough;},set walkthrough(v){walkthrough=!!v;draw();},
    get interiorCutaway(){return interiorCutaway;},setInteriorCutaway,
    applyVisualization,resetCamera,
    dispose(){window.removeEventListener('resize',resize);window.removeEventListener('keydown',onKey);window.removeEventListener('keydown',onTypeKey);},
    _onResize:resize
  };
  window.addEventListener('resize',resize); resize();
}
/* ============================================================
   ROOM EDITOR — frontend wiring for existing backend APIs
   ============================================================ */
let roomEditorFloor = 0;

async function loadRoomChoices() {
  if (!state.building) return;
  try {
    const d = await api('/api/buildings/room_choices?type=' + encodeURIComponent(state.building.building_type || 'Residential'));
    const choices = d.choices || [];
    $('roomChips').innerHTML = choices.map(n => `<button type="button" class="secondary room-chip" data-room="${esc(n)}">${esc(n)}</button>`).join('');
    $('roomChips').querySelectorAll('[data-room]').forEach(btn => btn.onclick = () => addRoomFromEditor(btn.dataset.room));
  } catch(e) { console.warn(e); }
}

function renderRoomEditor() {
  if (!state.building) return;
  $('roomEditor').classList.remove('hidden');
  const floor = state.building.floor_data[roomEditorFloor] || state.building.floor_data[0];
  roomEditorFloor = Math.max(0, state.building.floor_data.indexOf(floor));
  $('roomEditorFloorLabel').textContent = floor.label || `Floor ${roomEditorFloor+1}`;
  $('roomCountBadge').textContent = `${floor.rooms.length} rooms`;
  const furniture=['default','bed-set','wardrobe','sofa-set','dining-set','kitchen-set','bath-fixtures','study-set','car'];
  const materials=['standard','marble','wood','tile','premium'];
  $('roomList').innerHTML = floor.rooms.map((r,i)=>`<div class="room-editor-card"><div class="room-card-head"><b>${esc(r.name)}</b><button type="button" class="danger-mini" data-remove-room="${i}">Remove</button></div><div class="room-edit-grid"><label>Name<input data-r-name="${i}" value="${esc(r.name)}"></label><label>Width (ft)<input type="number" min="3" step="0.1" data-r-w="${i}" value="${r.width_ft}"></label><label>Length (ft)<input type="number" min="4" step="0.1" data-r-l="${i}" value="${r.length_ft}"></label><label>X position<input type="number" min="0" step="0.1" data-r-x="${i}" value="${r.x_ft}"></label><label>Y position<input type="number" min="0" step="0.1" data-r-y="${i}" value="${r.y_ft}"></label><label>Furniture<select data-r-f="${i}">${furniture.map(v=>`<option value="${v}" ${v===(r.furniture||'default')?'selected':''}>${v.replaceAll('-',' ')}</option>`).join('')}</select></label><label>Material<select data-r-m="${i}">${materials.map(v=>`<option value="${v}" ${v===(r.material||'standard')?'selected':''}>${v}</option>`).join('')}</select></label><label>Windows<select data-r-win="${i}">${[0,1,2,3,4,5,6].map(v=>`<option ${v===Number(r.window_count??2)?'selected':''}>${v}</option>`).join('')}</select></label></div><button type="button" class="primary full room-update-btn" data-update-room="${i}">Update Room</button></div>`).join('');
  $('roomList').querySelectorAll('[data-remove-room]').forEach(btn=>btn.onclick=()=>removeRoomFromEditor(Number(btn.dataset.removeRoom)));
  $('roomList').querySelectorAll('[data-update-room]').forEach(btn=>btn.onclick=()=>updateRoomFromEditor(Number(btn.dataset.updateRoom)));
  loadRoomChoices();
  renderFurnitureRoomSelect();
}
async function updateRoomFromEditor(index){
  const q=s=>document.querySelector(`[data-${s}="${index}"]`);
  try{
    state.building=await api('/api/buildings/rooms/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({building:state.building,floor:roomEditorFloor,room_idx:index,name:q('r-name').value,width_ft:q('r-w').value,length_ft:q('r-l').value,x_ft:q('r-x').value,y_ft:q('r-y').value,furniture:q('r-f').value,material:q('r-m').value,window_count:q('r-win').value})});
    renderBuilding(); await calculateCost(); await calculateConstruction(); await renderAdvanced(); render3D(); render2DConstructor(roomEditorFloor); updateProjectProgress(); toast('Room updated across 2D, 3D and estimates.');
  }catch(e){toast(e.message)}
}

async function addRoomFromEditor(name) {
  if (!state.building) return toast('Generate a building first.');
  try {
    state.building=await api('/api/buildings/rooms/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({building:state.building,floor:roomEditorFloor,room_name:name})});
    renderBuilding(); renderRoomEditor(); await calculateCost(); await calculateConstruction(); await renderAdvanced(); render3D(); updateProjectProgress(); toast(`${name} added.`);
  } catch(e){toast(e.message);}
}
async function removeRoomFromEditor(index) {
  try {
    state.building=await api('/api/buildings/rooms/remove',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({building:state.building,floor:roomEditorFloor,room_idx:index})});
    renderBuilding(); renderRoomEditor(); await calculateCost(); await calculateConstruction(); await renderAdvanced(); render3D(); updateProjectProgress(); toast('Room removed.');
  } catch(e){toast(e.message);}
}
$('addCustomRoom').onclick=()=>{const n=$('customRoomName').value.trim(); if(!n)return toast('Enter a room name.'); addRoomFromEditor(n); $('customRoomName').value='';};
$('roomSearch').oninput=e=>{
  const q=e.target.value.toLowerCase();
  document.querySelectorAll('#roomChips [data-room]').forEach(b=>b.style.display=b.dataset.room.toLowerCase().includes(q)?'':'none');
};
