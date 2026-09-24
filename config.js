// Beaches north → south. `wgSpot` is the Windguru forecast spot used for wind;
// null falls back to Open-Meteo wind at the beach's own coordinates.
export const BEACHES = [
  { id: "bat-galim", name: "Bat Galim (Haifa)", lat: 32.832, lon: 34.978, wgSpot: 734 },
  { id: "neve-yam", name: "Neve Yam", lat: 32.681, lon: 34.925, wgSpot: 4895 },
  { id: "sdot-yam", name: "Sdot Yam", lat: 32.49, lon: 34.884, wgSpot: 736 },
  { id: "herzliya", name: "Herzliya (Sidney Ali)", lat: 32.172, lon: 34.8, wgSpot: 308 },
  { id: "hilton", name: "Hilton / Metzitzim", lat: 32.093, lon: 34.767, wgSpot: 308 },
  { id: "gordon", name: "Gordon / Frishman", lat: 32.083, lon: 34.766, wgSpot: 308 },
  { id: "jaffa", name: "Jaffa / Givat Aliyah", lat: 32.045, lon: 34.748, wgSpot: 769 },
  { id: "bat-yam", name: "Bat Yam", lat: 32.02, lon: 34.742, wgSpot: 769 },
  { id: "ashdod", name: "Ashdod", lat: 31.8, lon: 34.63, wgSpot: null },
];

export const THRESHOLDS = {
  supMaxWaveM: 0.5, // SUP up to this wave height (set 0.6 if you prefer)
  supMaxWindKn: 12, // SUP also needs light wind
  surfMinPeriodS: 0, // surf: waves above supMaxWaveM; raise (e.g. 6) to demand longer-period swell
  wingMinWindKn: 12,
};

export const WG_MODEL = 23; // Windguru WRF 9 km
export const CACHE_MS = 15 * 60 * 1000;
export const PORT = Number(process.env.PORT) || 8080;
