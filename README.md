# Surf Dashboard

Kiosk page for a Fire 7 tablet: SUP / surf / wing conditions for Israeli beaches.

- Wind: Windguru WRF 9 km (model 23), per nearest Windguru spot; Open-Meteo fallback (Ashdod has no spot).
- Waves: Open-Meteo Marine at each beach.
- Rules (edit `config.js`): SUP waves ≤ 0.5 m and wind < 12 kn · Surf waves > 0.5 m · Wing wind ≥ 12 kn.

```
npm start            # http://<this-computer-ip>:8080 → open on the tablet
```

Phase 2: live camera streams in a right-hand panel on row tap.
