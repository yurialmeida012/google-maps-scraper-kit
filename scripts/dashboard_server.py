#!/usr/bin/env python3
"""
Dashboard Server - Vale Leads TV
Local web server serving the interactive map and leads management UI.
Runs with Python standard library only (no pip dependencies required).
"""
import csv
import datetime
import http.server
import json
import os
import random
import re
import socketserver
import subprocess
import sys
import urllib.parse
import urllib.request
import webbrowser

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(BASE_DIR, "web")
CONFIG_DIR = os.path.join(BASE_DIR, "config")
LEADS_DIR = os.path.join(BASE_DIR, "leads_vale")
SCRIPTS_DIR = os.path.join(BASE_DIR, "scripts")

PORT = 5000


def check_engine_health():
    """Check if the local scraper engine at http://localhost:8080 is alive."""
    port = os.environ.get("SCRAPER_PORT", "8080")
    base = os.environ.get("SCRAPER_BASE_URL", f"http://localhost:{port}")
    try:
        req = urllib.request.Request(f"{base}/api/v1/jobs", headers={"User-Agent": "ValeLeadsDashboard/1.0"})
        with urllib.request.urlopen(req, timeout=1.5) as res:
            return res.status in (200, 204)
    except Exception:
        return False


def load_config():
    """Load cities and niches JSON configurations."""
    cities_file = os.path.join(CONFIG_DIR, "vale_paraiba.json")
    niches_file = os.path.join(CONFIG_DIR, "nichos_anunciantes_tv.json")
    
    cities_data = []
    niches_data = []

    if os.path.exists(cities_file):
        try:
            with open(cities_file, "r", encoding="utf-8") as f:
                cities_data = json.load(f).get("cidades", [])
        except Exception as e:
            print(f"Erro ao ler cidades: {e}")

    if os.path.exists(niches_file):
        try:
            with open(niches_file, "r", encoding="utf-8") as f:
                niches_data = json.load(f).get("categorias", [])
        except Exception as e:
            print(f"Erro ao ler nichos: {e}")

    return cities_data, niches_data


def get_google_maps_api_key():
    """Retrieve Google Maps API Key from env or .env file."""
    env_file = os.path.join(BASE_DIR, ".env")
    key = os.environ.get("GOOGLE_MAPS_API_KEY", "")
    if not key and os.path.exists(env_file):
        try:
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    if line.startswith("GOOGLE_MAPS_API_KEY="):
                        key = line.split("=", 1)[1].strip().strip("\"'")
                        break
        except Exception:
            pass
    return key


class DashboardHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/status":
            self.handle_api_status()
        elif path == "/api/config":
            self.handle_api_config()
        elif path == "/api/files":
            self.handle_api_files()
        elif path == "/api/leads":
            self.handle_api_leads(parsed.query)
        else:
            # Serve static files from web/
            super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/scrape":
            self.handle_api_scrape()
        else:
            self.send_error(404, "Endpoint not found")

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def handle_api_status(self):
        engine_online = check_engine_health()
        self.send_json({
            "engine_online": engine_online,
            "leads_count": len(os.listdir(LEADS_DIR)) if os.path.exists(LEADS_DIR) else 0
        })

    def handle_api_config(self):
        cities, niches = load_config()
        self.send_json({
            "cities": cities,
            "niches": niches,
            "google_maps_api_key": get_google_maps_api_key()
        })

    def handle_api_files(self):
        os.makedirs(LEADS_DIR, exist_ok=True)
        files = []
        for fn in os.listdir(LEADS_DIR):
            if fn.lower().endswith(".csv"):
                fp = os.path.join(LEADS_DIR, fn)
                count = 0
                try:
                    with open(fp, "r", encoding="utf-8-sig") as f:
                        count = max(0, sum(1 for _ in f) - 1)
                except Exception:
                    pass
                
                # Friendly label
                clean_name = fn.replace(".csv", "").replace("leads_", "")
                parts = clean_name.split("_")
                city_id = parts[0].upper() if len(parts) > 0 else "VALE"
                niche = " ".join(parts[1:-2]).capitalize() if len(parts) > 3 else clean_name
                label = f"{city_id} • {niche}" if niche else fn

                files.append({
                    "filename": fn,
                    "label": label,
                    "count": count,
                    "mtime": os.path.getmtime(fp)
                })

        # Sort newest first
        files.sort(key=lambda x: x["mtime"], reverse=True)
        self.send_json({"files": files})

    def handle_api_leads(self, query_string):
        params = urllib.parse.parse_qs(query_string)
        filename = params.get("file", [""])[0]

        if not filename:
            self.send_json({"leads": [], "total": 0})
            return

        fp = os.path.join(LEADS_DIR, os.path.basename(filename))
        if not os.path.exists(fp):
            self.send_json({"error": "File not found", "leads": []}, status=404)
            return

        leads = []
        cities, _ = load_config()
        # Default coords if missing
        default_lat, default_lon = -23.1896, -45.8841
        for c in cities:
            if c.get("id") in filename.lower():
                try:
                    default_lat = float(c.get("lat", default_lat))
                    default_lon = float(c.get("lon", default_lon))
                except ValueError:
                    pass
                break

        try:
            with open(fp, "r", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    lat_str = row.get("latitude", "").strip()
                    lon_str = row.get("longitude", "").strip()

                    try:
                        lat = float(lat_str)
                        lon = float(lon_str)
                    except (ValueError, TypeError):
                        # Add slight jitter around city center so pins don't overlap exactly
                        lat = default_lat + random.uniform(-0.02, 0.02)
                        lon = default_lon + random.uniform(-0.02, 0.02)

                    row["latitude"] = str(lat)
                    row["longitude"] = str(lon)
                    leads.append(row)
        except Exception as e:
            self.send_json({"error": str(e), "leads": []}, status=500)
            return

        self.send_json({"leads": leads, "total": len(leads)})

    def handle_api_scrape(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body_data = json.loads(self.rfile.read(content_length).decode("utf-8"))
        except Exception as e:
            self.send_json({"ok": False, "message": f"Invalid JSON: {e}"}, status=400)
            return

        city_id = body_data.get("city", "sjc")
        niche_id = body_data.get("niche", "automotivo")
        custom_query = body_data.get("customQuery", "").strip()
        depth = int(body_data.get("depth", 3))
        socials = bool(body_data.get("socials", True))

        # Check if engine is running first
        if not check_engine_health():
            self.send_json({
                "ok": False,
                "message": "O motor local (http://localhost:8080) está offline. Inicie o Docker Desktop ou o executável do scraper primeiro."
            })
            return

        cmd = [
            sys.executable,
            os.path.join(SCRIPTS_DIR, "prospectar_vale.py"),
            "--cidade", city_id,
            "--depth", str(depth)
        ]

        if custom_query:
            cmd.extend(["--query", custom_query])
        else:
            cmd.extend(["--nicho", niche_id])

        if socials:
            cmd.append("--socials")

        try:
            # Run scraper
            res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
            
            # Find newest file created in leads_vale
            csv_files = [os.path.join(LEADS_DIR, f) for f in os.listdir(LEADS_DIR) if f.endswith(".csv")]
            newest_file = max(csv_files, key=os.path.getmtime) if csv_files else ""
            filename = os.path.basename(newest_file)

            count = 0
            if newest_file and os.path.exists(newest_file):
                with open(newest_file, "r", encoding="utf-8-sig") as f:
                    count = max(0, sum(1 for _ in f) - 1)

            if res.returncode == 0:
                self.send_json({
                    "ok": True,
                    "filename": filename,
                    "count": count,
                    "output": res.stdout
                })
            else:
                self.send_json({
                    "ok": False,
                    "message": f"Erro na execução (código {res.returncode}): {res.stderr or res.stdout}"
                })
        except Exception as e:
            self.send_json({"ok": False, "message": str(e)}, status=500)


def start_server():
    os.chdir(BASE_DIR)
    handler = DashboardHandler
    
    # Try preferred port, fallback to next available
    port = PORT
    for try_port in [5000, 5050, 8500, 8585]:
        try:
            httpd = socketserver.TCPServer(("127.0.0.1", try_port), handler)
            port = try_port
            break
        except OSError:
            continue

    url = f"http://localhost:{port}"
    print("=" * 72)
    print(" 🚀  PAINEL VALE LEADS TV - SERVIDOR WEB INICIADO")
    print(f"     Acesse no seu navegador: {url}")
    print("     Pressione Ctrl+C para encerrar o servidor.")
    print("=" * 72)

    # Open browser automatically if interactive
    try:
        if sys.stdin and hasattr(sys.stdin, "isatty") and sys.stdin.isatty():
            webbrowser.open(url)
    except Exception:
        pass

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor finalizado pelo usuário.")
        httpd.server_close()


if __name__ == "__main__":
    start_server()
