#!/usr/bin/env node
/**
 * 新北市垃圾車即時查詢 Web App — Node.js / Express 版
 *
 * 用法：
 *   node garbage_truck.js          # 即時模式（需網路）
 *   node garbage_truck.js --demo   # 離線展示模式
 *
 * 開啟瀏覽器前往 http://localhost:5000
 */

const express = require("express");
const path    = require("path");

const app      = express();
const DEMO     = process.argv.includes("--demo");
const PORT     = 5000;

// ── Data sources ──────────────────────────────────────────────────────────────

const SCHEDULE_API =
  "https://data.ntpc.gov.tw/api/datasets/" +
  "edc3ad26-8ae7-4916-a00b-bc6048d19bf8/json?page=0&size=2000";

const REALTIME_API =
  "https://crd-rubbish.epd.ntpc.gov.tw/dispProject/api/carGps.ashx";

// ── Cache ─────────────────────────────────────────────────────────────────────

const SCHEDULE_TTL = 3_600_000;  // 1 hour
const REALTIME_TTL =    60_000;  // 1 minute

const cache = {
  schedule: [], scheduleTs: 0,
  realtime: [], realtimeTs: 0,
};

// ── Demo / fallback data ──────────────────────────────────────────────────────

const DEMO_SCHEDULE = [
  { district:"板橋區", stop:"縣民大道二段與文化路口",   lat:25.0138, lon:121.4607, weekdays:"一三五",       time:"19:10" },
  { district:"板橋區", stop:"文化路一段菜市場前",       lat:25.0151, lon:121.4631, weekdays:"一三五",       time:"19:20" },
  { district:"板橋區", stop:"南雅南路二段公園旁",       lat:25.0072, lon:121.4578, weekdays:"二四六",       time:"19:05" },
  { district:"板橋區", stop:"府中路捷運站2號出口",      lat:25.0103, lon:121.4638, weekdays:"一二三四五六", time:"18:50" },
  { district:"中和區", stop:"中和路與景平路口",         lat:24.9982, lon:121.4979, weekdays:"一三五",       time:"19:30" },
  { district:"中和區", stop:"景安路安邦街口",           lat:24.9951, lon:121.4994, weekdays:"二四六",       time:"19:15" },
  { district:"永和區", stop:"永和路二段保福路口",       lat:25.0129, lon:121.5172, weekdays:"一三五",       time:"19:40" },
  { district:"永和區", stop:"頂溪捷運站旁",             lat:25.0108, lon:121.5155, weekdays:"二四六",       time:"19:25" },
  { district:"新莊區", stop:"新莊路化成路口",           lat:25.0365, lon:121.4468, weekdays:"一三五",       time:"19:00" },
  { district:"新莊區", stop:"中正路思源路口",           lat:25.0347, lon:121.4492, weekdays:"二四六",       time:"18:55" },
  { district:"三重區", stop:"重新路五段與自強路口",     lat:25.0625, lon:121.4844, weekdays:"一三五",       time:"18:45" },
  { district:"三重區", stop:"三和路四段市場附近",       lat:25.0649, lon:121.4816, weekdays:"二四六",       time:"18:40" },
  { district:"土城區", stop:"金城路二段與學府路口",     lat:24.9778, lon:121.4412, weekdays:"一三五",       time:"19:50" },
  { district:"土城區", stop:"中央路二段社區活動中心",   lat:24.9801, lon:121.4445, weekdays:"二四六",       time:"19:45" },
  { district:"新店區", stop:"北新路三段碧潭橋頭",       lat:24.9669, lon:121.5412, weekdays:"一三五",       time:"19:20" },
  { district:"新店區", stop:"中正路光明街口",           lat:24.9688, lon:121.5389, weekdays:"二四六",       time:"19:10" },
  { district:"淡水區", stop:"中正路英專路口",           lat:25.1701, lon:121.4426, weekdays:"一三五",       time:"19:00" },
  { district:"淡水區", stop:"清水街傳統市場",           lat:25.1714, lon:121.4409, weekdays:"二四六",       time:"18:50" },
  { district:"汐止區", stop:"大同路一段與新台五路口",   lat:25.0628, lon:121.6601, weekdays:"一三五",       time:"19:30" },
  { district:"汐止區", stop:"中興路三段活動中心",       lat:25.0647, lon:121.6572, weekdays:"二四六",       time:"19:20" },
  { district:"蘆洲區", stop:"長安街與中正路口",         lat:25.0840, lon:121.4714, weekdays:"一三五",       time:"18:55" },
  { district:"蘆洲區", stop:"光榮路仁愛路口",           lat:25.0852, lon:121.4739, weekdays:"二四六",       time:"18:45" },
];

