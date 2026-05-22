#!/usr/bin/env python3
"""Weather forecast reader using the Open-Meteo API (free, no API key needed).

Usage:
    python3 weather.py [城市名稱]   # 即時查詢 (需網路)
    python3 weather.py --demo       # 離線展示模式

Examples:
    python3 weather.py 台北
    python3 weather.py Tokyo
    python3 weather.py London
"""

import sys
import json
import urllib.request
import urllib.parse
from datetime import datetime, timedelta


GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

WMO_CODES = {
    0: "晴天", 1: "大致晴天", 2: "部分多雲", 3: "陰天",
    45: "霧", 48: "結冰霧",
    51: "毛毛雨(輕)", 53: "毛毛雨(中)", 55: "毛毛雨(重)",
    61: "小雨", 63: "中雨", 65: "大雨",
    71: "小雪", 73: "中雪", 75: "大雪", 77: "雪粒",
    80: "陣雨(輕)", 81: "陣雨(中)", 82: "陣雨(強)",
    85: "陣雪(輕)", 86: "陣雪(重)",
    95: "雷陣雨", 96: "雷陣雨夾冰雹", 99: "強雷陣雨夾冰雹",
}

WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"]


def fetch_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=10) as resp:
        return json.loads(resp.read().decode())


def geocode(city: str) -> tuple[float, float, str]:
    params = urllib.parse.urlencode({
        "name": city, "count": 1, "language": "zh", "format": "json"
    })
    data = fetch_json(f"{GEOCODING_URL}?{params}")
    results = data.get("results")
    if not results:
        raise ValueError(f"找不到城市：{city}")
    r = results[0]
    return r["latitude"], r["longitude"], r.get("name", city)


def get_forecast(lat: float, lon: float) -> dict:
    params = urllib.parse.urlencode({
        "latitude": lat,
        "longitude": lon,
        "daily": ",".join([
            "weather_code",
            "temperature_2m_max",
            "temperature_2m_min",
            "precipitation_sum",
            "windspeed_10m_max",
        ]),
        "current": ",".join([
            "temperature_2m",
            "relative_humidity_2m",
            "weather_code",
            "windspeed_10m",
            "apparent_temperature",
        ]),
        "timezone": "auto",
        "forecast_days": 7,
    })
    return fetch_json(f"{FORECAST_URL}?{params}")


def demo_data() -> tuple[str, dict]:
    """Return realistic sample data for offline demonstration."""
    today = datetime.now()
    dates = [(today + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(7)]
    data = {
        "timezone": "Asia/Taipei",
        "current": {
            "temperature_2m": 28.4,
            "apparent_temperature": 32.1,
            "relative_humidity_2m": 78,
            "weather_code": 2,
            "windspeed_10m": 14.5,
        },
        "daily": {
            "time": dates,
            "weather_code": [2, 61, 63, 80, 1, 0, 3],
            "temperature_2m_max": [31.2, 27.5, 25.8, 26.3, 30.1, 32.4, 29.7],
            "temperature_2m_min": [24.6, 22.1, 21.3, 22.0, 23.5, 25.2, 23.8],
            "precipitation_sum": [0.0, 8.2, 15.4, 5.1, 0.0, 0.0, 0.3],
            "windspeed_10m_max": [18.2, 22.7, 28.4, 19.6, 15.3, 12.1, 16.8],
        },
    }
    return "台北 (示範資料)", data


def describe_weather(code: int) -> str:
    return WMO_CODES.get(code, f"代碼{code}")


def display(city_name: str, data: dict) -> None:
    current = data["current"]
    daily = data["daily"]
    tz = data.get("timezone", "")

    print(f"\n{'='*56}")
    print(f"  {city_name} 天氣預報   ({tz})")
    print(f"{'='*56}")

    print(f"\n【目前天氣】")
    print(f"  狀況  : {describe_weather(current['weather_code'])}")
    print(f"  氣溫  : {current['temperature_2m']} °C  (體感 {current['apparent_temperature']} °C)")
    print(f"  濕度  : {current['relative_humidity_2m']} %")
    print(f"  風速  : {current['windspeed_10m']} km/h")

    print(f"\n【未來 7 天預報】")
    header = f"  {'日期':<13} {'天氣':<10} {'最高':>6} {'最低':>6} {'降雨':>8} {'風速':>10}"
    print(header)
    print(f"  {'-'*57}")

    for i, date_str in enumerate(daily["time"]):
        date = datetime.fromisoformat(date_str)
        label = "今天" if i == 0 else f"週{WEEKDAYS[date.weekday()]}"
        desc = describe_weather(daily["weather_code"][i])
        t_max = daily["temperature_2m_max"][i]
        t_min = daily["temperature_2m_min"][i]
        rain = daily["precipitation_sum"][i]
        wind = daily["windspeed_10m_max"][i]
        print(
            f"  {date_str} ({label})  {desc:<8} "
            f"{t_max:>5.1f}°C {t_min:>5.1f}°C "
            f"{rain:>6.1f}mm {wind:>7.1f}km/h"
        )

    print()


def main() -> None:
    args = sys.argv[1:]

    if not args or args[0] == "--demo":
        if not args:
            print("提示：未指定城市，執行離線展示模式。")
            print("用法：python3 weather.py <城市名稱>  (需網路連線)")
            print("      python3 weather.py --demo       (離線展示)\n")
        city_name, data = demo_data()
        display(city_name, data)
        return

    city = args[0]
    print(f"正在查詢「{city}」的天氣預報…")
    try:
        lat, lon, name = geocode(city)
        data = get_forecast(lat, lon)
        display(name, data)
    except ValueError as e:
        print(f"錯誤：{e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"網路或解析錯誤：{e}", file=sys.stderr)
        print("提示：可使用 --demo 參數執行離線展示模式", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
