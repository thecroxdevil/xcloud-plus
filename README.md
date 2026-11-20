# xCloud Plus

A Tampermonkey userscript that adds Better xCloud-style features to the **new** Xbox Cloud Gaming website, [play.xbox.com](https://play.xbox.com).

[Better xCloud](https://github.com/redphx/better-xcloud) only works on the old `xbox.com/play` site. This script rebuilds the features that can work on the new site, using the same streaming APIs. Logic for resolution, codec, region and IPv6 is adapted from Better xCloud (MIT, © redphx).

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in Chrome.
2. In `chrome://extensions` → Tampermonkey → **Details**, turn on **Allow User Scripts**.
3. Open **[xcloud-plus.user.js (raw)](https://raw.githubusercontent.com/thecroxdevil/xcloud-plus/main/xcloud-plus.user.js)** and click **Install**.

Tampermonkey checks this repo for updates automatically.

## Use

Click the green **⚙ xCloud+** button (bottom-left) or press **Alt+X**.

| Shortcut | Action |
|---|---|
| Alt+X | Settings menu |
| Alt+Z | Stats bar |
| Alt+C | Screenshot |
| F8 | Keyboard & mouse → virtual controller on/off |

## Features

| Feature | Applies |
|---|---|
| Resolution (720p / 1080p / 1080p HQ) | next game launch |
| H.264 profile (High / Normal / Low), bitrate cap | next game launch |
| Server region picker, prefer IPv6 | next game launch (region list fills after first load) |
| Sharpness, brightness, contrast, saturation | live |
| Volume boost up to 300% | live (set before launch for first use) |
| Stats bar: ping, FPS, resolution, bitrate, decode time, packet/frame loss, jitter, data | live |
| Screenshot (PNG) | live |
| Keyboard & mouse → virtual Xbox controller | live (F8) |
| Block Microsoft telemetry | after reload |

### Keyboard & mouse mapping

WASD move · mouse aim (click the game to lock the cursor, Esc to release) · LMB = RT · RMB = LT · Space = A · C/Ctrl = B · R = X · V = Y · Q = LB · E = RB · Shift = L3 · F = R3 · wheel = LB/RB · Tab = View · Enter = Menu · G = Xbox · arrows or 1–4 = D-pad.

Mouse aim is converted to right-stick movement, so it behaves like a controller with mouse speed, not native mouse aim.

## Not included

- **Region-restriction bypass** — spoofs location to evade Xbox country limits; against Xbox terms.
- **Custom touch layouts, local co-op, Remote Play** — need the site's internal code, which hasn't been ported.

## Status

| Item | State |
|---|---|
| Loads at page start on play.xbox.com | verified |
| Menu, virtual controller detected by site, menu navigation | verified |
| Resolution / codec / bitrate / region / stats during a live stream | **not yet verified** |

See [CLAUDE.md](CLAUDE.md) for how the script works and how to test changes.

## License

MIT. Portions adapted from Better xCloud by redphx (MIT).
