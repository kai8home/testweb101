#!/usr/bin/env python3
"""新北市垃圾車即時查詢 Web App

Usage:
    python3 garbage_truck.py [--demo]

Open http://localhost:5000 in your browser.
"""

import json
import sys
import threading
import time
from datetime import datetime, timedelta
from math import radians, sin, cos, sqrt, atan2

import requests
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

# ── Data sources ──────────────────────────────────────────────────────────────

# New Taipei City open data: garbage truck route schedule with GPS coordinates
SCHEDULE_API = (
    "https://data.ntpc.gov.tw/api/datasets/"
    "edc3ad26-8ae7-4916-a00b-bc6048d19bf8/json?page=0&size=2000"
)

# Real-time GPS tracking (line-level position)
REALTIME_API = "https://crd-rubbish.epd.ntpc.gov.tw/dispProject/api/carGps.ashx"
LINES_API = "https://crd-rubbish.epd.ntpc.gov.tw/dispProject/api/line-list.ashx"

# ── Cache ─────────────────────────────────────────────────────────────────────

_cache = {
    "schedule": [],
    "realtime": [],
    "schedule_ts": 0,
    "realtime_ts": 0,
}
SCHEDULE_TTL = 3600   # refresh static schedule every hour
REALTIME_TTL = 60     # refresh GPS positions every minute
DEMO_MODE = "--demo" in sys.argv

# ── Sample data (offline / demo fallback) ─────────────────────────────────────

DEMO_SCHEDULE = [
    {"district":"板橋區","stop":"縣民大道二段與文化路口","lat":25.0138,"lon":121.4607,"weekdays":"一三五","time":"19:10"},
    {"district":"板橋區","stop":"文化路一段菜市場前","lat":25.0151,"lon":121.4631,"weekdays":"一三五","time":"19:20"},
    {"district":"板橋區","stop":"南雅南路二段公園旁","lat":25.0072,"lon":121.4578,"weekdays":"二四六","time":"19:05"},
    {"district":"板橋區","stop":"府中路捷運站2號出口","lat":25.0103,"lon":121.4638,"weekdays":"一二三四五六","time":"18:50"},
    {"district":"中和區","stop":"中和路與景平路口","lat":24.9982,"lon":121.4979,"weekdays":"一三五","time":"19:30"},
    {"district":"中和區","stop":"景安路安邦街口","lat":24.9951,"lon":121.4994,"weekdays":"二四六","time":"19:15"},
    {"district":"永和區","stop":"永和路二段保福路口","lat":25.0129,"lon":121.5172,"weekdays":"一三五","time":"19:40"},
    {"district":"永和區","stop":"頂溪捷運站旁","lat":25.0108,"lon":121.5155,"weekdays":"二四六","time":"19:25"},
    {"district":"新莊區","stop":"新莊路化成路口","lat":25.0365,"lon":121.4468,"weekdays":"一三五","time":"19:00"},
    {"district":"新莊區","stop":"中正路思源路口","lat":25.0347,"lon":121.4492,"weekdays":"二四六","time":"18:55"},
    {"district":"三重區","stop":"重新路五段與自強路口","lat":25.0625,"lon":121.4844,"weekdays":"一三五","time":"18:45"},
    {"district":"三重區","stop":"三和路四段市場附近","lat":25.0649,"lon":121.4816,"weekdays":"二四六","time":"18:40"},
    {"district":"土城區","stop":"金城路二段與學府路口","lat":24.9778,"lon":121.4412,"weekdays":"一三五","time":"19:50"},
    {"district":"土城區","stop":"中央路二段社區活動中心","lat":24.9801,"lon":121.4445,"weekdays":"二四六","time":"19:45"},
    {"district":"新店區","stop":"北新路三段碧潭橋頭","lat":24.9669,"lon":121.5412,"weekdays":"一三五","time":"19:20"},
    {"district":"新店區","stop":"中正路光明街口","lat":24.9688,"lon":121.5389,"weekdays":"二四六","time":"19:10"},
    {"district":"淡水區","stop":"中正路英專路口","lat":25.1701,"lon":121.4426,"weekdays":"一三五","time":"19:00"},
    {"district":"淡水區","stop":"清水街傳統市場","lat":25.1714,"lon":121.4409,"weekdays":"二四六","time":"18:50"},
    {"district":"汐止區","stop":"大同路一段與新台五路口","lat":25.0628,"lon":121.6601,"weekdays":"一三五","time":"19:30"},
    {"district":"汐止區","stop":"中興路三段活動中心","lat":25.0647,"lon":121.6572,"weekdays":"二四六","time":"19:20"},
    {"district":"蘆洲區","stop":"長安街與中正路口","lat":25.0840,"lon":121.4714,"weekdays":"一三五","time":"18:55"},
    {"district":"蘆洲區","stop":"光榮路仁愛路口","lat":25.0852,"lon":121.4739,"weekdays":"二四六","time":"18:45"},
]

DEMO_REALTIME = [
    {"route":"板橋01","lat":25.0145,"lon":121.4615,"status":"行駛中","updated":"3 分鐘前"},
    {"route":"中和02","lat":24.9960,"lon":121.4985,"status":"停車中","updated":"1 分鐘前"},
    {"route":"新莊01","lat":25.0356,"lon":121.4478,"status":"行駛中","updated":"2 分鐘前"},
]

# ── Helpers ───────────────────────────────────────────────────────────────────

