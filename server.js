import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { BEACHES, THRESHOLDS, WG_MODEL, CACHE_MS, PORT, DEFAULT_BEACH } from "./config.js";

const HOURS = 12;
const PUBLIC = join(import.meta.dirname, "public");
const cache = new Map();

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", ...headers } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// Windguru's unofficial API only answers with a Referer from its own site.
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
  const omWind = () => cached(`omwind:${b.lat},${b.lon}`, () => openMeteoWind(b.lat, b.lon));
  const [wgRes, omRes, waveRes] = await Promise.allSettled([
    b.wgSpot ? cached(`wg:${b.wgSpot}`, () => windguruWind(b.wgSpot)) : Promise.resolve([]),
    // Open-Meteo is the fallback when Windguru fails and the filler past its horizon.
    omWind(),
    cached(`wave:${b.lat},${b.lon}`, () => waves(b.lat, b.lon)),
  ]);
  const wg = wgRes.status === "fulfilled" ? wgRes.value : [];
  const om = omRes.status === "fulfilled" ? omRes.value : [];
  const wave = waveRes.status === "fulfilled" ? waveRes.value : [];
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
    cam: b.cam ?? null,
    windSource: wg.length ? `Windguru WRF 9 km (spot ${b.wgSpot})` : "Open-Meteo",
    // Open-Meteo wind is only a gap filler when Windguru works, so its failure alone isn't "partial data".
    errors: [wgRes, wg.length ? null : omRes, waveRes]
      .filter((r) => r?.status === "rejected").map((r) => String(r.reason)),
    now: hours[0],
    hours,
  };
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };

createServer(async (req, res) => {
  try {
    const url = req.url.split("?")[0];
    if (url === "/api/conditions") {
      const beaches = await Promise.all(BEACHES.map((b) => beachReport(b)));
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ updated: Date.now(), thresholds: THRESHOLDS, defaultBeach: DEFAULT_BEACH, beaches }));
    }
    const fc = url.match(/^\/api\/forecast\/([\w-]+)$/);
    if (fc) {
      const b = BEACHES.find((x) => x.id === fc[1]);
      if (!b) throw Object.assign(new Error("no beach"), { code: "ENOENT" });
      const report = await beachReport(b, 72, 1);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ thresholds: THRESHOLDS, ...report }));
    }
    const path = url === "/" ? "/index.html" : url;
    if (path.includes("..")) throw Object.assign(new Error("bad path"), { code: "ENOENT" });
    const body = await readFile(join(PUBLIC, path));
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch (e) {
    res.writeHead(e.code === "ENOENT" ? 404 : 500);
    res.end(e.code === "ENOENT" ? "not found" : String(e));
  }
}).listen(PORT, "0.0.0.0", () => process.stdout.write(`surf dashboard on :${PORT}\n`));
