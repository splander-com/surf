// Sanity check: are Windguru's WINDSPD / GUST in knots?
// Compares them hour by hour with Open-Meteo (wind_speed_unit=kn) at each
// Windguru spot's own coordinates. Knots gives a fit slope near 1;
// m/s would be ~0.51 and km/h ~1.85 at every spot.
//   node scripts/check-wind-units.mjs
import { BEACHES, WG_MODEL } from "../config.js";

const spots = [...new Set(BEACHES.map((b) => b.wgSpot).filter(Boolean))];
const slope = (p) => p.reduce((a, [w, o]) => a + w * o, 0) / p.reduce((a, [, o]) => a + o * o, 0);
function corr(p) {
  const n = p.length, mx = p.reduce((a, q) => a + q[0], 0) / n, my = p.reduce((a, q) => a + q[1], 0) / n;
  let c = 0, x = 0, y = 0;
  for (const [a, b] of p) { c += (a - mx) * (b - my); x += (a - mx) ** 2; y += (b - my) ** 2; }
  return c / Math.sqrt(x * y);
}

for (const spot of spots) {
  const wg = await (await fetch(
    `https://www.windguru.cz/int/iapi.php?q=forecast&id_model=${WG_MODEL}&id_spot=${spot}`,
    { headers: { Referer: `https://www.windguru.cz/${spot}`, "User-Agent": "Mozilla/5.0" } },
  )).json();
  const f = wg.fcst;
  const om = (await (await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${wg.lat}&longitude=${wg.lon}` +
      `&hourly=wind_speed_10m,wind_gusts_10m&wind_speed_unit=kn&timezone=UTC&forecast_days=4`,
  )).json()).hourly;
  const idx = new Map(om.time.map((t, i) => [Date.parse(t + "Z"), i]));
  const spd = [], gust = [];
  f.hours.forEach((h, i) => {
    const j = idx.get((f.initstamp + h * 3600) * 1000);
    if (j == null) return;
    spd.push([f.WINDSPD[i], om.wind_speed_10m[j]]);
    gust.push([f.GUST[i], om.wind_gusts_10m[j]]);
  });
  console.log(
    `spot ${spot}: ${spd.length} h · WINDSPD/OM-kn slope ${slope(spd).toFixed(2)} (r ${corr(spd).toFixed(2)})` +
      ` · GUST/OM-kn slope ${slope(gust).toFixed(2)}`,
  );
}
