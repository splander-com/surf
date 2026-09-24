import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { BEACHES, THRESHOLDS, WG_MODEL, CACHE_MS, PORT, DEFAULT_BEACH, WINDY } from "./config.js";

const HOURS = 12;
const PUBLIC = join(import.meta.dirname, "public");
const cache = new Map();

// Returns { value, at } where `at` is when the data was fetched. If a refresh
// fails, the last good value is served (stale-if-error) so the kiosk keeps
// showing something; its old `at` is what drives the page's "stale" badge.
async function cached(key, fn, maxAge = CACHE_MS) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < maxAge) return hit;
  try {
    const entry = { at: Date.now(), value: await fn() };
    cache.set(key, entry);
    return entry;
  } catch (e) {
    if (hit) return hit;
    throw e;
  }
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// Windguru's unofficial API only answers with a Referer from its own site.
// WINDSPD and GUST are already knots — checked against Open-Meteo in knots
// (hourly fit slope ~1.1 at most spots, never the 0.51 of m/s or 1.85 of km/h);
// re-run `node scripts/check-wind-units.mjs` if the numbers ever look off.
async function windguruWind(spot) {
  const d = await getJson(
    `https://www.windguru.cz/int/iapi.php?q=forecast&id_model=${WG_MODEL}&id_spot=${spot}`,
    { Referer: `https://www.windguru.cz/${spot}` },
  );
  const f = d.fcst;
  return f.hours.map((h, i) => ({
    t: (f.initstamp + h * 3600) * 1000,
    kn: f.WINDSPD[i],
    gust: f.GUST[i],
    dir: f.WINDDIR[i],
  }));
}

