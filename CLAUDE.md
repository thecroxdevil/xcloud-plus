# xCloud Plus — notes for Claude Code

Single-file Tampermonkey userscript: `xcloud-plus.user.js`. No build step. Owner: Charles (`thecroxdevil`). He tests in Chrome on macOS with Tampermonkey.

## Workflow rules

- **Bump `@version` (header) and `window.__XCLOUD_PLUS__` together** on every change, or Tampermonkey won't pull the update.
- Check syntax before committing: `node --check xcloud-plus.user.js`.
- Commit and push to `main`. Tampermonkey auto-updates from the raw URL in `@updateURL`.
- Keep `@namespace charles.xcloud-plus` and `@name` unchanged, or Tampermonkey installs a second copy.
- Each game launch costs the user's cloud playtime. Keep live-stream tests short and close the game afterwards.

## Testing with Chrome DevTools MCP

`.mcp.json` registers the `chrome-devtools` MCP server (approve it when Claude Code asks).
Testing flow:
1. Open `https://play.xbox.com` (user must be signed in; never enter credentials).
2. Check the script loaded: `window.__XCLOUD_PLUS__` is the current version, and `navigator.getGamepads.toString()` is not native code.
3. Console messages are prefixed `[xCloudPlus]`.
4. For stream features, launch one game, open stats (Alt+Z), read the console, then leave.

Note: the DevTools MCP launches its own Chrome profile by default, which won't have Tampermonkey or the user's sign-in. Either connect to the user's Chrome (`--browser-url=http://127.0.0.1:9222`, Chrome started with `--remote-debugging-port=9222`) or ask the user to install Tampermonkey in that profile.

## How the new site works (findings, Nov 2026)

- play.xbox.com is a React Router v7 app with ~200 native ES modules and a service worker (`entry.worker.js`). There is no webpack bundle, so Better xCloud's approach of patching bundle source does not apply.
- Streaming uses the **same API as the old site**: `https://<region>.core.gssv-play-prod.xboxlive.com/v5/sessions/cloud/...`, `/v2/login/user`, `/v1/waittime/...`. So request and response interception from Better xCloud still works.
- The site keeps references to `fetch` and `RTCPeerConnection` when it first loads. Hooks **must** run at `document-start`; anything injected later misses the stream setup.
- **CSP**: `script-src` uses a nonce and has no `unsafe-eval`. Code in the page cannot `eval`/`new Function`. (A localStorage + `new Function` dev loader failed for this reason.) The script must be installed in Tampermonkey directly, with `@sandbox raw` / `@inject-into page`, so it runs in the page world.
- React replaces `<head>` and children of `<html>` during hydration. Use `document.adoptedStyleSheets` for CSS, and attach UI to `<body>`. The ⚙ button re-attaches itself if removed.
- `arc.msn.com/v4/api/selection` supplies **home-page featured content**. Blocking it breaks the page ("Something went wrong"). Only `arc.msn.com/v3/Delivery/e/` (impression beacons) is blocked.
- The site polls `navigator.getGamepads()` about 20×/s in menus. A fake pad (object made from `Gamepad.prototype`, plus a synthetic `gamepadconnected` event) is accepted. The site shows "Controller connected" and menu navigation works. Every press is held for at least 90 ms so polls don't miss it.
- Default stream was already 1920×1080 for this account without any override.

## Code map (`xcloud-plus.user.js`)

| Section | Purpose |
|---|---|
| Settings | `localStorage["xcloud-plus-settings"]`, defaults in `DEFAULTS` |
| Network hooks | `window.fetch` wrapper: login (region list and forced region), `/sessions/cloud/play` (osName and `x-ms-device-info` → resolution), `/ice` (IPv6 order), tracking block. XHR and sendBeacon blocking |
| WebRTC hooks | `setLocalDescription` SDP edits (H.264 profile, `b=AS` bitrate cap). `RTCPeerConnection` Proxy captures the connection for stats |
| Audio boost | WebAudio gain on the remote audio track, original element muted |
| Video filters | CSS `filter` + SVG `feConvolveMatrix` sharpen on the stream `<video>` |
| Stats | `pc.getStats()` every 1 s: res, fps, bitrate, decode time, jitter, packet/frame loss, RTT |
| MKB | `navigator.getGamepads` override and virtual pad. Key, mouse (pointer lock) and wheel listeners in the capture phase |
| UI | ⚙ button, panel (Alt+X), stats bar (Alt+Z), screenshot (Alt+C), toasts |

## Open items

- Verify in a live stream: resolution override, codec reorder, bitrate cap, region forcing, IPv6, stats values, audio boost.
- Tune default mouse sensitivity (`mouseSens`) in a real game. Consider an acceleration curve.
- Key remapping UI.
- Investigate site internals for touch layouts / local co-op / Remote Play (likely hard).
- Do **not** add the region-restriction bypass (X-Forwarded-For spoofing).
