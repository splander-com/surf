// Beaches north → south. `he` is the Hebrew name shown under the English one. `wgSpot` is the Windguru forecast spot used for wind;
// null falls back to Open-Meteo wind at the beach's own coordinates.
// `cam` (optional) is an embeddable live-camera URL — only sources that allow embedding.
export const BEACHES = [
  { id: "bat-galim", name: "Bat Galim (Haifa)", he: "בת גלים, חיפה", lat: 32.832, lon: 34.978, wgSpot: 734 },
  { id: "neve-yam", name: "Neve Yam", he: "נווה ים", lat: 32.681, lon: 34.925, wgSpot: 4895 },
  { id: "sdot-yam", name: "Sdot Yam", he: "שדות ים", lat: 32.49, lon: 34.884, wgSpot: 736 },
  { id: "herzliya", name: "Herzliya (Sidney Ali)", he: "הרצליה, סידני עלי", lat: 32.172, lon: 34.8, wgSpot: 308 },
  { id: "hilton", name: "Hilton / Metzitzim", he: "הילטון / מציצים", lat: 32.093, lon: 34.767, wgSpot: 308 },
  { id: "gordon", name: "Gordon / Frishman", he: "גורדון / פרישמן", lat: 32.083, lon: 34.766, wgSpot: 308 },
  { id: "jaffa", name: "Jaffa / Givat Aliyah", he: "יפו / גבעת עלייה", lat: 32.045, lon: 34.748, wgSpot: 769 },
  { id: "bat-yam", name: "Bat Yam", he: "בת ים", lat: 32.02, lon: 34.742, wgSpot: 769 },
  { id: "ashdod", name: "Ashdod", he: "אשדוד", lat: 31.8, lon: 34.63, wgSpot: null,
    // YouTube live, "אשדוד - חוף יא'" (also used by SkylineWebcams Oranim Beach)
    cam: "https://www.youtube.com/embed/fcbaCxpUs9Y?autoplay=1&mute=1&playsinline=1" },
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
export const DEFAULT_BEACH = "jaffa";

// Windy webcams (https://api.windy.com/webcams): used for beaches without a `cam`
// above, only when WINDY_API_KEY is set in the environment.
export const WINDY = {
  apiKey: process.env.WINDY_API_KEY || "",
  radiusKm: 15,
  cacheMs: 60 * 60 * 1000, // the camera list changes rarely
};
