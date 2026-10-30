import json
import os
import threading
from datetime import datetime, timezone

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
from falkordb import FalkorDB

app = Flask(__name__)\napp.config["MAX_CONTENT_LENGTH"] = 32 * 1024
CORS(app, resources={r"/api/*": {"origins": os.getenv("CORS_ALLOWED_ORIGIN", "http://127.0.0.1:5173").split(",")}})

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

GRAPH_NAME = os.getenv("FALKORDB_GRAPH", "sf_civic_lens")
BACKEND_PORT = int(os.getenv("FALKORDB_BACKEND_PORT", "5001"))
VISIT_COUNT_FILE = os.path.join(BASE_DIR, "page_visits.json")
VISIT_COUNT_LOCK = threading.Lock()


def cypher_string(value):
    if value is None:
        return "''"
    return "'" + str(value).replace("\\", "\\\\").replace("'", "\\'") + "'"


def get_db():
    host = os.getenv("FALKORDB_HOST")
    username = os.getenv("FALKORDB_USERNAME")
    password = os.getenv("FALKORDB_PASSWORD")

    if not host:
        raise RuntimeError(
            "FALKORDB_HOST is not set. Use setenv.bat or export the FalkorDB variables before starting this backend."
        )

    return FalkorDB(
        host=host,
        port=int(os.getenv("FALKORDB_PORT", "6379")),
        username=username,
        password=password,
        ssl=os.getenv("FALKORDB_SSL", "true").lower() == "true",
    )


def get_graph():
    db = get_db()
    return db.select_graph(GRAPH_NAME)


def record_page_visit():
    with VISIT_COUNT_LOCK:
        try:
            with open(VISIT_COUNT_FILE, "r", encoding="utf-8") as visits_file:
                visit_count = int(json.load(visits_file).get("count", 0))
        except (FileNotFoundError, ValueError, TypeError, json.JSONDecodeError):
            visit_count = 0

        visit_count += 1
        with open(VISIT_COUNT_FILE, "w", encoding="utf-8") as visits_file:
            json.dump({"count": visit_count}, visits_file)

        return visit_count


def record_action(payload):
    actor_name = (payload.get("actorName") or "Anonymous User").strip() or "Anonymous User"
    actor_role = (payload.get("actorRole") or "Analyst").strip() or "Analyst"
    action = (payload.get("action") or "viewed").strip() or "viewed"
    ticket_id = (payload.get("ticketId") or f"ticket-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}").strip()
    category = payload.get("category") or "Unknown"
    location = payload.get("location") or "Unknown location"
    district = payload.get("district") or "Unknown district"
    severity = payload.get("severity") or "UNKNOWN"
    agency = payload.get("agency") or "Unassigned"
    summary = payload.get("summary") or payload.get("details") or f"{actor_name} performed {action}."
    timestamp = datetime.now(timezone.utc).isoformat()

    graph = get_graph()

    query = f"""
    MERGE (p:Person {{name: {cypher_string(actor_name)}}})
    SET p.role = {cypher_string(actor_role)},
        p.lastSeen = {cypher_string(timestamp)}

    MERGE (d:District {{name: {cypher_string(district)}}})
    MERGE (i:Incident {{ticketId: {cypher_string(ticket_id)}}})
    SET i.category = {cypher_string(category)},
        i.location = {cypher_string(location)},
        i.district = {cypher_string(district)},
        i.severity = {cypher_string(severity)},
        i.agency = {cypher_string(agency)},
        i.summary = {cypher_string(summary)},
        i.lastUpdated = {cypher_string(timestamp)}

    MERGE (i)-[:IN_DISTRICT]->(d)
    MERGE (p)-[r:PERFORMED {{action: {cypher_string(action)}, timestamp: {cypher_string(timestamp)}, details: {cypher_string(summary)}}}]->(i)
    """

    graph.query(query)
    return {
        "ok": True,
        "actor": actor_name,
        "action": action,
        "ticketId": ticket_id,
        "timestamp": timestamp,
    }


