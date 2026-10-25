# SF Civic Lens + Gemini Argon + FalkorDB

This project includes a static frontend at `sf_civic_lens_web_application.html` and a small Flask backend at `backend_server.py`.

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
