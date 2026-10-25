# SF Civic Lens + Gemini 4 Argon 

**SF Civic Lens** is a full-stack urban triage and 3D spatial remediation platform powered by **Gemini 4 Argon (`gemini-4-argon`)** and **FalkorDB**. It upgrades static 2D street-level hazard photos into interactive 3D engineering simulations, physics-verified accessibility bypasses, and graph-tracked municipal dispatch workflows[cite: 5, 6].

This project includes a static frontend at `sf_civic_lens_web_application.html`, interactive 3D simulation modules, and a Flask backend at `backend_server.py`.

---

## Core Gemini 4 Argon Simulation Capabilities

### 1. Curb Access & Standing Water Bypass Simulation (3D Physics & Telemetry)
Using **Gemini 4 Argon's** 1M output window and multimodal video reasoning, the system generates and verifies a playable 3D street-intersection simulation for curb-access hazards[cite: 5, 6]:

* **Spatial Hazard & Remediation Modeling:**
  * **Observed Standing Water (No-Go Zone):** Maps flooded curb-ramp zones with an assumed standing water depth of `4–8 cm` alongside the tactile warning panel and pedestrian crosswalk signal pole[cite: 6].
  * **Proposed Temporary Dry Bypass:** Generates a highlighted green dry sidewalk bypass path engineered to a safe `~2.0° (3.5%)` grade around street obstacles (such as municipal trash bins and flooded gutters)[cite: 6].
  * **Synthetic Verification Goal:** Places an automated verification target zone on the upper sidewalk at `x > 4.0m, y > 0.25m`[cite: 6].
* **Live Curb Access Telemetry HUD:**
  * Continuously tracks and renders real-time agent physics metrics in the top-left overlay so both human analysts and the **Gemini 4 Argon Video Critic** can verify safe traversal frame-by-frame[cite: 5, 6]:
    * **Coordinates:** Real-time `Pos X`, `Pos Y`, and `Pos Z` tracking (confirming traversal from `Pos X: 1.43 m` to `6.43 m` and `Pos Y: 0.36 m`)[cite: 6].
    * **Incline & Stability:** Live `Slope / Tilt` (`1.51°` to `2.00°`) and peak `Max Tilt` (`2.00°`), ensuring the wheelchair agent never tips[cite: 6].
    * **Safety & Target Status:** Tracks `Collisions: 0`, `Elapsed` time (`s`), and dynamically flips the status badge from `BYPASS ACTIVE` (`Goal: FALSE`) to `GOAL REACHED` (`Goal: TRUE`) once the wheelchair agent crosses `x > 4.0m, y > 0.25m`[cite: 6].
* **Multi-Angle Interactive Camera Controls:**
  * **Photo Reference View:** Perspective aligned with the original street-level inspection photo, showing the standing water, tactile domes, and bypass route[cite: 6].
  * **Tracking View:** Third-person follow camera behind the wheelchair agent as it ascends the dry sidewalk grade[cite: 6].
  * **Overhead Plan View:** Top-down orthographic blueprint displaying spatial callouts for the Standing Water No-Go Zone, Proposed Temporary Bypass, and Synthetic Goal[cite: 6].

### 2. 3D Volumetric Road Crack & Pothole Analysis
For severe pavement failures and potholes, Gemini 4 Argon transforms raw street photos into a 3D topographic wireframe and thermal stress overlay[cite: 3]:
* **Automated Volumetric & Depth Telemetry:** Estimates structural parameters directly on the 3D mesh, including **Depth** (`14.2 cm`), **Volume** (`0.18 m³`), **Surface Area** (`1.2 m²`), and **Damage Severity** (`HIGH`).
* **Fracture Propagation Mapping:** Highlights radiating asphalt stress fractures and user reference scale markers to prioritize municipal crew dispatch.

---

## Start the backend

From the project folder:

1. Copy `setenv.bat.example` to `setenv.bat`.
2. Put your private FalkorDB values in the local `setenv.bat`.
3. Run it in the same Command Prompt session as the backend:

```bat
call setenv.bat
python backend_server.py
```

`setenv.bat` is ignored by Git. Never commit database credentials or paste them into this README.

Then open the HTML file in a browser.

The header displays the total number of page visits recorded by the backend. The count is stored locally in the ignored `page_visits.json` file and counts page loads, not unique people.

## What it records

When a user publishes an incident or dispatches a crew, the backend writes a graph relationship like:

- `(:Person)-[:PERFORMED]->(:Incident)`
- `(:Incident)-[:IN_DISTRICT]->(:District)`

This lets you later query who did what in the graph.

## Example queries

```cypher
MATCH (p:Person)-[r:PERFORMED]->(i:Incident)
RETURN p.name, r.action, i.ticketId, r.timestamp
ORDER BY r.timestamp DESC;

MATCH (p:Person)-[:PERFORMED]->(i:Incident)
WHERE p.name = 'Analyst'
RETURN p.name, i.ticketId, i.category, i.location;
```

## System Architecture & Track Alignment

```
┌────────────────────────────────────────────────────────────────────────────┐
│                   BASELINE: MLH (SF Civic Lens 2D App)                     │
│   • 3 SF Test Cases: 5th & Folsom Pothole, Mission ADA Ramp, SOMA Mattress │
│   • Single static photo -> 2D text triage summary                          │
└───────────────────┬────────────────────────────────────┬───────────────────┘
                    │                                    │
                    ▼                                    ▼
┌───────────────────────────────────────┐  ┌─────────────────────────────────┐
│ TRACK 1: MILLION TOKEN ENGINEERING    │  │ TRACK 2: MORE DIMENSIONS        │
│ • Argon (`gemini-4-argon`) ingests    │  │ • Argon generates complete      │
│   the entire repo AST in 1 pass       │  │   Three.js + Cannon-es 3D       │
│ • Streams up to 1M tokens of long     │  │   physics simulation of the SF  │
│   decode (`maxOutputTokens: 1048576`) │  │   intersection in a single pass │
│ • Upgrades 3 prototype files into a   │  │ • Headless Playwright records   │
│   35-file strongly-typed Open311 +    │  │   60fps `.webm` rollout of ADA  │
│   PostGIS + WCAG AAA municipal suite  │  │   wheelchair/vehicle traversal  │
│ • Automated benchmark harness proves  │  │ • Argon watches the video,      │
│   improvement over baseline           │  │   critiques physics/slope bugs, │
│                                       │  │   and patches the 3D scene loop │
└───────────────────────────────────────┘  └─────────────────────────────────┘
```
