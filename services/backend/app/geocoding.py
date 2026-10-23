"""Explicit admin searches; bounded cache and throttling for the Photon service."""

import json
import math
import os
import threading
import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import HTTPException

_lock = threading.Lock()
_cache = {}
_last_request = 0.0


def search_places(query):
    global _last_request
    query = query.strip()
    if len(query) < 2:
        return []
    with _lock:
        stamp = time.monotonic()
        if query in _cache and stamp - _cache[query][0] < 86400:
            return _cache[query][1]
        if stamp - _last_request < 1:
            raise HTTPException(429, "Vui lòng chờ một giây trước khi tìm lại.")
        _last_request = stamp
        endpoint = os.getenv("GEOCODING_URL", "https://photon.komoot.io/api/")
        url = endpoint + "?" + urlencode({"q": query, "limit": 5, "lat": 10.7769, "lon": 106.7009})
        try:
            request = Request(url, headers={"User-Agent": "Quan1Tourism/1.0", "Accept": "application/json"})
            with urlopen(request, timeout=10) as response:
                data = json.loads(response.read(1_000_000))
            items = []
            for feature in data.get("features", [])[:5]:
                lon, lat = feature["geometry"]["coordinates"][:2]
                if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
                    continue
                properties = feature.get("properties", {})
                label = ", ".join(str(properties[key]) for key in
                                  ("name", "housenumber", "street", "city", "country") if properties.get(key))
                items.append({"label": label or query, "latitude": lat, "longitude": lon})
        except (OSError, ValueError, KeyError, TypeError):
            raise HTTPException(502, "Chưa tìm được vị trí. Thử lại hoặc đặt ghim trực tiếp trên bản đồ.")
        if len(_cache) >= 200:
            _cache.pop(next(iter(_cache)))
        _cache[query] = (stamp, items)
        return items
