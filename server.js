import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { BEACHES, THRESHOLDS, WG_MODEL, CACHE_MS, PORT } from "./config.js";

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
      `&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m&wind_speed_unit=kn&timezone=UTC&forecast_days=2`,
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
      `&hourly=wave_height,wave_period,wave_direction&timezone=UTC&forecast_days=2`,
  );
  const h = d.hourly;
  return h.time.map((t, i) => ({
    t: Date.parse(t + "Z"),
    m: h.wave_height[i],
    period: h.wave_period[i],
    dir: h.wave_direction[i],
  }));
}

function nearest(series, t) {
  let best = null;
  for (const p of series) if (!best || Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  return best;
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

async function beachReport(b) {
  const [windRes, waveRes] = await Promise.allSettled([
    cached(`wind:${b.wgSpot ?? `${b.lat},${b.lon}`}`, () =>
      b.wgSpot ? windguruWind(b.wgSpot) : openMeteoWind(b.lat, b.lon),
    ).catch(() => cached(`omwind:${b.lat},${b.lon}`, () => openMeteoWind(b.lat, b.lon))),
    cached(`wave:${b.lat},${b.lon}`, () => waves(b.lat, b.lon)),
  ]);
  const wind = windRes.status === "fulfilled" ? windRes.value : [];
  const wave = waveRes.status === "fulfilled" ? waveRes.value : [];
  const now = Date.now();
  const hours = Array.from({ length: HOURS }, (_, i) => {
    const t = now + i * 3600e3;
    const wi = nearest(wind, t);
    const wa = nearest(wave, t);
    return { t, wind: wi, wave: wa, act: activities(wa, wi) };
  });
  return {
    id: b.id,
    name: b.name,
    windSource: b.wgSpot ? `Windguru WRF 9 km (spot ${b.wgSpot})` : "Open-Meteo",
    errors: [windRes, waveRes].filter((r) => r.status === "rejected").map((r) => String(r.reason)),
    now: hours[0],
    hours,
  };
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };

createServer(async (req, res) => {
  try {
    if (req.url === "/api/conditions") {
      const beaches = await Promise.all(BEACHES.map(beachReport));
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ updated: Date.now(), thresholds: THRESHOLDS, beaches }));
    }
    const path = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    if (path.includes("..")) throw Object.assign(new Error("bad path"), { code: "ENOENT" });
    const body = await readFile(join(PUBLIC, path));
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch (e) {
    res.writeHead(e.code === "ENOENT" ? 404 : 500);
    res.end(e.code === "ENOENT" ? "not found" : String(e));
  }
}).listen(PORT, "0.0.0.0", () => process.stdout.write(`surf dashboard on :${PORT}\n`));
