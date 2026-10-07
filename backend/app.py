from flask import Flask, request, jsonify, send_from_directory, send_file
from pathlib import Path
from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
import json, math, uuid, datetime, copy

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
UPLOADS = ROOT / "uploads"
DATA = ROOT / "data"
LAYOUTS = ROOT / "generated_layouts"
REPORTS = ROOT / "reports" / "generated"
for p in (UPLOADS, DATA, LAYOUTS, REPORTS):
    p.mkdir(parents=True, exist_ok=True)

app = Flask(__name__, static_folder=str(FRONTEND), static_url_path="")
app.config["MAX_CONTENT_LENGTH"] = 15 * 1024 * 1024
ALLOWED = {"png", "jpg", "jpeg", "webp"}

def ok(data=None, **extra):
    payload = {"success": True}
    if data is not None:
        payload["data"] = data
    payload.update(extra)
    return jsonify(payload)

def err(message, code=400):
    return jsonify({"success": False, "error": message}), code

def uid(prefix):
    return f"{prefix}_{uuid.uuid4().hex[:10]}"

def clamp(v, lo, hi):
    return max(lo, min(hi, v))

def safe_float(v, default=0):
    try:
        x = float(v)
        return x if math.isfinite(x) else default
    except Exception:
        return default

def polygon_area(points):
    if len(points) < 3:
        return 0
    s = 0
    for i, p in enumerate(points):
        q = points[(i+1) % len(points)]
        s += p["x"] * q["y"] - q["x"] * p["y"]
    return abs(s) / 2

def polygon_perimeter(points):
    if len(points) < 2:
        return 0
    return sum(math.hypot(points[(i+1)%len(points)]["x"]-p["x"],
                          points[(i+1)%len(points)]["y"]-p["y"]) for i,p in enumerate(points))



def sanitize_points(raw, width_px, height_px):
    points=[]
    for i,p in enumerate(raw or []):
        if not isinstance(p, dict):
            continue
        x=clamp(safe_float(p.get("x"),0),0,width_px)
        y=clamp(safe_float(p.get("y"),0),0,height_px)
        points.append({"id":str(p.get("id",f"P{i+1}")),"x":round(x,2),"y":round(y,2)})
    return points

def side_pixel_lengths(points):
    if len(points)<2: return []
    return [math.hypot(points[(i+1)%len(points)]["x"]-p["x"], points[(i+1)%len(points)]["y"]-p["y"]) for i,p in enumerate(points)]

def normalize_measurements(raw):
    vals = []
    for x in raw or []:
        if isinstance(x, dict):
            name = str(x.get("name", f"Side {len(vals)+1}"))
            value = safe_float(x.get("value"), 0)
        else:
            name = f"Side {len(vals)+1}"
            value = safe_float(x, 0)
        if value > 0:
            vals.append({"name": name, "ft": value})
    return vals

def make_boundary(width_px, height_px, measurements):
    n = max(4, len(measurements))
    if n == 4:
        pts = [
            {"id":"P1","x":0.08*width_px,"y":0.12*height_px},
            {"id":"P2","x":0.92*width_px,"y":0.10*height_px},
            {"id":"P3","x":0.94*width_px,"y":0.88*height_px},
            {"id":"P4","x":0.06*width_px,"y":0.90*height_px},
        ]
    else:
        pts = []
        cx, cy = width_px/2, height_px/2
        rx, ry = width_px*.42, height_px*.38
        for i in range(n):
            a = -math.pi/2 + 2*math.pi*i/n
            pts.append({"id":f"P{i+1}","x":cx+rx*math.cos(a),"y":cy+ry*math.sin(a)})
    return pts

def build_layout(area, plots_count=6, park_pct=10, parking_pct=7, main_road_ft=30, internal_road_ft=20, boundary_points=None, land_length_ft=None, land_width_ft=None):
    """Create a dimension-aware subdivision. Plot coordinates are generated from the
    actual calibrated land aspect ratio instead of a fixed square grid."""
    plots_count = int(clamp(plots_count, 2, 20))
    park_pct = clamp(park_pct, 0, 30)
    parking_pct = clamp(parking_pct, 0, 20)
    length_ft = safe_float(land_length_ft, 0)
    width_ft = safe_float(land_width_ft, 0)
    if length_ft <= 0 or width_ft <= 0:
        width_ft = math.sqrt(max(area, 1) * 0.75)
        length_ft = max(1, area / max(width_ft, 1))
    # Keep the calibrated dimensions authoritative; area is derived from them.
    calibrated_area = max(1, length_ft * width_ft)
    reserved = calibrated_area * (park_pct + parking_pct) / 100
    road_area = calibrated_area * 0.20
    usable = max(plots_count * 200, calibrated_area - reserved - road_area)
    plot_area = usable / plots_count

    cols = math.ceil(math.sqrt(plots_count * (width_ft / max(length_ft, 1))))
    cols = max(1, min(cols, plots_count))
    rows = math.ceil(plots_count / cols)
    cell_w = 100 / cols
    cell_h = 100 / rows

    plots=[]
    for i in range(plots_count):
        r,c=divmod(i,cols)
        x,y=c*cell_w,r*cell_h
        # Real-world dimensions follow the actual land width/length ratio.
        pw=cell_w/100*width_ft*0.90
        pl=cell_h/100*length_ft*0.90
        # Area is kept consistent with the available subdivision area.
        pa=max(1,plot_area)
        if pw>0 and pl>0:
            ratio=math.sqrt(pa/(pw*pl))
            pw*=ratio; pl*=ratio
        plots.append({
            "plot_no":i+1,
            "x":round(x+cell_w*.05,2), "y":round(y+cell_h*.05,2),
            "w":round(cell_w*.90,2), "h":round(cell_h*.90,2),
            "area_sqft":round(pa,2),
            "width_ft":round(pw,2),
            "length_ft":round(pl,2)
        })
    return {
        "plots":plots,
        "main_road":{"width_ft":main_road_ft,"area_sqft":round(calibrated_area*.12,2)},
        "internal_road":{"width_ft":internal_road_ft,"area_sqft":round(calibrated_area*.08,2)},
        "common_park":{"area_sqft":round(calibrated_area*park_pct/100,2),"percent":park_pct},
        "common_parking":{"area_sqft":round(calibrated_area*parking_pct/100,2),"percent":parking_pct,"near":"Main entrance / exit","spaces":max(2,int(calibrated_area*parking_pct/100/300))},
        "entry":{"x":50,"y":96},"exit":{"x":50,"y":4},
        "land_boundary":boundary_points or [{"id":"P1","x":5,"y":8},{"id":"P2","x":95,"y":8},{"id":"P3","x":95,"y":92},{"id":"P4","x":5,"y":92}],
        "plot_count":plots_count,"road_widths":{"main_ft":main_road_ft,"internal_ft":internal_road_ft},
        "land_dimensions":{"length_ft":round(length_ft,2),"width_ft":round(width_ft,2),"area_sqft":round(calibrated_area,2)}
    }