const DEMO_REALTIME = [
  { route:"板橋01", lat:25.0145, lon:121.4615, status:"行駛中", updated:"3 分鐘前" },
  { route:"中和02", lat:24.9960, lon:121.4985, status:"停車中", updated:"1 分鐘前" },
  { route:"新莊01", lat:25.0356, lon:121.4478, status:"行駛中", updated:"2 分鐘前" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Haversine distance in metres. */
function haversine(lat1, lon1, lat2, lon2) {
  const R  = 6_371_000;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const dφ = (lat2 - lat1) * Math.PI / 180;
  const dλ = (lon2 - lon1) * Math.PI / 180;
  const a  = Math.sin(dφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(dλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Today's weekday as Chinese character: 一二三四五六日 */
function todayWeekdayZh() {
  const day = new Date().getDay();           // 0=Sunday
  return "日一二三四五六"[day];
}

/** Minutes from now until HH:MM (negative = already past). */
function minutesUntil(timeStr) {
  const [h, m]  = timeStr.split(":").map(Number);
  const now     = new Date();
  const target  = new Date(now);
  target.setHours(h, m, 0, 0);
  return Math.round((target - now) / 60_000);
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchSchedule() {
  if (DEMO) return DEMO_SCHEDULE;
  const now = Date.now();
  if (now - cache.scheduleTs < SCHEDULE_TTL && cache.schedule.length) {
    return cache.schedule;
  }
  try {
    const res = await fetch(SCHEDULE_API, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const stops = raw.flatMap(r => {
      const lat = parseFloat(r["緯度"] ?? r.lat ?? 0);
      const lon = parseFloat(r["經度"] ?? r.lon ?? 0);
      if (!lat || !lon) return [];
      return [{
        district: r["行政區"] ?? "",
        stop:     r["地點名稱"] ?? r["清運地點"] ?? "",
        lat, lon,
        weekdays: r["星期"] ?? "一二三四五六",
        time:     r["清運時間"] ?? r["到點時間"] ?? "",
      }];
    });
    cache.schedule   = stops;
    cache.scheduleTs = now;
    return stops;
  } catch (err) {
    console.warn(`[schedule] API 失敗 (${err.message})，改用示範資料`);
    return DEMO_SCHEDULE;
  }
}

async function fetchRealtime() {
  if (DEMO) return DEMO_REALTIME;
  const now = Date.now();
  if (now - cache.realtimeTs < REALTIME_TTL && cache.realtime.length) {
    return cache.realtime;
  }
  try {
    const res = await fetch(REALTIME_API, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    const trucks = raw.flatMap(r => {
      const lat = parseFloat(r.lat ?? r["緯度"] ?? 0);
      const lon = parseFloat(r.lon ?? r["經度"] ?? 0);
      if (!lat || !lon) return [];
      return [{
        route:   r.lineName ?? r["路線"] ?? "",
        lat, lon,
        status:  r.status   ?? r["狀態"] ?? "",
        updated: r.updateTime ?? "",
      }];
    });
    cache.realtime   = trucks;
    cache.realtimeTs = now;
    return trucks;
  } catch (err) {
    console.warn(`[realtime] API 失敗 (${err.message})，改用示範資料`);
    return DEMO_REALTIME;
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "templates", "index.html"));
});

app.get("/api/nearest", async (req, res) => {
  const userLat = parseFloat(req.query.lat);
  const userLon = parseFloat(req.query.lon);
  if (isNaN(userLat) || isNaN(userLon)) {
    return res.status(400).json({ error: "需要 lat 和 lon 參數" });
  }

  const today    = todayWeekdayZh();
  const schedule = await fetchSchedule();
  const realtime = await fetchRealtime();

  // Upcoming stops: today's weekday, within next 5 hours, not past >10 min
  const upcoming = schedule
    .filter(s => s.weekdays.includes(today) && s.time)
    .flatMap(s => {
      const mins = minutesUntil(s.time);
      if (mins < -10 || mins > 300) return [];
      return [{ ...s, distance_m: Math.round(haversine(userLat, userLon, s.lat, s.lon)), minutes_until: mins }];
    })
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, 10);

  // Real-time trucks within 2 km
  const nearbyTrucks = realtime
    .flatMap(t => {
      const dist = haversine(userLat, userLon, t.lat, t.lon);
      if (dist > 2000) return [];
      return [{ ...t, distance_m: Math.round(dist) }];
    })
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, 5);

  res.json({
    today,
    now:           new Date().toLocaleTimeString("zh-TW", { hour:"2-digit", minute:"2-digit" }),
    demo:          DEMO || cache.scheduleTs === 0,
    nearest_stops: upcoming,
    nearby_trucks: nearbyTrucks,
  });
});

app.get("/api/all_stops", async (req, res) => {
  const userLat = parseFloat(req.query.lat ?? 25.014);
  const userLon = parseFloat(req.query.lon ?? 121.463);

  const today    = todayWeekdayZh();
  const schedule = await fetchSchedule();

  const stops = schedule
    .filter(s => s.weekdays.includes(today))
    .flatMap(s => {
      const dist = haversine(userLat, userLon, s.lat, s.lon);
      if (dist > 5000) return [];
      return [{ ...s, distance_m: Math.round(dist), minutes_until: minutesUntil(s.time ?? "00:00") }];
    })
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, 50);

  res.json({ stops, trucks: await fetchRealtime() });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, "0.0.0.0", () => {
  console.log("\n新北市垃圾車查詢系統啟動中…");
  if (DEMO) console.log("⚠  離線展示模式（使用示範資料）");
  console.log(`請開啟瀏覽器前往 http://localhost:${PORT}\n`);
});
