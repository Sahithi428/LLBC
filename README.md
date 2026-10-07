# LandLensAI Advanced

LandLensAI is an AI-assisted conceptual land-planning and architectural visualization platform.

## Main workflow

Land image → real user measurements → boundary detection/calibration → automatic point marking → land analysis → plot division → roads → common park → common parking → plot selection → building constructor → 2D floor planning → offline interactive 3D studio → cost estimate → PDF report.

## Windows 11 setup

```powershell
cd LandLensAI_Advanced
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe backend\app.py
```

Open:

http://127.0.0.1:8000

No Node/npm installation is required.

## Important

The image-analysis engine is deliberately conservative: an ordinary photograph cannot prove survey-grade dimensions. User-provided measurements are treated as calibration/reference data. The generated boundary and architectural design are conceptual and should be verified by qualified professionals and applicable local rules.

The 3D studio is offline-first and uses a built-in Canvas isometric renderer, so 3D visualization works without Three.js, a CDN, or internet access.

## Hackathon UI refresh
The latest build includes a premium hackathon dashboard with animated hero cards, live project-progress tracking, quick workflow actions, active sidebar navigation, refined cards/forms, building-type selectors, room-editor styling, and a dedicated 3D studio HUD with model status, compass, architectural grid, floor labels, and interaction cues. The offline canvas-based 3D renderer remains CDN-free.


## Presentation-ready updates (Oct 2026)
- Fixed offline 3D projection so room positions use both floor-plan axes correctly.
- Added readable room callouts, architectural perimeter outline, floor visibility and orbit controls.
- Building type cards (House, Villa, Apartment, Duplex, Commercial, Office, Hotel, Warehouse, Mixed-use) are clickable and update the selected type.
- Added a dedicated **2D Constructor** navigation section with floor tabs, room counts, dimensions and color-coded room plan.
- Added keyboard shortcuts in 3D/presentation mode: H House, V Villa, A Apartment, D Duplex, C Commercial, O Office, T Hotel, W Warehouse, M Mixed-use.
- Use **Generate Building** after selecting a building type to rebuild the 2D and 3D model.

### Fast presentation flow
1. Land Analysis → upload image → Analyze.
2. Plot Planning → Generate Layout → select a plot.
3. Building Constructor → choose **House** or another building type → choose floors → Generate Building.
4. Open **2D Constructor** to show the floor plan and room dimensions.
5. Open **3D Studio** → All Floors / Explode / Hide Roof / Walkthrough.
6. Materials & Cost → show estimate.
7. Reports → Generate PDF Report.

## Presentation Build — Construction Planner & Architectural Visualization

This version adds:
- Realistic Architectural visualization mode in the offline 3D Studio (landscape, windows, doors, furniture, roof/material treatment, day/evening/night presentation).
- Dedicated 2D Constructor linked to the same generated building model.
- Construction Time & Workforce Planner with phase-by-phase timeline, approximate duration, average workforce and peak workforce.
- Construction estimates automatically refresh after room edits and building regeneration.
- PDF project report includes the construction plan when available.

All measurements, costs, timelines and 3D geometry are conceptual planning outputs and must be verified by qualified professionals before construction.


## Latest update — independent land dimensions + distinct building visuals
- Each of the four land-side dimension inputs is independent; editing one no longer copies its value to the opposite side.
- Editing a dimension rescales the corresponding visible boundary edge on the uploaded land image.
- Site-layout generation now uses calibrated land length/width rather than a fixed square assumption, so plot geometry responds to the land aspect ratio.
- Building 3D visualization now has distinct exterior signatures for House, Villa, Duplex, Apartment Building, Commercial Building, Office, Hotel, Warehouse and Mixed-use.
- Existing project features were left intact.

### Irregular boundary update (Oct 2026)
- Land boundary picker now supports 3–20 points instead of stopping at four corners.
- Clicking the image after the first four corners adds additional boundary vertices; all vertices can be dragged.
- Every polygon edge can have an independent real-world measurement; changing one edge no longer copies its value to another edge.
- Irregular 5–20 point polygons are preserved through analysis and site-layout generation.
- Multi-point calibration uses the supplied edge measurements with a conceptual image scale; final dimensions should still be verified by a licensed survey.