# ── Extended building type templates ──────────────────────────────
BUILDING_TEMPLATES = {
    "House": {
        0: ["Living Room","Kitchen","Dining","Bedroom","Bathroom","Parking"],
        1: ["Master Bedroom","Bedroom","Bathroom","Family Lounge","Study","Balcony"],
        2: ["Bedroom","Bedroom","Bathroom","Terrace","Utility","Staircase"],
        3: ["Bedroom","Office","Bathroom","Multipurpose","Terrace","Staircase"],
    },
    "Villa": {
        0: ["Grand Foyer","Living Room","Kitchen","Dining","Guest Bedroom","Bathroom","Utility","Parking"],
        1: ["Master Bedroom","Master Bathroom","Bedroom","Bedroom","Bathroom","Family Lounge","Staircase"],
        2: ["Bedroom","Study","Bathroom","Home Theater","Balcony","Terrace","Staircase"],
        3: ["Rooftop Lounge","Bar","Bathroom","Utility","Staircase"],
    },
    "Apartment Building": {
        0: ["Lobby","Reception","Security Room","Staircase","Lift Lobby","Parking","Parking"],
        1: ["Living Room","Kitchen","Dining","Bedroom","Master Bedroom","Bathroom","Balcony","Staircase"],
        2: ["Living Room","Kitchen","Dining","Bedroom","Master Bedroom","Bathroom","Balcony","Staircase"],
        3: ["Living Room","Kitchen","Dining","Bedroom","Bedroom","Bathroom","Terrace","Staircase"],
    },
    "Duplex": {
        0: ["Living Room","Kitchen","Dining","Bedroom","Bathroom","Parking","Staircase"],
        1: ["Master Bedroom","Bedroom","Bathroom","Study","Balcony","Staircase"],
        2: ["Bedroom","Bathroom","Terrace","Utility","Staircase"],
        3: ["Bedroom","Bathroom","Terrace","Utility","Staircase"],
    },
    "Commercial Building": {
        0: ["Reception","Lobby","Security","Lift Lobby","Staircase","Parking","Parking"],
        1: ["Open Office","Meeting Room","Conference Room","Pantry","Bathroom","Staircase"],
        2: ["Cabins","Manager Cabin","Open Office","Meeting Room","Bathroom","Storage","Staircase"],
        3: ["Board Room","Executive Cabin","Lounge","Bathroom","Terrace","Staircase"],
    },
    "Office": {
        0: ["Reception","Open Office","Meeting Room","Pantry","Bathroom","Staircase"],
        1: ["Cabins","Conference","Open Office","Bathroom","Storage","Staircase"],
        2: ["Manager Cabin","Training Room","Open Office","Bathroom","Utility","Staircase"],
        3: ["Board Room","Office","Lounge","Bathroom","Terrace","Staircase"],
    },
    "Hotel": {
        0: ["Lobby","Reception","Restaurant","Bar","Bathroom","Staircase","Lift Lobby"],
        1: ["Room 101","Room 102","Room 103","Room 104","Corridor","Bathroom","Staircase"],
        2: ["Room 201","Room 202","Room 203","Room 204","Corridor","Bathroom","Staircase"],
        3: ["Suite","Suite","Lounge","Terrace","Bathroom","Staircase"],
    },
    "Warehouse": {
        0: ["Storage Area","Loading Bay","Office","Bathroom","Security Room","Utility"],
        1: ["Storage Area","Storage Area","Office","Bathroom","Staircase"],
        2: ["Storage Area","Storage Area","Utility","Staircase"],
        3: ["Storage Area","Utility","Staircase"],
    },
    "Mixed-use": {
        0: ["Living Room","Kitchen","Dining","Bedroom","Bathroom","Shop/Office","Staircase"],
        1: ["Family Lounge","Master Bedroom","Bedroom","Bathroom","Study","Balcony","Staircase"],
        2: ["Bedroom","Bedroom","Study","Bathroom","Balcony","Utility","Staircase"],
        3: ["Office","Multipurpose","Bathroom","Terrace","Utility","Staircase"],
    },
    "Residential": {
        0: ["Living Room","Kitchen","Dining","Bedroom","Bathroom","Parking","Staircase"],
        1: ["Master Bedroom","Bedroom","Bathroom","Family Lounge","Study","Balcony","Staircase"],
        2: ["Bedroom","Bedroom","Bathroom","Study","Terrace","Utility","Staircase"],
        3: ["Bedroom","Office","Bathroom","Multipurpose","Terrace","Utility","Staircase"],
    },
}

ROOM_TYPE_MAP = {
    "staircase": "stair", "lift lobby": "stair", "staircase": "stair",
    "parking": "parking", "loading bay": "parking",
    "balcony": "balcony", "terrace": "balcony",
}

def classify_room(name):
    n = name.lower()
    for key, t in ROOM_TYPE_MAP.items():
        if key in n:
            return t
    return "room"

def room_templates(building_type, floor_index):
    tpl = BUILDING_TEMPLATES.get(building_type, BUILDING_TEMPLATES["Residential"])
    idx = min(floor_index, max(tpl.keys()))
    names = tpl[idx]
    return [{"name": n, "type": classify_room(n)} for n in names]

