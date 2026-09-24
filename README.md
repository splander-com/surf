# Surf Dashboard

Kiosk page for a Fire 7 tablet (1024×600, landscape): SUP / surf / wing conditions for Israeli beaches.

- Wind: Windguru WRF 9 km (model 23), per nearest Windguru spot; Open-Meteo wind in knots as the
  fallback, for Ashdod (no Windguru spot) and for the hours past Windguru's ~78 h horizon.
  Windguru's values are knots — `node scripts/check-wind-units.mjs` re-checks that against Open-Meteo.
- Waves: Open-Meteo Marine at each beach.
- Rules (edit `config.js`): SUP waves ≤ 0.5 m and wind < 12 kn · Surf waves > 0.5 m · Wing wind ≥ 12 kn.
- Right panel: optional camera, then a 72 h forecast graph for the selected beach
  (default Jaffa, `DEFAULT_BEACH` in config.js).
- A red **STALE** badge appears when the data on screen is more than 30 min old
  (upstream down, or the tablet can't reach the server).

No dependencies — just Node.js 20.11 or newer (22 recommended).

## Run it at home

The server runs on any always-on machine on your home Wi-Fi (a PC, a Mac or a Raspberry Pi);
the tablet only opens a web page from it.

```sh
git clone https://github.com/splander-com/surf.git
cd surf
npm start                 # → "surf dashboard on :8080"
```

Check it on the same machine at http://localhost:8080. Then find that machine's LAN address:

| OS | Command | Look for |
|---|---|---|
| Linux / Raspberry Pi | `hostname -I` | first address, e.g. `192.168.1.20` |
| macOS | `ipconfig getifaddr en0` | |
| Windows | `ipconfig` | "IPv4 Address" of the Wi-Fi/Ethernet adapter |

On the tablet open **http://&lt;pc-ip&gt;:8080** (e.g. `http://192.168.1.20:8080`).
If it doesn't load, allow port 8080 in the machine's firewall (Windows asks the first time
Node listens — tick "Private networks"). Give the machine a fixed address (a DHCP reservation
in your router) so the tablet's bookmark keeps working.

Options (environment variables):

| Variable | Default | |
|---|---|---|
| `PORT` | `8080` | port to listen on |
| `WINDY_API_KEY` | — | enables Windy webcams, see below |

```sh
PORT=3000 WINDY_API_KEY=your-key npm start          # Linux / macOS
set WINDY_API_KEY=your-key                          # Windows cmd (then run npm start)
```

### Raspberry Pi

Raspberry Pi OS's own `nodejs` package may be too old; install Node 22 from NodeSource:

```sh
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node -v                   # v22.x
```

A Pi Zero 2 W or newer is plenty — the server does ~20 small HTTP requests every 15 minutes.

### Start on boot (Linux / Raspberry Pi, systemd)

Create `/etc/systemd/system/surf.service` (adjust `User` and the paths to where you cloned it):

```ini
[Unit]
Description=Surf dashboard
Wants=network-online.target
After=network-online.target

[Service]
User=pi
WorkingDirectory=/home/pi/surf
ExecStart=/usr/bin/node server.js
Environment=PORT=8080
# Environment=WINDY_API_KEY=your-key
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now surf
systemctl status surf            # should say "active (running)"
journalctl -u surf -f            # logs
```

After a `git pull`, run `sudo systemctl restart surf`.

(On Windows, the simplest equivalent is a Task Scheduler task "At log on" running
`node C:\path\to\surf\server.js` with "Start in" set to the repo folder.)

## Setting up the Fire 7

1. Open `http://<pc-ip>:8080` in Silk (or Chrome/Firefox if installed).
2. Menu → **Add to Home Screen**. Launched from that icon it opens full screen in landscape
   (web app manifest). In a normal tab, the first tap anywhere switches to full screen.
3. **Keep the screen on.** The page asks for a Screen Wake Lock, but browsers only allow that on
   `https://` or `localhost`, so over `http://<pc-ip>` it usually isn't available (a 🔆 in the
   header means a lock is held). Instead set Settings → Display → **Screen Timeout → Never**
   and keep the tablet on its charger. For a locked-down kiosk (auto-start, no navigation bar,
   screen on), a kiosk browser app such as Fully Kiosk Browser does all of this.
4. Tap a beach to show its forecast; the choice is remembered. The page refreshes every
   15 minutes and immediately when the tablet wakes.

## Cameras

- A hand-picked camera: set `cam` on a beach in `config.js` to an **embeddable** URL
  (YouTube live `https://www.youtube.com/embed/<id>?autoplay=1&mute=1&playsinline=1`, or a
  provider's official embed code). beachcam.co.il does not allow embedding and isn't used.
- Windy webcams: get a free key at https://api.windy.com/keys and start the server with
  `WINDY_API_KEY`. Beaches without a hand-picked `cam` then show the best camera within 15 km that
  offers Windy's embed player (live stream if any, otherwise today's timelapse), with credit to
  Windy.com. No key → no Windy calls, no errors. The camera list is cached for an hour.