def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return distance in metres between two GPS points."""
    R = 6_371_000
    φ1, φ2 = radians(lat1), radians(lat2)
    dφ = radians(lat2 - lat1)
    dλ = radians(lon2 - lon1)
    a = sin(dφ / 2) ** 2 + cos(φ1) * cos(φ2) * sin(dλ / 2) ** 2
    return R * 2 * atan2(sqrt(a), sqrt(1 - a))


def today_weekday_zh() -> str:
    """Return today's weekday in Chinese: 一二三四五六日."""
    return "一二三四五六日"[datetime.now().weekday()]


def minutes_until(time_str: str) -> int:
    """Return minutes from now until HH:MM. Negative if already past."""
    now = datetime.now()
    t = datetime.strptime(time_str, "%H:%M").replace(
        year=now.year, month=now.month, day=now.day
    )
    return int((t - now).total_seconds() / 60)

# ── Data fetching ─────────────────────────────────────────────────────────────

def fetch_schedule() -> list[dict]:
    if DEMO_MODE:
        return DEMO_SCHEDULE
    now = time.time()
    if now - _cache["schedule_ts"] < SCHEDULE_TTL and _cache["schedule"]:
        return _cache["schedule"]
    try:
        resp = requests.get(SCHEDULE_API, timeout=10)
        resp.raise_for_status()
        raw = resp.json()
        stops = []
        for r in raw:
            lat = float(r.get("緯度") or r.get("lat") or 0)
            lon = float(r.get("經度") or r.get("lon") or 0)
            if not lat or not lon:
                continue
            stops.append({
                "district": r.get("行政區", ""),
                "stop": r.get("地點名稱") or r.get("清運地點", ""),
                "lat": lat,
                "lon": lon,
                "weekdays": r.get("星期", "一二三四五六"),
                "time": r.get("清運時間") or r.get("到點時間", ""),
            })
        _cache["schedule"] = stops
        _cache["schedule_ts"] = now
        return stops
    except Exception as e:
        app.logger.warning(f"Schedule API failed: {e}; using demo data")
        return DEMO_SCHEDULE


def fetch_realtime() -> list[dict]:
    if DEMO_MODE:
        return DEMO_REALTIME
    now = time.time()
    if now - _cache["realtime_ts"] < REALTIME_TTL and _cache["realtime"]:
        return _cache["realtime"]
    try:
        resp = requests.get(REALTIME_API, timeout=8)
        resp.raise_for_status()
        raw = resp.json()
        trucks = []
        for r in raw:
            lat = float(r.get("lat") or r.get("緯度") or 0)
            lon = float(r.get("lon") or r.get("經度") or 0)
            if not lat or not lon:
                continue
            trucks.append({
                "route": r.get("lineName") or r.get("路線", ""),
                "lat": lat,
                "lon": lon,
                "status": r.get("status") or r.get("狀態", ""),
                "updated": r.get("updateTime", ""),
            })
        _cache["realtime"] = trucks
        _cache["realtime_ts"] = now
        return trucks
    except Exception as e:
        app.logger.warning(f"Realtime API failed: {e}; using demo data")
        return DEMO_REALTIME

# ── API routes ────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/nearest")
def api_nearest():
    try:
        user_lat = float(request.args["lat"])
        user_lon = float(request.args["lon"])
    except (KeyError, ValueError):
        return jsonify({"error": "需要 lat 和 lon 參數"}), 400

    today = today_weekday_zh()
    schedule = fetch_schedule()
    realtime = fetch_realtime()

    # Filter schedule: only stops serving today, with time in next 3 hours
    upcoming = []
    for s in schedule:
        if today not in s.get("weekdays", ""):
            continue
        t = s.get("time", "")
        if not t:
            continue
        mins = minutes_until(t)
        if mins < -10 or mins > 300:   # ignore past or >5h away
            continue
        dist = haversine(user_lat, user_lon, s["lat"], s["lon"])
        upcoming.append({**s, "distance_m": round(dist), "minutes_until": mins})

    upcoming.sort(key=lambda x: x["distance_m"])
    nearest_stops = upcoming[:10]

    # Real-time trucks: find those within 2 km
    nearby_trucks = []
    for t in realtime:
        dist = haversine(user_lat, user_lon, t["lat"], t["lon"])
        if dist <= 2000:
            nearby_trucks.append({**t, "distance_m": round(dist)})
    nearby_trucks.sort(key=lambda x: x["distance_m"])

    return jsonify({
        "today": today,
        "now": datetime.now().strftime("%H:%M"),
        "demo": DEMO_MODE or _cache["schedule_ts"] == 0,
        "nearest_stops": nearest_stops,
        "nearby_trucks": nearby_trucks[:5],
    })


@app.route("/api/all_stops")
def api_all_stops():
    """Return all of today's stops (for map rendering)."""
    try:
        user_lat = float(request.args.get("lat", 25.014))
        user_lon = float(request.args.get("lon", 121.463))
    except ValueError:
        user_lat, user_lon = 25.014, 121.463

    today = today_weekday_zh()
    schedule = fetch_schedule()
    stops = []
    for s in schedule:
        if today not in s.get("weekdays", ""):
            continue
        dist = haversine(user_lat, user_lon, s["lat"], s["lon"])
        if dist > 5000:
            continue
        mins = minutes_until(s.get("time", "00:00"))
        stops.append({**s, "distance_m": round(dist), "minutes_until": mins})
    stops.sort(key=lambda x: x["distance_m"])
    return jsonify({"stops": stops[:50], "trucks": fetch_realtime()})


if __name__ == "__main__":
    port = 5000
    print(f"\n新北市垃圾車查詢系統啟動中…")
    if DEMO_MODE:
        print("⚠  離線展示模式（使用示範資料）")
    print(f"請開啟瀏覽器前往 http://localhost:{port}\n")
    app.run(host="0.0.0.0", port=port, debug=False)