# All available room choices per building type (for the room picker)
ROOM_CHOICES = {
    "House":               ["Bedroom","Master Bedroom","Bathroom","Living Room","Kitchen","Dining","Study","Balcony","Terrace","Parking","Store Room","Utility","Staircase","Pooja Room","Servant Room","Guest Room"],
    "Villa":               ["Bedroom","Master Bedroom","Master Bathroom","Bathroom","Living Room","Kitchen","Dining","Study","Home Theater","Bar","Grand Foyer","Balcony","Terrace","Parking","Pool Area","Utility","Staircase","Servant Room","Guest Room"],
    "Apartment Building":  ["Bedroom","Master Bedroom","Bathroom","Living Room","Kitchen","Dining","Balcony","Terrace","Lobby","Reception","Lift Lobby","Staircase","Parking","Store Room"],
    "Duplex":              ["Bedroom","Master Bedroom","Bathroom","Living Room","Kitchen","Dining","Study","Balcony","Terrace","Parking","Staircase","Utility"],
    "Commercial Building": ["Open Office","Cabin","Meeting Room","Conference Room","Board Room","Reception","Lobby","Pantry","Bathroom","Storage","Staircase","Lift Lobby","Parking","Server Room","Cafeteria"],
    "Office":              ["Open Office","Cabin","Manager Cabin","Meeting Room","Conference Room","Training Room","Pantry","Bathroom","Storage","Staircase","Server Room","Reception"],
    "Hotel":               ["Room","Suite","Restaurant","Bar","Kitchen","Lobby","Reception","Bathroom","Corridor","Staircase","Lift Lobby","Terrace","Lounge","Utility"],
    "Warehouse":           ["Storage Area","Loading Bay","Office","Bathroom","Security Room","Utility","Staircase"],
    "Mixed-use":           ["Bedroom","Master Bedroom","Bathroom","Living Room","Kitchen","Dining","Shop/Office","Office","Balcony","Terrace","Staircase","Utility","Study"],
    "Residential":         ["Bedroom","Master Bedroom","Bathroom","Living Room","Kitchen","Dining","Study","Balcony","Terrace","Parking","Store Room","Utility","Staircase","Pooja Room","Guest Room"],
}

def make_building(payload):
    plot = payload.get("plot", {})
    btype = payload.get("building_type", "Residential")
    floors = int(clamp(safe_float(payload.get("floors"), 1), 1, 4))
    w = max(18, safe_float(payload.get("width_ft"), 24))
    l = max(24, safe_float(payload.get("length_ft"), 30))
    setbacks = {k: max(0, safe_float(payload.get("setbacks", {}).get(k), 0)) for k in ("front","rear","left","right")}
    plot_w = safe_float(plot.get("width_ft"), w + setbacks["left"] + setbacks["right"])
    plot_l = safe_float(plot.get("length_ft"), l + setbacks["front"] + setbacks["rear"])
    w = min(w, max(18, plot_w - setbacks["left"] - setbacks["right"]))
    l = min(l, max(24, plot_l - setbacks["front"] - setbacks["rear"]))
    floor_area = w*l
    total = floor_area*floors
    data=[]
    for i in range(floors):
        names = room_templates(btype, i)
        cols = 2 if len(names) <= 6 else 3
        rows = math.ceil(len(names)/cols)
        x_gap = 0.6; y_gap = 0.6
        cell_w = (w - x_gap*(cols+1))/cols
        cell_l = (l - y_gap*(rows+1))/rows
        rooms=[]
        for idx, spec in enumerate(names):
            c,r=divmod(idx,cols)
            rw=max(4.5, cell_w); rl=max(6.0, cell_l)
            room={"name":spec["name"],"type":spec["type"],"x_ft":round(x_gap+c*(cell_w+x_gap),2),"y_ft":round(y_gap+r*(cell_l+y_gap),2),"width_ft":round(rw,2),"length_ft":round(rl,2)}
            rooms.append(room)
        data.append({"floor":i,"label":"Ground" if i==0 else f"Floor {i}","rooms":rooms})
    room_count=sum(len(f["rooms"]) for f in data)
    choices = ROOM_CHOICES.get(btype, ROOM_CHOICES["Residential"])
    return {"id":uid("bld"),"plot_no":plot.get("plot_no",1),"building_type":btype,
            "width_ft":round(w,2),"length_ft":round(l,2),"floors":floors,"floor_height_ft":10,
            "floor_area_sqft":round(floor_area,2),"built_up_sqft":round(total,2),
            "setbacks":setbacks,"floor_data":data,"room_count":room_count,
            "name":payload.get("name","My Building"),
            "style":payload.get("style","Modern Contemporary"),
            "quality":payload.get("quality","standard"),
            "rate_per_sqft":safe_float(payload.get("rate_per_sqft"),2200),
            "room_choices":choices,
            "visual":{"buildingColor":"#e8e4dc","floorColors":["#e8e4dc" for _ in range(floors)]},
            "created_at":datetime.datetime.now().isoformat()}

