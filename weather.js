#!/usr/bin/env node
/**
 * 天氣預報查詢工具 — 使用 Open-Meteo API（免費，無需 API Key）
 *
 * 用法：
 *   node weather.js [城市名稱]   # 即時查詢（需網路）
 *   node weather.js --demo       # 離線展示模式
 *
 * 範例：
 *   node weather.js 台北
 *   node weather.js Tokyo
 *   node weather.js London
 */

const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL  = "https://api.open-meteo.com/v1/forecast";

const WMO_CODES = {
  0: "晴天",       1: "大致晴天",    2: "部分多雲",    3: "陰天",
  45: "霧",        48: "結冰霧",
  51: "毛毛雨(輕)", 53: "毛毛雨(中)", 55: "毛毛雨(重)",
  61: "小雨",      63: "中雨",       65: "大雨",
  71: "小雪",      73: "中雪",       75: "大雪",       77: "雪粒",
  80: "陣雨(輕)",  81: "陣雨(中)",   82: "陣雨(強)",
  85: "陣雪(輕)",  86: "陣雪(重)",
  95: "雷陣雨",    96: "雷陣雨夾冰雹", 99: "強雷陣雨夾冰雹",
};

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchJSON(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

function describeWeather(code) {
  return WMO_CODES[code] ?? `代碼${code}`;
}

/** Right-pad a string to `len` terminal columns (CJK chars count as 2). */
function padEnd(str, len) {
  let cols = 0;
  for (const ch of str) cols += ch.codePointAt(0) > 0x7f ? 2 : 1;
  return str + " ".repeat(Math.max(0, len - cols));
}

function rpad(n, width, decimals = 1) {
  return n.toFixed(decimals).padStart(width);
}

// ── API calls ─────────────────────────────────────────────────────────────────

async function geocode(city) {
  const url = new URL(GEOCODING_URL);
  url.searchParams.set("name", city);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "zh");
  url.searchParams.set("format", "json");

  const data = await fetchJSON(url.toString());
  const results = data.results;
  if (!results || results.length === 0) throw new Error(`找不到城市：${city}`);
  const r = results[0];
  return { lat: r.latitude, lon: r.longitude, name: r.name ?? city };
}

async function getForecast(lat, lon) {
  const url = new URL(FORECAST_URL);
  const daily = [
    "weather_code",
    "temperature_2m_max",
    "temperature_2m_min",
    "precipitation_sum",
    "windspeed_10m_max",
  ];
  const current = [
    "temperature_2m",
    "relative_humidity_2m",
    "weather_code",
    "windspeed_10m",
    "apparent_temperature",
  ];
  url.searchParams.set("latitude",     lat);
  url.searchParams.set("longitude",    lon);
  url.searchParams.set("daily",        daily.join(","));
  url.searchParams.set("current",      current.join(","));
  url.searchParams.set("timezone",     "auto");
  url.searchParams.set("forecast_days","7");
  return fetchJSON(url.toString());
}

// ── Demo data ─────────────────────────────────────────────────────────────────

function demoData() {
  const today = new Date();
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
  return {
    cityName: "台北 (示範資料)",
    data: {
      timezone: "Asia/Taipei",
      current: {
        temperature_2m:       28.4,
        apparent_temperature: 32.1,
        relative_humidity_2m: 78,
        weather_code:         2,
        windspeed_10m:        14.5,
      },
      daily: {
        time:                dates,
        weather_code:        [2, 61, 63, 80, 1, 0, 3],
        temperature_2m_max:  [31.2, 27.5, 25.8, 26.3, 30.1, 32.4, 29.7],
        temperature_2m_min:  [24.6, 22.1, 21.3, 22.0, 23.5, 25.2, 23.8],
        precipitation_sum:   [0.0,  8.2,  15.4,  5.1,  0.0,  0.0,  0.3],
        windspeed_10m_max:   [18.2, 22.7, 28.4, 19.6, 15.3, 12.1, 16.8],
      },
    },
  };
}

// ── Display ───────────────────────────────────────────────────────────────────

function display(cityName, data) {
  const { current, daily } = data;
  const tz = data.timezone ?? "";

  console.log();
  console.log("=".repeat(56));
  console.log(`  ${cityName} 天氣預報   (${tz})`);
  console.log("=".repeat(56));

  console.log("\n【目前天氣】");
  console.log(`  狀況  : ${describeWeather(current.weather_code)}`);
  console.log(`  氣溫  : ${current.temperature_2m} °C  (體感 ${current.apparent_temperature} °C)`);
  console.log(`  濕度  : ${current.relative_humidity_2m} %`);
  console.log(`  風速  : ${current.windspeed_10m} km/h`);

  console.log("\n【未來 7 天預報】");
  console.log(`  ${"日期".padEnd(11)}  ${"天氣".padEnd(8)}   最高   最低     降雨       風速`);
  console.log("  " + "-".repeat(57));

  daily.time.forEach((dateStr, i) => {
    const date  = new Date(dateStr);
    const label = i === 0 ? "今天" : `週${WEEKDAYS[date.getDay() === 0 ? 6 : date.getDay() - 1]}`;
    const desc  = describeWeather(daily.weather_code[i]);
    const tMax  = daily.temperature_2m_max[i];
    const tMin  = daily.temperature_2m_min[i];
    const rain  = daily.precipitation_sum[i];
    const wind  = daily.windspeed_10m_max[i];

    const descCol  = padEnd(desc, 10);
    console.log(
      `  ${dateStr} (${label})  ${descCol}` +
      `${rpad(tMax, 5)}°C ${rpad(tMin, 5)}°C` +
      `${rpad(rain, 7)}mm ${rpad(wind, 8)}km/h`
    );
  });

  console.log();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "--demo") {
    if (args.length === 0) {
      console.log("提示：未指定城市，執行離線展示模式。");
      console.log("用法：node weather.js <城市名稱>  (需網路連線)");
      console.log("      node weather.js --demo       (離線展示)\n");
    }
    const { cityName, data } = demoData();
    display(cityName, data);
    return;
  }

  const city = args[0];
  console.log(`正在查詢「${city}」的天氣預報…`);
  try {
    const { lat, lon, name } = await geocode(city);
    const data = await getForecast(lat, lon);
    display(name, data);
  } catch (err) {
    if (err.message.startsWith("找不到城市")) {
      console.error(`錯誤：${err.message}`);
    } else {
      console.error(`網路或解析錯誤：${err.message}`);
      console.error("提示：可使用 --demo 參數執行離線展示模式");
    }
    process.exit(1);
  }
}

main();