async function openMeteoWind(lat, lon) {
  const d = await getJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m&wind_speed_unit=kn&timezone=UTC&forecast_days=4`,
  );
  const h = d.hourly;
  return h.time.map((t, i) => ({
    t: Date.parse(t + "Z"),
    kn: h.wind_speed_10m[i],
    gust: h.wind_gusts_10m[i],
    dir: h.wind_direction_10m[i],
  }));
}

async function waves(lat, lon) {
  const d = await getJson(
    `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}` +
      `&hourly=wave_height,wave_period,wave_direction&timezone=UTC&forecast_days=4`,
  );
  const h = d.hourly;
  return h.time.map((t, i) => ({
    t: Date.parse(t + "Z"),
    m: h.wave_height[i],
    period: h.wave_period[i],
    dir: h.wave_direction[i],
  }));
}

// Closest sample to t, but never further than maxMs away — otherwise a forecast
// that ends early (Windguru WRF stops ~78 h after its run) repeats its last value.
const km = (a, b) => {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

// Windy webcams API v3: `player.live|day|month|year|lifetime` are iframe embed URLs.
// (v2 used { available, embed } objects — accepted too, in case of an old response.)
const embedOf = (v) => (typeof v === "string" ? v : v?.available !== false ? v?.embed : null) || null;
const WINDY_URL = process.env.WINDY_WEBCAMS_URL || "https://api.windy.com/webcams/api/v3/webcams";

async function windyCams(lat, lon) {
  const d = await getJson(
    `${WINDY_URL}?nearby=${lat},${lon},${WINDY.radiusKm}&include=location,player&limit=50&lang=en`,
    { "x-windy-api-key": WINDY.apiKey },
  );
  return (d.webcams ?? [])
    .filter((w) => (w.status ?? "active") === "active")
    .map((w) => {
      const p = w.player ?? {};
      // Prefer a live stream; otherwise today's timelapse.
      const kind = ["live", "day"].find((k) => embedOf(p[k]));
      const loc = w.location ?? {};
      return kind && {
        url: embedOf(p[kind]),
        kind,
        title: w.title ?? "Webcam",
        km: loc.latitude != null ? km({ lat, lon }, { lat: loc.latitude, lon: loc.longitude }) : null,
      };
    })
    .filter((c) => c && (c.km == null || c.km <= WINDY.radiusKm))
    // live streams first, then nearest
    .sort((a, b) => (b.kind === "live") - (a.kind === "live") || (a.km ?? 1e9) - (b.km ?? 1e9));
}

// A hand-picked `cam` in config.js wins; otherwise the best Windy camera, if a key is set.
// Any Windy failure just means "no camera" — it never breaks the forecast.
async function camFor(b) {
  if (b.cam) return { url: b.cam, title: null, source: null };
  if (!WINDY.apiKey) return null;
  try {
    const { value } = await cached(`windy:${b.lat},${b.lon}`, () => windyCams(b.lat, b.lon), WINDY.cacheMs);
    const c = value[0];
    return c ? { url: c.url, title: c.title, source: "Windy.com", kind: c.kind, km: c.km } : null;
  } catch (e) {
    console.warn(`windy webcams for ${b.id}: ${e.message}`);
    // Remember the failure for one normal cache period, so a bad key or an outage
    // isn't retried (and logged) on every request.
    cache.set(`windy:${b.lat},${b.lon}`, { at: Date.now() - WINDY.cacheMs + CACHE_MS, value: [] });
    return null;
  }
}

function nearest(series, t, maxMs = 90 * 60e3) {
  let best = null;
  for (const p of series) if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  return best && Math.abs(best.t - t) <= maxMs ? best : null;
}

function activities(wave, wind) {
  const T = THRESHOLDS;
  const w = wave?.m ?? null;
  const kn = wind?.kn ?? null;
  return {
    sup: w != null && w <= T.supMaxWaveM && (kn == null || kn < T.supMaxWindKn),
    surf: w != null && w > T.supMaxWaveM && (wave.period ?? 0) >= T.surfMinPeriodS,
    wing: kn != null && kn >= T.wingMinWindKn,
  };
}

async function beachReport(b, hoursAhead = HOURS, stepH = 1) {
  const [wgRes, omRes, waveRes, camRes] = await Promise.allSettled([
    b.wgSpot ? cached(`wg:${b.wgSpot}`, () => windguruWind(b.wgSpot)) : Promise.resolve(null),
    // Open-Meteo is the fallback when Windguru fails and the filler past its horizon.
    cached(`omwind:${b.lat},${b.lon}`, () => openMeteoWind(b.lat, b.lon)),
    cached(`wave:${b.lat},${b.lon}`, () => waves(b.lat, b.lon)),
    camFor(b),
  ]);
  const ok = (r) => (r.status === "fulfilled" ? r.value : null);
  const wg = ok(wgRes)?.value ?? [];
  const om = ok(omRes)?.value ?? [];
  const wave = ok(waveRes)?.value ?? [];
  // Age of what's shown: the oldest source the numbers came from.
  const windAt = wg.length ? ok(wgRes).at : ok(omRes)?.at;
  const dataAt = Math.min(windAt ?? Infinity, ok(waveRes)?.at ?? Infinity);
  const now = Date.now();
  const start = Math.floor(now / 3600e3) * 3600e3;
  const hours = Array.from({ length: Math.ceil(hoursAhead / stepH) }, (_, i) => {
    const t = i === 0 ? now : start + i * stepH * 3600e3;
    const wg1 = nearest(wg, t);
    const wi = wg1 ? { ...wg1, src: "wg" } : (nearest(om, t) && { ...nearest(om, t), src: "om" });
    const wa = nearest(wave, t);
    return { t, wind: wi, wave: wa, act: activities(wa, wi) };
  });
  return {
    id: b.id,
    name: b.name,
    cam: ok(camRes),
    dataAt: Number.isFinite(dataAt) ? dataAt : null,
    windSource: wg.length ? `Windguru WRF 9 km (spot ${b.wgSpot})` : "Open-Meteo",
    // Open-Meteo wind is only a gap filler when Windguru works, so its failure alone isn't "partial data".
    errors: [wgRes, wg.length ? null : omRes, waveRes]
      .filter((r) => r?.status === "rejected").map((r) => String(r.reason)),
    now: hours[0],
    hours,
  };
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png",
};

createServer(async (req, res) => {
  try {
    const url = req.url.split("?")[0];
    if (url === "/api/conditions") {
      const beaches = await Promise.all(BEACHES.map((b) => beachReport(b)));
      res.writeHead(200, { "Content-Type": "application/json" });
      const ats = beaches.map((b) => b.dataAt).filter((t) => t != null);
      const dataAt = ats.length ? Math.min(...ats) : null;
      return res.end(JSON.stringify({ updated: Date.now(), dataAt, thresholds: THRESHOLDS, defaultBeach: DEFAULT_BEACH, beaches }));
    }
    const fc = url.match(/^\/api\/forecast\/([\w-]+)$/);
    if (fc) {
      const b = BEACHES.find((x) => x.id === fc[1]);
      if (!b) throw Object.assign(new Error("no beach"), { code: "ENOENT" });
      const report = await beachReport(b, 72, 1);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ thresholds: THRESHOLDS, ...report }));
    }
    const path = url === "/" ? "/index.html" : url === "/favicon.ico" ? "/icon.svg" : url;
    if (path.includes("..")) throw Object.assign(new Error("bad path"), { code: "ENOENT" });
    const body = await readFile(join(PUBLIC, path));
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch (e) {
    res.writeHead(e.code === "ENOENT" ? 404 : 500);
    res.end(e.code === "ENOENT" ? "not found" : String(e));
  }
}).listen(PORT, "0.0.0.0", () => process.stdout.write(`surf dashboard on :${PORT}\n`));