def estimate_cost(b):
    total = safe_float(b.get("built_up_sqft"), 0)
    quality = str(b.get("quality", "standard")).lower()
    base = {"standard":2200, "premium":2900, "luxury":3800}.get(quality, 2200)
    rate = safe_float(b.get("rate_per_sqft"), base) or base
    # Project-specific complexity: different buildings/rooms/floors no longer
    # collapse to the exact same material estimate.
    floors = max(1, int(safe_float(b.get("floors"), 1)))
    rooms = sum(len(f.get("rooms", [])) for f in b.get("floor_data", []))
    room_factor = 1.0 + min(0.18, max(0, rooms-6)*0.008)
    floor_factor = 1.0 + max(0, floors-1)*0.025
    quality_factor = {"standard":1.0,"premium":1.08,"luxury":1.16}.get(quality,1.0)
    material_factor = room_factor * floor_factor * quality_factor
    cement=total*.018*material_factor
    steel=total*.0045*material_factor
    bricks=int(total*8*room_factor)
    sand=total*.085*material_factor
    flooring=total*.82*room_factor
    paint=total*2.7*floor_factor
    labour=total*650*floor_factor
    material=total*max(0,rate-650)*material_factor
    building_total=total*rate*material_factor

    site_area=safe_float(b.get("site_area_sqft"),0)
    plot_area=safe_float(b.get("selected_plot_area_sqft"),0)
    plot_count=max(0,int(safe_float(b.get("plot_count"),0)))
    roads=safe_float(b.get("site_road_area_sqft"),0)
    amenities=safe_float(b.get("site_amenity_area_sqft"),0)
    # Site development varies with the analyzed land/layout, so different land
    # images/layouts do not show an identical total project cost.
    perimeter=safe_float(b.get("land_perimeter_ft"),0)
    land_length=safe_float(b.get("land_length_ft"),0)
    land_width=safe_float(b.get("land_width_ft"),0)
    # Land/layout-specific development cost: different analyzed images and dimensions
    # should produce different site-development totals even when the building is identical.
    boundary_factor=1.0 + min(0.22, max(0.0, perimeter/8000.0))
    frontage_factor=1.0 + min(0.12, max(0.0, land_length/500.0))
    shape_factor=1.0 + min(0.10, abs(land_length-max(land_width,1))/max(land_length,land_width,1)*0.10)
    site_dev=max(0, (roads*140*boundary_factor + amenities*90*frontage_factor + max(0,site_area-plot_area)*28*shape_factor + plot_count*7500) * boundary_factor)
    project_total=building_total+site_dev
    return {"cement_tonnes":round(cement,2),"steel_tonnes":round(steel,2),"bricks_blocks":bricks,
            "sand_cuft":round(sand,2),"flooring_sqft":round(flooring,2),"paint_sqft":round(paint,2),
            "labour_inr":round(labour,2),"material_inr":round(material,2),"approx_cost_inr":round(building_total,2),
            "site_development_inr":round(site_dev,2),"project_total_inr":round(project_total,2),
            "rate_per_sqft":round(rate,2),"effective_rate_per_sqft":round(rate*material_factor,2),"quality":quality,"rooms":rooms,"floors":floors,
            "site_area_sqft":round(site_area,2),"selected_plot_area_sqft":round(plot_area,2),
            "explanation":"Building materials depend on built-up area, floors, rooms and quality; site development depends on analyzed land/layout area, roads, amenities and plot count."}


def estimate_construction(b):
    """Return a conceptual construction schedule and workforce estimate."""
    area = max(1.0, safe_float(b.get("built_up_sqft"), 0))
    floors = int(clamp(safe_float(b.get("floors"), 1), 1, 6))
    rooms = sum(len(f.get("rooms", [])) for f in b.get("floor_data", []))
    quality = str(b.get("quality", "standard")).lower()
    style_factor = {"standard": 1.0, "premium": 1.10, "luxury": 1.22}.get(quality, 1.0)
    complexity = 1.0 + max(0, floors-1)*0.07 + max(0, rooms-10)*0.012
    area_factor = max(0.82, min(1.45, (area/1800.0)**0.20))
    factor = style_factor * complexity * area_factor
    phases = [
        ("Site preparation", 6, 5, "Survey, clearing, setting out"),
        ("Foundation", 22, 10, "Excavation, footing, plinth"),
        ("Structure", 28, 12, "Columns, beams, slabs and stairs"),
        ("Brick / block work", 20, 9, "Walls and partitions"),
        ("Plumbing & electrical", 18, 7, "First-fix services"),
        ("Plastering", 17, 10, "Internal and external plaster"),
        ("Flooring & tiling", 14, 8, "Floor, kitchen and bathroom finishes"),
        ("Doors & windows", 10, 6, "Frames, shutters and glazing"),
        ("Painting", 13, 7, "Primer, coats and touch-up"),
        ("Final finishing", 10, 6, "Fixtures, cleaning and handover"),
    ]
    rows=[]
    for name,days,workers,desc in phases:
        d=max(3, round(days*factor))
        w=max(3, round(workers*(1 + max(0,floors-2)*0.08)))
        rows.append({"phase":name,"days":d,"workers":w,"description":desc})
    # Several phases overlap, so use a practical concurrency factor rather than summing all durations.
    total_days=round(sum(x["days"] for x in rows)*0.58 + max(0,floors-1)*12)
    total_days=max(90, total_days)
    peak=max(x["workers"] for x in rows) + (2 if floors>=2 else 0)
    average=round(sum(x["workers"] for x in rows)/len(rows))
    months=round(total_days/30.4,1)
    return {"area_sqft":round(area,2),"floors":floors,"rooms":rooms,"quality":quality,
            "total_days":total_days,"months":months,"peak_workers":peak,"average_workers":average,
            "phases":rows,"disclaimer":"Conceptual planning estimate; actual construction duration and workforce vary by site, approvals, weather, supply and contractor."}

def validate_building(b):
    warnings=[]; checks={"boundary":True,"overlap":True,"setbacks":True,"bathroom_access":True,"staircase":True,"parking":True}
    W=safe_float(b.get("width_ft"),0); L=safe_float(b.get("length_ft"),0)
    for f in b.get("floor_data",[]):
        rooms=f.get("rooms",[])
        for r in rooms:
            if r.get("x_ft",0)<0 or r.get("y_ft",0)<0 or r.get("x_ft",0)+r.get("width_ft",0)>W+0.01 or r.get("y_ft",0)+r.get("length_ft",0)>L+0.01:
                checks["boundary"]=False; warnings.append(f"{f.get('label','Floor')}: {r.get('name')} exceeds the building boundary.")
        for i,a in enumerate(rooms):
            for bb in rooms[i+1:]:
                ax,ay,aw,al=[safe_float(a.get(k),0) for k in ('x_ft','y_ft','width_ft','length_ft')]
                bx,by,bw,bl=[safe_float(bb.get(k),0) for k in ('x_ft','y_ft','width_ft','length_ft')]
                if ax < bx+bw and ax+aw > bx and ay < by+bl and ay+al > by:
                    checks["overlap"]=False; warnings.append(f"{f.get('label','Floor')}: {a.get('name')} overlaps {bb.get('name')}.")
        names=' '.join(r.get('name','').lower() for r in rooms)
        btype=b.get('building_type','Residential')
        if btype in ('Residential','House','Villa','Apartment Building','Duplex','Mixed-use'):
            if 'bathroom' not in names: checks['bathroom_access']=False; warnings.append(f"{f.get('label','Floor')}: bathroom missing.")
            if b.get('floors',1)>1 and 'staircase' not in names and 'lift lobby' not in names:
                checks['staircase']=False; warnings.append(f"{f.get('label','Floor')}: staircase missing.")
    score=100-len(warnings)*4
    return {"valid":not warnings,"score":max(0,min(100,score)),"warnings":warnings[:12],"checks":checks}