@app.get("/")
def index_page():
    html_path = os.path.join(BASE_DIR, "sf_civic_lens_web_application.html")
    if os.path.exists(html_path):
        return send_file(html_path, mimetype="text/html")
    return jsonify({"ok": False, "error": "Frontend HTML file not found."}), 404


@app.get("/api/visits")
def page_visit():
    return jsonify({"ok": True, "count": record_page_visit()})


@app.get("/<path:filename>")
def serve_asset(filename):
    safe_exts = (".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif", ".ico")
    if not filename.lower().endswith(safe_exts):
        return jsonify({"ok": False, "error": "File not found."}), 404

    file_path = os.path.realpath(os.path.join(BASE_DIR, filename))\n    if os.path.commonpath([BASE_DIR, file_path]) != BASE_DIR:\n        return jsonify({"ok": False, "error": "File not found."}), 404
    if os.path.exists(file_path) and os.path.isfile(file_path):
        return send_file(file_path)

    return jsonify({"ok": False, "error": "File not found."}), 404


@app.get("/api/health")
def health_check():
    try:
        get_db()
        return jsonify({"ok": True, "status": "healthy", "graph": GRAPH_NAME})
    except Exception as exc:  # pragma: no cover - depends on env
        return jsonify({"ok": False, "status": "not-configured", "error": str(exc)}), 503


@app.post("/api/actions")
def create_action():
    if not request.is_json:\n        return jsonify({"ok": False, "error": "JSON body required"}), 415\n    payload = request.get_json(silent=True)\n    if not isinstance(payload, dict):\n        return jsonify({"ok": False, "error": "JSON object required"}), 400\n    token = os.getenv("CIVIC_ACTION_API_TOKEN")\n    if not token or not __import__("hmac").compare_digest(request.headers.get("X-Action-Token", ""), token):\n        return jsonify({"ok": False, "error": "Unauthorized"}), 401\n    if any(not isinstance(v, str) or len(v) > 2000 for v in payload.values()):\n        return jsonify({"ok": False, "error": "Invalid field value"}), 400

    try:
        result = record_action(payload)
        return jsonify(result)
    except Exception as exc:  # pragma: no cover - depends on runtime DB connectivity
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.get("/api/actions")
def list_actions():
    token = os.getenv("CIVIC_ACTION_API_TOKEN")\n    if not token or not __import__("hmac").compare_digest(request.headers.get("X-Action-Token", ""), token):\n        return jsonify({"ok": False, "error": "Unauthorized"}), 401\n    ticket_id = request.args.get("ticketId")
    try:
        graph = get_graph()
        if ticket_id:
            query = f"""
            MATCH (p:Person)-[r:PERFORMED]->(i:Incident)
            WHERE i.ticketId = {cypher_string(ticket_id)}
            RETURN p.name, p.role, r.action, r.timestamp, i.ticketId, i.category, i.location, i.district
            ORDER BY r.timestamp DESC
            """
        else:
            query = """
            MATCH (p:Person)-[r:PERFORMED]->(i:Incident)
            RETURN p.name, p.role, r.action, r.timestamp, i.ticketId, i.category, i.location, i.district
            ORDER BY r.timestamp DESC
            LIMIT 50
            """

        result = graph.query(query)
        rows = []
        for row in result.result_set:
            rows.append({
                "actorName": row[0],
                "actorRole": row[1],
                "action": row[2],
                "timestamp": row[3],
                "ticketId": row[4],
                "category": row[5],
                "location": row[6],
                "district": row[7],
            })
        return jsonify({"ok": True, "actions": rows})
    except Exception as exc:  # pragma: no cover - depends on runtime DB connectivity
        return jsonify({"ok": False, "error": str(exc)}), 500


if __name__ == "__main__":
    app.run(host=os.getenv("FLASK_HOST", "127.0.0.1"), port=BACKEND_PORT, debug=False)