def sustainability(b):
    floors=b.get('floors',1); rooms=[r for f in b.get('floor_data',[]) for r in f.get('rooms',[])]
    area=safe_float(b.get('built_up_sqft'),1) or 1
    balcony=sum(1 for r in rooms if 'balcony' in r.get('name','').lower() or 'terrace' in r.get('name','').lower())
    daylight=clamp(65+balcony*4+(10 if b.get('width_ft',0)/max(1,b.get('length_ft',1))>.55 else 0),0,100)
    ventilation=clamp(62+min(20,len(rooms)//3),0,100)
    open_space=clamp(55+(10 if floors<=2 else 5),0,100)
    solar=clamp(60+(12 if balcony else 0)+(8 if floors<=3 else 3),0,100)
    score=round((daylight+ventilation+open_space+solar)/4)
    rec='Add larger openings and cross-ventilation where feasible; consider solar panels and rainwater harvesting.'
    return {"score":score,"lighting":round(daylight),"ventilation":round(ventilation),"open_space":round(open_space),"solar_potential":round(solar),"daylight_index":round(daylight),"recommendation":rec}

def reflow_rooms(b):
    """Re-calculate x/y positions for all rooms on each floor after add/remove."""
    w = safe_float(b.get("width_ft"), 24)
    l = safe_float(b.get("length_ft"), 30)
    x_gap = 0.6; y_gap = 0.6
    for f in b.get("floor_data", []):
        rooms = f.get("rooms", [])
        n = len(rooms)
        if n == 0:
            continue
        cols = 2 if n <= 6 else 3
        rows = math.ceil(n / cols)
        cell_w = max(4.5, (w - x_gap*(cols+1)) / cols)
        cell_l = max(6.0, (l - y_gap*(rows+1)) / rows)
        for idx, r in enumerate(rooms):
            c, row = divmod(idx, cols)
            r["x_ft"] = round(x_gap + c*(cell_w+x_gap), 2)
            r["y_ft"] = round(y_gap + row*(cell_l+y_gap), 2)
            r["width_ft"] = round(cell_w, 2)
            r["length_ft"] = round(cell_l, 2)
    b["room_count"] = sum(len(f.get("rooms",[])) for f in b.get("floor_data",[]))
    return b

@app.get("/")
def index():
    return send_from_directory(FRONTEND, "index.html")

@app.get("/<path:path>")
def static_files(path):
    f = FRONTEND / path
    if f.exists() and f.is_file():
        return send_from_directory(FRONTEND, path)
    return send_from_directory(FRONTEND, "index.html")

@app.post("/api/upload")
def upload():
    f = request.files.get("image")
    if not f or not f.filename:
        return err("Please select a land image.")
    ext = f.filename.rsplit(".",1)[-1].lower() if "." in f.filename else ""
    if ext not in ALLOWED:
        return err("Supported image formats: JPG, PNG, WEBP.")
    name = f"{uuid.uuid4().hex}.{ext}"
    path = UPLOADS / name
    f.save(path)
    with Image.open(path) as im:
        w,h = im.size
    return ok({"filename":name, "url":f"/uploads/{name}", "width":w, "height":h})

@app.get("/uploads/<name>")
def uploaded(name):
    return send_from_directory(UPLOADS, name)

@app.post("/api/analyze")
def analyze():
    body = request.get_json(silent=True) or {}
    filename = body.get("filename")
    if not filename or not (UPLOADS/filename).exists():
        return err("Upload an image first.")
    with Image.open(UPLOADS/filename) as im:
        w,h = im.size
    measurements = normalize_measurements(body.get("measurements", []))
    if not measurements:
        # Also accept direct length/width fields for simpler workflows.
        width_ft=safe_float(body.get("width_ft"),0); length_ft=safe_float(body.get("length_ft"),0)
        if width_ft>0: measurements.append({"name":"Front","ft":width_ft})
        if length_ft>0: measurements.append({"name":"Right","ft":length_ft})
        if width_ft>0: measurements.append({"name":"Back","ft":width_ft})
        if length_ft>0: measurements.append({"name":"Left","ft":length_ft})
    if not measurements:
        return err("Enter the real length/width or at least one boundary measurement.")

    points=sanitize_points(body.get("points"),w,h)
    if len(points)<3:
        points=make_boundary(w,h,measurements)
    # Support irregular parcels with 3–20 user-marked boundary points.
    # Keep the user's polygon order; do not truncate it to four corners.
    points=points[:20]
    px_lengths=side_pixel_lengths(points)
    mvals=[m["ft"] for m in measurements]
    if len(points)>=4 and len(mvals)>=4:
        real_sides=[mvals[i%4] for i in range(4)]
        # Separate width and depth scales for perspective-aware calibration.
        px_width=sum(px_lengths[i] for i in (0,2))/2
        px_depth=sum(px_lengths[i] for i in (1,3))/2
        real_width=(real_sides[0]+real_sides[2])/2
        real_depth=(real_sides[1]+real_sides[3])/2
        sx=px_width/max(real_width,0.001); sy=px_depth/max(real_depth,0.001)
        # When the user supplies all four real sides, those dimensions are the authoritative
        # calibration reference. The image controls the boundary shape/placement; the entered
        # dimensions control the measured area and perimeter.
        if body.get("dimension_locked", True):
            area=real_width*real_depth
            method="Dimension-locked four-corner calibration"
        else:
            area=polygon_area(points)/max(sx*sy,0.001)
            method="Four-corner image calibration"
        width_est=real_width; length_est=real_depth
        perimeter=sum(real_sides)
    elif len(points)>=4 and len(mvals)>=2 and len(mvals)<len(points):
        width_est=mvals[0]; length_est=mvals[1]
        sx=px_lengths[0]/max(width_est,0.001); sy=px_lengths[1]/max(length_est,0.001)
        area=polygon_area(points)/max(sx*sy,0.001); perimeter=sum(mvals) if len(mvals)>=3 else 2*(width_est+length_est); method="Length/width calibrated irregular boundary"
    elif len(points)>=3 and len(mvals)>=len(points):
        # Irregular polygon: use every supplied edge measurement. A robust mean
        # pixel/ft scale converts the image polygon into a conceptual real-world area.
        scales=[px_lengths[i]/max(mvals[i],0.001) for i in range(len(points))]
        scale=sum(scales)/max(1,len(scales))
        area=polygon_area(points)/max(scale*scale,0.001)
        width_est=max(mvals); length_est=min(mvals)
        perimeter=sum(mvals[:len(points)])
        method="Multi-point irregular polygon calibration"
    else:
        longest_real=max(mvals); longest_px=max(px_lengths) if px_lengths else 1
        scale=longest_px/max(longest_real,0.001)
        ratio=h/w if w else 1
        width_est=longest_real; length_est=max(1,longest_real*ratio)
        area=polygon_area(points)/max(scale*scale,0.001); perimeter=sum(mvals) if len(mvals)>=4 else 2*(width_est+length_est); method="Reference-side calibration"

    dims=[]
    for i,p in enumerate(points):
        q=points[(i+1)%len(points)]
        if i<len(mvals): real=mvals[i]
        elif i==0 and mvals: real=width_est
        elif i==1 and mvals: real=length_est
        elif i==2 and mvals: real=width_est
        else: real=length_est
        dims.append({"from":p["id"],"to":q["id"],"ft":round(real,2)})
    warnings=[]
    if len(points)>4:
        warnings.append("Irregular polygon mode: each boundary edge can have its own measurement. Final dimensions should be verified by a licensed survey.")
    elif len(points)==3:
        warnings.append("Three-point boundary mode is supported for triangular land; verify the remaining site geometry with a survey.")
    warnings.append("Image measurement is conceptual; verify the final boundary with a licensed survey/property record.")
    return ok({
        "image_width":w,"image_height":h,"points":points,"measurements":measurements,"boundary_dimensions":dims,
        "scale_px_per_ft":round((sum(px_lengths)/max(sum(mvals),0.001)) if px_lengths else 0,3),
        "area_sqft":round(max(0,area),2),"perimeter_ft":round(perimeter,2),
        "width_ft":round(width_est,2),"length_ft":round(length_est,2),
        "sq_yards":round(max(0,area)/9,2),"sq_meters":round(max(0,area)*.092903,2),
        "acres":round(max(0,area)/43560,4),"cents":round(max(0,area)/435.6,2),
        "confidence":"High — four-corner calibrated" if len(points)>=4 and len(mvals)>=4 else "Calibrated reference",
        "method":method,"warnings":warnings
    })

@app.post("/api/layouts/generate")
def layouts():
    body=request.get_json(silent=True) or {}
    area=safe_float(body.get("area_sqft"),0)
    if area <= 0: return err("Analyze the land before generating layouts.")
    count=int(clamp(safe_float(body.get("plots"),6),2,20))
    result=[]
    base_park=clamp(safe_float(body.get("park_pct"),10),0,30)
    base_parking=clamp(safe_float(body.get("parking_pct"),7),0,20)
    for i,(name,park,parking) in enumerate([
        ("Balanced Layout",base_park,base_parking),
        ("More Open Space",min(30,base_park+5),max(0,base_parking-1)),
        ("Higher Plot Yield",max(0,base_park-4),max(0,base_parking-2))
    ]):
        result.append({"id":uid("layout"),"name":name,"description":"Conceptual subdivision option",
                        "layout":build_layout(area,count,park,parking,
                                              safe_float(body.get("main_road_ft"),30),
                                              safe_float(body.get("internal_road_ft"),20),
                                              body.get("boundary_points") or None,
                                              safe_float(body.get("length_ft"),0),
                                              safe_float(body.get("width_ft"),0))})
    return ok({"layouts":result})

@app.post("/api/buildings/generate")
def buildings():
    body=request.get_json(silent=True) or {}
    if not body.get("plot"): return err("Select a plot first.")
    return ok(make_building(body))

@app.post("/api/buildings/estimate")
def building_estimate():
    body=request.get_json(silent=True) or {}
    if not body.get("built_up_sqft"): return err("Building data is required.")
    return ok(estimate_cost(body))


@app.post("/api/buildings/construction")
def building_construction():
    body=request.get_json(silent=True) or {}
    b=body.get("building",body)
    if not b or not b.get("floor_data"): return err("Building data is required.")
    return ok(estimate_construction(b))

@app.post("/api/buildings/validate")
def building_validate():
    body=request.get_json(silent=True) or {}
    b=body.get("building",body)
    if not b.get("floor_data"): return err("Building data is required.")
    return ok(validate_building(b))

@app.post("/api/buildings/sustainability")
def building_sustainability():
    body=request.get_json(silent=True) or {}
    b=body.get("building",body)
    if not b.get("floor_data"): return err("Building data is required.")
    return ok(sustainability(b))

@app.post("/api/buildings/customize")
def building_customize():
    body=request.get_json(silent=True) or {}
    b=body.get("building")
    cmd=str(body.get("command","")).strip().lower()
    if not b or not cmd: return err("Building and customization command are required.")
    out=copy.deepcopy(b)
    rooms_all=[r for f in out.get("floor_data",[]) for r in f.get("rooms",[])]
    def add_room(floor, name, typ='room'):
        f=out['floor_data'][floor]
        f['rooms'].append({'name':name,'type':classify_room(name),'x_ft':0,'y_ft':0,'width_ft':10,'length_ft':12,'furniture':'default','material':'standard','door_position':'front','window_count':2})
    changed=False
    if ('add' in cmd or 'create' in cmd) and 'bedroom' in cmd:
        floor=1 if len(out['floor_data'])>1 else 0; add_room(floor,'New Bedroom'); changed=True
    if ('add' in cmd or 'create' in cmd) and ('bathroom' in cmd or 'washroom' in cmd):
        floor=1 if len(out['floor_data'])>1 else 0; add_room(floor,'New Bathroom'); changed=True
    if ('add' in cmd or 'create' in cmd) and 'study' in cmd and not any('study' in r['name'].lower() for r in rooms_all): add_room(min(1,len(out['floor_data'])-1),'Study'); changed=True
    if ('add' in cmd or 'create' in cmd) and 'parking' in cmd and not any('parking' in r['name'].lower() for r in rooms_all): add_room(0,'Parking','parking'); changed=True
    # Natural-language dimensions: "master bedroom 14 x 16", "bedroom to 12 by 14"
    dim=re.search(r'(\d+(?:\.\d+)?)\s*(?:ft\s*)?(?:x|by)\s*(\d+(?:\.\d+)?)\s*(?:ft)?',cmd)
    if dim:
        w=float(dim.group(1)); l=float(dim.group(2))
        target='master bedroom' if 'master bedroom' in cmd else ('bedroom' if 'bedroom' in cmd else ('living' if 'living' in cmd else ('kitchen' if 'kitchen' in cmd else ('bathroom' if 'bathroom' in cmd else ''))))
        target_room=None
        for r in rooms_all:
            if target and target in r.get('name','').lower(): target_room=r; break
        if target_room:
            target_room['width_ft']=round(max(3,min(w,float(out.get('width_ft',w))-0.4)),2)
            target_room['length_ft']=round(max(4,min(l,float(out.get('length_ft',l))-0.4)),2)
            changed=True
    if 'larger' in cmd or 'bigger' in cmd:
        target='master bedroom' if 'master' in cmd else 'bedroom'
        for r in rooms_all:
            if target in r['name'].lower():
                r['width_ft']=round(min(out['width_ft']-0.4,r['width_ft']+1.5),2)
                r['length_ft']=round(min(out['length_ft']-0.4,r['length_ft']+1.5),2); changed=True; break
    if 'smaller' in cmd:
        target='master bedroom' if 'master' in cmd else 'bedroom'
        for r in rooms_all:
            if target in r['name'].lower():
                r['width_ft']=round(max(4.0,r['width_ft']-1.0),2); r['length_ft']=round(max(5.0,r['length_ft']-1.0),2); changed=True; break
    if changed and any(('add' in cmd or 'create' in cmd) for _ in [0]):
        out=reflow_rooms(out)
    else:
        out['room_count']=sum(len(f.get('rooms',[])) for f in out.get('floor_data',[]))
    return ok(out)

# ── Room editor API endpoints ──────────────────────────────────────

@app.post("/api/buildings/rooms/add")
def room_add():
    """Add a named room to a specific floor and reflow positions."""
    body = request.get_json(silent=True) or {}
    b = body.get("building")
    floor_idx = int(body.get("floor", 0))
    room_name = str(body.get("room_name", "Room")).strip()
    if not b or not b.get("floor_data"):
        return err("Building data required.")
    if floor_idx < 0 or floor_idx >= len(b["floor_data"]):
        return err("Invalid floor index.")
    out = copy.deepcopy(b)
    rtype = classify_room(room_name)
    out["floor_data"][floor_idx]["rooms"].append({
        "name": room_name, "type": rtype,
        "x_ft": 0, "y_ft": 0, "width_ft": 10, "length_ft": 12
    })
    out = reflow_rooms(out)
    return ok(out)

@app.post("/api/buildings/rooms/remove")
def room_remove():
    """Remove a room by floor index + room index, then reflow."""
    body = request.get_json(silent=True) or {}
    b = body.get("building")
    floor_idx = int(body.get("floor", 0))
    room_idx = int(body.get("room_idx", 0))
    if not b or not b.get("floor_data"):
        return err("Building data required.")
    if floor_idx < 0 or floor_idx >= len(b["floor_data"]):
        return err("Invalid floor index.")
    out = copy.deepcopy(b)
    rooms = out["floor_data"][floor_idx]["rooms"]
    if room_idx < 0 or room_idx >= len(rooms):
        return err("Invalid room index.")
    removed = rooms.pop(room_idx)
    out = reflow_rooms(out)
    return ok(out)

@app.post("/api/buildings/rooms/rename")
def room_rename():
    """Rename a room and update its type."""
    body = request.get_json(silent=True) or {}
    b = body.get("building")
    floor_idx = int(body.get("floor", 0))
    room_idx = int(body.get("room_idx", 0))
    new_name = str(body.get("new_name", "Room")).strip()
    if not b or not b.get("floor_data"):
        return err("Building data required.")
    out = copy.deepcopy(b)
    rooms = out["floor_data"][floor_idx]["rooms"]
    if room_idx < 0 or room_idx >= len(rooms):
        return err("Invalid room index.")
    rooms[room_idx]["name"] = new_name
    rooms[room_idx]["type"] = classify_room(new_name)
    out["room_count"] = sum(len(f.get("rooms",[])) for f in out.get("floor_data",[]))
    return ok(out)

@app.post("/api/buildings/rooms/update")
def room_update():
    """Update room dimensions, placement and customization without reflowing the floor."""
    body=request.get_json(silent=True) or {}
    b=body.get("building"); floor_idx=int(body.get("floor",0)); room_idx=int(body.get("room_idx",0))
    if not b or not b.get("floor_data"): return err("Building data required.")
    if floor_idx<0 or floor_idx>=len(b["floor_data"]): return err("Invalid floor index.")
    out=copy.deepcopy(b); rooms=out["floor_data"][floor_idx].get("rooms",[])
    if room_idx<0 or room_idx>=len(rooms): return err("Invalid room index.")
    r=rooms[room_idx]
    name=str(body.get("name",r.get("name","Room"))).strip() or "Room"
    r["name"]=name; r["type"]=classify_room(name)
    for key,minimum,maximum in (("width_ft",3,float(out.get("width_ft",100))), ("length_ft",4,float(out.get("length_ft",100))), ("x_ft",0,float(out.get("width_ft",100))), ("y_ft",0,float(out.get("length_ft",100)))):
        if key in body and body[key] != "":
            try: r[key]=round(max(minimum,min(float(body[key]),maximum)),2)
            except (ValueError,TypeError): return err(f"Invalid {key}.")
    r["furniture"]=str(body.get("furniture",r.get("furniture","default")))
    r["material"]=str(body.get("material",r.get("material","standard")))
    r["door_position"]=str(body.get("door_position",r.get("door_position","front")))
    try: r["window_count"]=int(max(0,min(6,int(body.get("window_count",r.get("window_count",2))))))
    except: pass
    # Clamp room to building boundary while preserving its custom size.
    r["x_ft"]=round(max(0,min(r["x_ft"],float(out.get("width_ft",100))-r["width_ft"])),2)
    r["y_ft"]=round(max(0,min(r["y_ft"],float(out.get("length_ft",100))-r["length_ft"])),2)
    out["room_count"]=sum(len(f.get("rooms",[])) for f in out.get("floor_data",[]))
    return ok(out)

@app.get("/api/buildings/room_choices")
def room_choices_list():
    """Return available room choices for a building type."""
    btype = request.args.get("type", "Residential")
    choices = ROOM_CHOICES.get(btype, ROOM_CHOICES["Residential"])
    return ok({"choices": choices, "building_type": btype})

@app.post("/api/projects")
def projects():
    body=request.get_json(silent=True) or {}
    name=str(body.get("name") or "Untitled Land Project")[:100]
    project={"id":body.get("id") or uid("project"),"name":name,"updated_at":datetime.datetime.now().isoformat(),
             "state":body.get("state",{})}
    path=DATA/f"{project['id']}.json"
    path.write_text(json.dumps(project,indent=2),encoding="utf-8")
    return ok(project)

@app.get("/api/projects")
def project_list():
    items=[]
    for p in sorted(DATA.glob("project_*.json"), key=lambda x:x.stat().st_mtime, reverse=True):
        try: items.append(json.loads(p.read_text(encoding="utf-8")))
        except Exception: pass
    return ok(items)

@app.get("/api/projects/<pid>")
def project_get(pid):
    path=DATA/f"{pid}.json"
    if not path.exists(): return err("Project not found.",404)
    return ok(json.loads(path.read_text(encoding="utf-8")))

@app.delete("/api/projects/<pid>")
def project_delete(pid):
    path=DATA/f"{pid}.json"
    if not path.exists(): return err("Project not found.",404)
    try: path.unlink()
    except Exception as e: return err(f"Could not delete project: {e}",500)
    return ok({"deleted":pid})

@app.post("/api/reports/generate")
def report():
    body=request.get_json(silent=True) or {}
    project=body.get("project",{})
    report_id=uid("report")
    path=REPORTS/f"{report_id}.pdf"
    c=canvas.Canvas(str(path),pagesize=A4)
    W,H=A4
    c.setTitle("LandLensAI Project Report")
    c.setFont("Helvetica-Bold",20); c.drawString(45,H-55,"LandLensAI — Project Report")
    c.setFont("Helvetica",10); c.drawString(45,H-75,datetime.datetime.now().strftime("%d %b %Y, %H:%M"))
    y=H-105
    def line(text, size=10, bold=False):
        nonlocal y
        if y<55: c.showPage(); y=H-55
        c.setFont("Helvetica-Bold" if bold else "Helvetica",size)
        c.drawString(45,y,str(text)[:110]); y-=16
    land=project.get("analysis",{})
    line("LAND ANALYSIS",13,True)
    for k in ("area_sqft","perimeter_ft","sq_yards","sq_meters","acres","cents","confidence"):
        if k in land: line(f"{k.replace('_',' ').title()}: {land[k]}")
    line("BOUNDARY MEASUREMENTS",13,True)
    for d in land.get("boundary_dimensions",[]): line(f"{d['from']} → {d['to']}: {d['ft']} ft")
    layout=project.get("layout",{})
    line("SITE LAYOUT",13,True)
    line(f"Plots: {len(layout.get('plots',[]))}")
    line(f"Common Park: {layout.get('common_park',{}).get('area_sqft',0)} sq.ft")
    line(f"Common Parking: {layout.get('common_parking',{}).get('area_sqft',0)} sq.ft")
    building=project.get("building")
    if building:
        line("BUILDING",13,True)
        for k in ("building_type","width_ft","length_ft","floors","floor_area_sqft","built_up_sqft","style"):
            line(f"{k.replace('_',' ').title()}: {building.get(k)}")
        line("FLOOR ROOMS",13,True)
        for f in building.get("floor_data",[]):
            line(f"{f['label']}: " + ", ".join(r["name"] for r in f["rooms"]))
        schedule=project.get("construction",{})
        if schedule:
            line("CONSTRUCTION PLAN",13,True)
            line(f"Approx. duration: {schedule.get('months','—')} months ({schedule.get('total_days','—')} days)")
            line(f"Peak workforce: {schedule.get('peak_workers','—')} workers")
            line(f"Average workforce: {schedule.get('average_workers','—')} workers")
            for ph in schedule.get("phases",[]): line(f"{ph.get('phase')}: {ph.get('days')} days · {ph.get('workers')} workers")
        cost=project.get("cost",{})
        line("ESTIMATE",13,True)
        for k,v in cost.items(): line(f"{k.replace('_',' ').title()}: {v}")
    line("IMPORTANT DISCLAIMER",13,True)
    line("Conceptual planning output. Verify land boundaries, setbacks, structure, costs and local rules")
    line("with qualified surveyors/architects/engineers before construction.")
    c.save()
    return ok({"filename":path.name,"url":f"/reports/{path.name}"})

@app.get("/reports/<name>")
def report_file(name):
    return send_from_directory(REPORTS,name,as_attachment=True)

@app.get("/api/health")
def health():
    return ok({"status":"healthy","version":"advanced-2.0"})

if __name__=="__main__":
    app.run(host="127.0.0.1",port=8000,debug=False)
