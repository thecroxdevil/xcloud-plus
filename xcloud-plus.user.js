// ==UserScript==
// @name         xCloud Plus (for play.xbox.com)
// @namespace    charles.xcloud-plus
// @version      1.2.2
// @description  Better xCloud-style features for the new Xbox Cloud Gaming site: resolution, codec, bitrate cap, server region, IPv6, stats overlay, sharpening/video adjust, audio boost, screenshot, tracking block. Logic adapted from Better xCloud (MIT, redphx).
// @match        https://play.xbox.com/*
// @run-at       document-start
// @homepageURL  https://github.com/thecroxdevil/xcloud-plus
// @supportURL   https://github.com/thecroxdevil/xcloud-plus/issues
// @updateURL    https://raw.githubusercontent.com/thecroxdevil/xcloud-plus/main/xcloud-plus.user.js
// @downloadURL  https://raw.githubusercontent.com/thecroxdevil/xcloud-plus/main/xcloud-plus.user.js
// @license      MIT
// @grant        none
// @sandbox      raw
// @inject-into  page
// ==/UserScript==
"use strict";
(() => {
  if (window.__XCLOUD_PLUS__) return;
  window.__XCLOUD_PLUS__ = "1.2.2";

  const TAG = "[xCloudPlus]";
  const log = (...a) => console.log(`%c${TAG}`, "color:#107c10;font-weight:bold", ...a);
  const warn = (...a) => console.warn(TAG, ...a);

  // ======================= Settings =======================
  const KEY = "xcloud-plus-settings";
  const DEFAULTS = {
    resolution: "auto",     // auto | 720p | 1080p | 1080p-hq
    codec: "default",       // default | high | normal | low (H.264 profile)
    maxBitrate: 0,          // Mbps, 0 = unlimited
    region: "default",      // region name from login response, or "default"
    preferIpv6: false,
    blockTracking: true,
    sharpness: 0,           // 0-10
    brightness: 100,
    contrast: 100,
    saturation: 100,
    audioBoost: 100,        // % (100 = off)
    statsOnStart: false,
    mouseSens: 60,          // 10-200
    invertY: false,
    statsItems: ["time", "ping", "fps", "res", "btr", "dt", "pl", "fl", "jit", "dl"],
  };
  const S = { ...DEFAULTS };
  try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };

  const STATE = { pc: null, regions: JSON.parse(localStorage.getItem("xcloud-plus-regions") || "[]"), selectedRegion: null };

  // ======================= Network hooks =======================
  const NATIVE_FETCH = window.fetch;
  const BLOCKED = [
    "https://arc.msn.com/v3/Delivery/e/",   // ad impression beacons only (arc.msn.com/v4 serves home-page content)
    "https://browser.events.data.microsoft.com",
    "https://dc.services.visualstudio.com",
    "ingest.sentry.io",
    "ingest.us.sentry.io",
    "https://mscom.demdex.net",
  ];
  const isBlocked = (url) => S.blockTracking && BLOCKED.some((b) => url.includes(b));

  const osFor = (r) => (r === "1080p-hq" ? "tizen" : r === "1080p" ? "windows" : "android");
  const deviceInfo = (osName) => ({
    appInfo: { env: { clientAppId: location.host, clientAppType: "browser", clientAppVersion: "26.1.97",
      clientSdkVersion: "10.3.7", httpEnvironment: "prod", sdkInstallId: "" } },
    dev: {
      os: { name: osName, ver: "22631.2715", platform: "desktop" },
      hw: { make: "Microsoft", model: "unknown", sdktype: "web" },
      browser: { browserName: "chrome", browserVersion: "140.0.3485.54" },
      displayInfo: { dimensions: { widthInPixels: 4096, heightInPixels: 2160 }, pixelDensity: { dpiX: 1, dpiY: 1 } },
    },
  });

  const jsonResponse = (obj, res) =>
    new Response(JSON.stringify(obj), { status: res.status, statusText: res.statusText, headers: res.headers });

  async function handleLogin(req) {
    const res = await NATIVE_FETCH(req);
    if (res.status !== 200) return res;
    try {
      const obj = await res.clone().json();
      const regions = obj?.offeringSettings?.regions;
      if (!Array.isArray(regions)) return res;
      STATE.regions = regions.map((r) => ({ name: r.name, isDefault: !!r.isDefault, host: (/\/\/(\w+)\./.exec(r.baseUri) || [])[1] || "" }));
      try { localStorage.setItem("xcloud-plus-regions", JSON.stringify(STATE.regions)); } catch (e) {}
      const def = regions.find((r) => r.isDefault);
      STATE.selectedRegion = def ? def.name : null;
      if (S.region !== "default") {
        const pick = regions.find((r) => r.name === S.region);
        if (pick) {
          obj.offeringSettings.regions = [{ ...pick, isDefault: true }];
          STATE.selectedRegion = pick.name;
          log("Server region forced:", pick.name);
          return jsonResponse(obj, res);
        }
        warn("Preferred region not offered:", S.region);
      }
      log("Server regions:", STATE.regions.map((r) => r.name + (r.isDefault ? "*" : "")).join(", "));
    } catch (e) { warn("login patch failed", e); }
    return res;
  }

  async function handlePlay(req) {
    if (S.resolution === "auto") return NATIVE_FETCH(req);
    try {
      const body = await req.clone().json();
      const osName = osFor(S.resolution);
      body.settings = body.settings || {};
      const before = body.settings.osName;
      body.settings.osName = osName;
      const headers = new Headers(req.headers);
      headers.set("x-ms-device-info", JSON.stringify(deviceInfo(osName)));
      log(`Play request: osName ${before} -> ${osName}`);
      return NATIVE_FETCH(new Request(req, { body: JSON.stringify(body), headers }));
    } catch (e) { warn("play patch failed", e); return NATIVE_FETCH(req); }
  }

  function updateIceCandidates(candidates) {
    const re = /a=candidate:(?<foundation>\d+) (?<component>\d+) UDP (?<priority>\d+) (?<ip>[^\s]+) (?<port>\d+) (?<rest>.*)/;
    const lst = [];
    for (const c of candidates) {
      if (c.candidate === "a=end-of-candidates") continue;
      const m = re.exec(c.candidate);
      if (m) lst.push(m.groups);
    }
    lst.sort((a, b) => (!a.ip.includes(":") && b.ip.includes(":") ? 1 : -1));
    const out = lst.map((g, i) => ({
      candidate: `a=candidate:${i + 1} 1 UDP ${i === 0 ? 2130706431 : 1} ${g.ip} ${g.port} ${g.rest}`,
      messageType: "iceCandidate", sdpMLineIndex: "0", sdpMid: "0",
    }));
    out.push({ candidate: "a=end-of-candidates", messageType: "iceCandidate", sdpMLineIndex: "0", sdpMid: "0" });
    return out;
  }

  async function handleIce(req) {
    const res = await NATIVE_FETCH(req);
    if (!S.preferIpv6) return res;
    try {
      const text = await res.clone().text();
      if (!text) return res;
      const obj = JSON.parse(text);
      obj.exchangeResponse = JSON.stringify(updateIceCandidates(JSON.parse(obj.exchangeResponse)));
      log("ICE candidates reordered (IPv6 first)");
      return jsonResponse(obj, res);
    } catch (e) { warn("ICE patch failed", e); return res; }
  }

  window.fetch = function (input, init) {
    let url;
    try { url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url || ""; } catch (e) { url = ""; }
    if (isBlocked(url)) return Promise.resolve(new Response(null, { status: 204 }));
    try {
      if (url.includes("gssv-play-prod") || url.includes("xhome.gssv")) {
        // Pick the route BEFORE building a Request: new Request(input) consumes input's body,
        // so any request we pass through afterwards would fail ("Request object already used").
        const method = String((init && init.method) || (input instanceof Request ? input.method : "GET")).toUpperCase();
        const path = url.split("?")[0];
        let handler = null;
        if (path.endsWith("/v2/login/user")) handler = handleLogin;
        else if (/\/sessions\/cloud\/play$/.test(path) && method === "POST") handler = handlePlay;
        else if (/\/sessions\/.+\/ice$/.test(path) && method === "GET") handler = handleIce;
        if (handler) return handler(new Request(input, init));
      }
    } catch (e) { warn("fetch hook error", e); }
    return NATIVE_FETCH.apply(this, arguments);
  };

  const xOpen = XMLHttpRequest.prototype.open;
  const xSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__xpUrl = String(u); return xOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    if (this.__xpUrl && isBlocked(this.__xpUrl)) {
      Object.defineProperty(this, "readyState", { value: 4 });
      Object.defineProperty(this, "status", { value: 204 });
      setTimeout(() => { this.onreadystatechange && this.onreadystatechange(); this.dispatchEvent(new Event("load")); }, 0);
      return;
    }
    return xSend.apply(this, arguments);
  };
  if (navigator.sendBeacon) {
    const nb = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (u, d) => (isBlocked(String(u)) ? true : nb(u, d));
  }

  // ======================= WebRTC hooks =======================
  function preferH264(sdp, pref) {
    const prefix = pref === "high" ? "4d" : pref === "low" ? "420" : "42e";
    const ids = [];
    for (const m of sdp.matchAll(/a=fmtp:(\d+).*profile-level-id=([0-9a-f]{6})/gi)) if (m[2].toLowerCase().startsWith(prefix)) ids.push(m[1]);
    if (!ids.length) return sdp;
    const lines = sdp.split("\r\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith("m=video")) continue;
      const p = lines[i].trim().split(" ");
      lines[i] = p.slice(0, 3).concat(ids, p.slice(3).filter((x) => !ids.includes(x))).join(" ");
      break;
    }
    log(`H.264 ${pref} profile preferred`);
    return lines.join("\r\n");
  }

  function capBitrate(sdp, kbps) {
    const lines = sdp.split("\r\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith("m=video")) continue;
      let j = i + 1;
      while (j < lines.length && (lines[j].startsWith("i=") || lines[j].startsWith("c="))) j++;
      if (lines[j] && lines[j].startsWith("b=AS:")) lines[j] = `b=AS:${kbps}`;
      else lines.splice(j, 0, `b=AS:${kbps}`);
      break;
    }
    log(`Video bitrate capped at ${kbps} kbps`);
    return lines.join("\r\n");
  }

  if (window.RTCPeerConnection) {
    const P = RTCPeerConnection.prototype;
    const nativeSLD = P.setLocalDescription;
    P.setLocalDescription = function (desc) {
      STATE.pc = this;
      try {
        if (desc && desc.sdp) {
          let sdp = desc.sdp;
          if (S.codec !== "default") sdp = preferH264(sdp, S.codec);
          if (S.maxBitrate > 0) sdp = capBitrate(sdp, Math.round(S.maxBitrate * 1000));
          if (sdp !== desc.sdp) arguments[0] = { type: desc.type, sdp };
        }
      } catch (e) { warn("SDP patch failed", e); }
      return nativeSLD.apply(this, arguments);
    };
    const NativePC = window.RTCPeerConnection;
    window.RTCPeerConnection = new Proxy(NativePC, {
      construct(t, args, nt) {
        const pc = Reflect.construct(t, args, nt);
        STATE.pc = pc;
        pc.addEventListener("track", onTrack);
        pc.addEventListener("connectionstatechange", () => {
          log("connection:", pc.connectionState);
          if (pc.connectionState === "connected") onStreamStarted();
          if (["closed", "failed", "disconnected"].includes(pc.connectionState)) onStreamStopped();
        });
        log("PeerConnection created");
        return pc;
      },
    });
  }

  // ======================= Audio boost =======================
  let audioCtx, gainNode, boostedTrackId;
  function onTrack(e) {
    if (e.track.kind === "audio") setupAudio(e.track);
    if (e.track.kind === "video") setTimeout(applyVideo, 500);
  }
  function setupAudio(track) {
    if (S.audioBoost === 100 && !audioCtx) return;
    try {
      audioCtx = audioCtx || new AudioContext();
      if (boostedTrackId === track.id) return;
      boostedTrackId = track.id;
      const src = audioCtx.createMediaStreamSource(new MediaStream([track]));
      gainNode = audioCtx.createGain();
      gainNode.gain.value = S.audioBoost / 100;
      src.connect(gainNode).connect(audioCtx.destination);
      muteOriginalAudio(track);
      log("Audio boost active:", S.audioBoost + "%");
    } catch (e) { warn("audio boost failed", e); }
  }
  function muteOriginalAudio(track) {
    const tick = () => {
      document.querySelectorAll("audio,video").forEach((m) => {
        const so = m.srcObject;
        if (so && so.getAudioTracks && so.getAudioTracks().some((t) => t.id === track.id)) m.muted = true;
      });
    };
    tick(); setTimeout(tick, 1000); setTimeout(tick, 3000);
  }
  const resumeAudio = () => audioCtx && audioCtx.state === "suspended" && audioCtx.resume();
  ["click", "keydown", "pointerdown"].forEach((t) => window.addEventListener(t, resumeAudio, true));

  // ======================= Video filters =======================
  const FILTER_ID = "xcloud-plus-sharpen";
  function streamVideo() {
    return [...document.querySelectorAll("video")].find((v) => v.srcObject && v.srcObject.getVideoTracks && v.srcObject.getVideoTracks().length);
  }
  function ensureSvg() {
    if (document.getElementById(FILTER_ID)) return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden");
    svg.innerHTML = `<defs><filter id="${FILTER_ID}" color-interpolation-filters="sRGB"><feConvolveMatrix id="${FILTER_ID}-k" order="3" preserveAlpha="true" kernelMatrix="0 0 0 0 1 0 0 0 0"/></filter></defs>`;
    (document.body || document.documentElement).appendChild(svg);
  }
  function cssFilter(includeSharpen) {
    const p = [];
    if (includeSharpen && S.sharpness > 0) {
      ensureSvg();
      const a = S.sharpness * 0.12, c = 1 + 4 * a;
      document.getElementById(`${FILTER_ID}-k`).setAttribute("kernelMatrix", `0 ${-a} 0 ${-a} ${c} ${-a} 0 ${-a} 0`);
      p.push(`url(#${FILTER_ID})`);
    }
    if (S.brightness !== 100) p.push(`brightness(${S.brightness / 100})`);
    if (S.contrast !== 100) p.push(`contrast(${S.contrast / 100})`);
    if (S.saturation !== 100) p.push(`saturate(${S.saturation / 100})`);
    return p.join(" ");
  }
  function applyVideo() {
    const v = streamVideo();
    if (v) v.style.filter = cssFilter(true);
    if (gainNode) gainNode.gain.value = S.audioBoost / 100;
  }

  // ======================= Screenshot =======================
  function screenshot() {
    const v = streamVideo();
    if (!v || !v.videoWidth) return toast("No stream to capture");
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    const ctx = c.getContext("2d");
    ctx.filter = cssFilter(false) || "none";
    ctx.drawImage(v, 0, 0);
    c.toBlob((b) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `xcloud-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast("Screenshot saved");
    }, "image/png");
  }

  // ======================= Stats overlay =======================
  const STAT_LABELS = { time: "Time", ping: "Ping", fps: "FPS", res: "Res", btr: "Bitrate", dt: "Decode", pl: "Pkt lost", fl: "Frm lost", jit: "Jitter", dl: "Data", region: "Server" };
  let statsEl, statsTimer, lastVideo, playStart = 0;
  const human = (b) => (b > 1e9 ? (b / 1e9).toFixed(2) + " GB" : (b / 1e6).toFixed(1) + " MB");
  const grade = (v, g) => (v > g[2] ? "#ff5555" : v > g[1] ? "#ffb02e" : v > g[0] ? "#7fd17f" : "#fff");

  async function collectStats() {
    const pc = STATE.pc;
    if (!pc || pc.connectionState !== "connected") return null;
    const stats = await pc.getStats();
    const out = {};
    let pairId;
    stats.forEach((s) => { if (s.type === "transport" && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId; });
    stats.forEach((s) => {
      if (s.type === "inbound-rtp" && s.kind === "video") {
        out.res = `${s.frameWidth || "?"}x${s.frameHeight || "?"}`;
        out.fps = s.framesPerSecond || 0;
        out.pl = Math.max(0, s.packetsLost || 0); out.plRecv = s.packetsReceived || 0;
        out.fl = s.framesDropped || 0; out.flRecv = s.framesReceived || 0;
        out.dl = s.bytesReceived || 0;
        if (lastVideo) {
          const td = s.timestamp - lastVideo.timestamp;
          if (td > 0) out.btr = ((s.bytesReceived - lastVideo.bytesReceived) * 8) / td / 1000;
          const ec = s.jitterBufferEmittedCount - lastVideo.jitterBufferEmittedCount;
          if (ec > 0) out.jit = ((s.jitterBufferDelay - lastVideo.jitterBufferDelay) / ec) * 1000;
          const fd = s.framesDecoded - lastVideo.framesDecoded;
          if (fd > 0) out.dt = ((s.totalDecodeTime - lastVideo.totalDecodeTime) / fd) * 1000;
        }
        lastVideo = s;
      } else if (s.type === "candidate-pair" && s.id === pairId) {
        out.ping = s.currentRoundTripTime != null ? Math.round(s.currentRoundTripTime * 1000) : null;
      }
    });
    return out;
  }

  async function renderStats() {
    if (!statsEl) return;
    const s = await collectStats();
    if (!s) { statsEl.innerHTML = `<span>waiting for stream…</span>`; return; }
    const pct = (d, r) => { const p = (d * 100) / (d + r || 1); return p < 1 ? String(d) : `${d} (${p.toFixed(1)}%)`; };
    const val = {
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) + (playStart ? ` · ${Math.floor((Date.now() - playStart) / 60000)}m` : ""),
      ping: s.ping != null ? [`${s.ping}ms`, grade(s.ping, [40, 75, 100])] : "?",
      fps: s.fps,
      res: s.res,
      btr: s.btr != null ? `${s.btr.toFixed(1)} Mbps` : "…",
      dt: s.dt != null ? [`${s.dt.toFixed(1)}ms`, grade(s.dt, [6, 9, 12])] : "…",
      pl: pct(s.pl, s.plRecv),
      fl: pct(s.fl, s.flRecv),
      jit: s.jit != null ? [`${s.jit.toFixed(1)}ms`, grade(s.jit, [30, 40, 60])] : "…",
      dl: human(s.dl),
      region: STATE.selectedRegion || "?",
    };
    statsEl.innerHTML = S.statsItems.concat(["region"]).filter((k) => k in val).map((k) => {
      const v = val[k], [t, c] = Array.isArray(v) ? v : [v, "#fff"];
      return `<span><b>${STAT_LABELS[k]}</b> <i style="color:${c}">${t}</i></span>`;
    }).join("");
  }

  function toggleStats(force) {
    const show = force != null ? force : !statsEl;
    if (show && !statsEl) {
      statsEl = document.createElement("div");
      statsEl.id = "xcloud-plus-stats";
      (document.body || document.documentElement).appendChild(statsEl);
      statsTimer = setInterval(renderStats, 1000);
      renderStats();
    } else if (!show && statsEl) {
      clearInterval(statsTimer); statsEl.remove(); statsEl = null;
    }
  }

  function onStreamStarted() {
    playStart = Date.now(); lastVideo = null;
    applyVideo();
    if (S.statsOnStart) toggleStats(true);
  }
  function onStreamStopped() { playStart = 0; toggleStats(false); }

  // ======================= Keyboard & mouse -> virtual controller =======================
  // Standard gamepad button indices.
  const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16 };
  const KEYMAP = {
    Space: B.A, KeyC: B.B, ControlLeft: B.B, KeyR: B.X, KeyV: B.Y,
    KeyQ: B.LB, KeyE: B.RB, ShiftLeft: B.LS, KeyF: B.RS,
    Tab: B.VIEW, Enter: B.MENU, KeyG: B.HOME,
    ArrowUp: B.UP, ArrowDown: B.DOWN, ArrowLeft: B.LEFT, ArrowRight: B.RIGHT,
    Digit1: B.UP, Digit2: B.RIGHT, Digit3: B.DOWN, Digit4: B.LEFT,
  };
  const MOUSEMAP = { 0: B.RT, 2: B.LT, 1: B.RS, 3: B.LB, 4: B.RB };
  const STICK_KEYS = { KeyW: [1, -1], KeyS: [1, 1], KeyA: [0, -1], KeyD: [0, 1] };

  const MKB = { on: false, buttons: new Array(17).fill(0), held: new Set(), rx: 0, ry: 0, lastMove: 0, ts: 0, pad: null };

  function makeVirtualPad(index) {
    const pad = Object.create(window.Gamepad ? Gamepad.prototype : Object.prototype);
    const def = (k, get) => Object.defineProperty(pad, k, { get, enumerable: true, configurable: true });
    def("id", () => "Xbox 360 Controller (XInput STANDARD GAMEPAD)");
    def("index", () => index);
    def("connected", () => MKB.on);
    def("mapping", () => "standard");
    def("timestamp", () => MKB.ts);
    def("vibrationActuator", () => null);
    def("hapticActuators", () => []);
    def("axes", () => {
      let lx = 0, ly = 0;
      for (const [code, [axis, dir]] of Object.entries(STICK_KEYS)) if (MKB.held.has(code)) axis === 0 ? (lx += dir) : (ly += dir);
      if (lx && ly) { lx *= Math.SQRT1_2; ly *= Math.SQRT1_2; }
      if (performance.now() - MKB.lastMove > 50) { MKB.rx *= 0.5; MKB.ry *= 0.5; if (Math.abs(MKB.rx) < 0.01) MKB.rx = 0; if (Math.abs(MKB.ry) < 0.01) MKB.ry = 0; }
      return [lx, ly, MKB.rx, MKB.ry];
    });
    def("buttons", () => MKB.buttons.map((v) => ({ pressed: v > 0.1, touched: v > 0, value: v })));
    return pad;
  }

  const nativeGetGamepads = navigator.getGamepads ? navigator.getGamepads.bind(navigator) : () => [];
  navigator.getGamepads = function () {
    const real = Array.from(nativeGetGamepads() || []);
    if (!MKB.on) return real;
    let slot = real.findIndex((p) => !p);
    if (slot === -1) slot = real.length;
    if (!MKB.pad || MKB.pad.index !== slot) MKB.pad = makeVirtualPad(slot);
    real[slot] = MKB.pad;
    return real;
  };

  function fireGamepadEvent(type) {
    const ev = new Event(type);
    Object.defineProperty(ev, "gamepad", { value: MKB.pad });
    window.dispatchEvent(ev);
  }

  function setMkb(on) {
    if (on === MKB.on) return;
    MKB.on = on;
    MKB.buttons.fill(0); MKB.held.clear(); MKB.rx = MKB.ry = 0;
    if (on) {
      navigator.getGamepads(); // creates the pad in a free slot
      fireGamepadEvent("gamepadconnected");
      toast("Keyboard & mouse ON - click the game to lock the mouse, F8 to turn off");
    } else {
      fireGamepadEvent("gamepaddisconnected");
      if (document.pointerLockElement) document.exitPointerLock();
      toast("Keyboard & mouse OFF");
    }
    log("MKB", on ? "enabled" : "disabled");
  }

  // The site polls the gamepad only ~20x/s in menus, so a quick tap could fall between polls.
  // Hold every press for at least MIN_HOLD ms.
  const MIN_HOLD = 90;
  const pressedAt = {};
  const press = (btn, v) => {
    const now = performance.now();
    if (v) { pressedAt[btn] = now; MKB.buttons[btn] = v; MKB.ts = now; return; }
    const wait = MIN_HOLD - (now - (pressedAt[btn] || 0));
    const release = () => { MKB.buttons[btn] = 0; MKB.ts = performance.now(); };
    wait > 0 ? setTimeout(release, wait) : release();
  };
  const inUi = (e) => e.target && e.target.closest && e.target.closest("#xcloud-plus-panel,#xcloud-plus-fab");

  window.addEventListener("keydown", (e) => {
    if (e.code === "F8" && !e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); setMkb(!MKB.on); return; }
    if (!MKB.on || inUi(e) || e.altKey || e.ctrlKey && e.code !== "ControlLeft") return;
    if (e.code in KEYMAP || e.code in STICK_KEYS) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.repeat) return;
      MKB.held.add(e.code);
      if (e.code in KEYMAP) press(KEYMAP[e.code], 1);
      MKB.ts = performance.now();
    }
  }, true);
  window.addEventListener("keyup", (e) => {
    if (!MKB.on || !(e.code in KEYMAP || e.code in STICK_KEYS)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    MKB.held.delete(e.code);
    if (e.code in KEYMAP && ![...MKB.held].some((c) => KEYMAP[c] === KEYMAP[e.code])) press(KEYMAP[e.code], 0);
    MKB.ts = performance.now();
  }, true);

  window.addEventListener("mousedown", (e) => {
    if (!MKB.on || inUi(e) || !streamVideo()) return;
    if (!document.pointerLockElement) { document.documentElement.requestPointerLock(); e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (e.button in MOUSEMAP) { press(MOUSEMAP[e.button], 1); e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  window.addEventListener("mouseup", (e) => {
    if (!MKB.on || !(e.button in MOUSEMAP)) return;
    press(MOUSEMAP[e.button], 0); e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  window.addEventListener("contextmenu", (e) => { if (MKB.on && document.pointerLockElement) e.preventDefault(); }, true);
  window.addEventListener("mousemove", (e) => {
    if (!MKB.on || !document.pointerLockElement) return;
    const k = S.mouseSens / 1000;
    const clamp = (v) => Math.max(-1, Math.min(1, v));
    MKB.rx = clamp(e.movementX * k);
    MKB.ry = clamp(e.movementY * k * (S.invertY ? -1 : 1));
    MKB.lastMove = performance.now(); MKB.ts = MKB.lastMove;
    e.stopImmediatePropagation();
  }, true);
  window.addEventListener("wheel", (e) => {
    if (!MKB.on || !document.pointerLockElement) return;
    const btn = e.deltaY < 0 ? B.RB : B.LB; // scroll = cycle weapons
    press(btn, 1); press(btn, 0);
    e.preventDefault(); e.stopImmediatePropagation();
  }, { capture: true, passive: false });
  window.addEventListener("blur", () => { if (MKB.on) { MKB.buttons.fill(0); MKB.held.clear(); } });

  // ======================= UI =======================
  const CSS = `
  #xcloud-plus-stats{position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2147483646;display:flex;gap:12px;
    padding:4px 10px;background:rgba(0,0,0,.65);color:#fff;font:12px/1.4 Consolas,"Segoe UI",monospace;border-radius:0 0 6px 6px;pointer-events:none;white-space:nowrap}
  #xcloud-plus-stats b{color:#9a9a9a;font-weight:normal}#xcloud-plus-stats i{font-style:normal}
  #xcloud-plus-panel{position:fixed;top:16px;right:16px;z-index:2147483647;width:320px;max-height:calc(100vh - 32px);overflow:auto;padding:14px;
    background:rgba(18,18,18,.96);color:#eee;font:13px/1.4 "Segoe UI",Arial,sans-serif;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,.6);display:none}
  #xcloud-plus-panel h3{margin:0 0 6px;font-size:15px;color:#7fd17f}
  #xcloud-plus-panel h4{margin:12px 0 4px;font-size:12px;color:#9a9a9a;text-transform:uppercase;letter-spacing:.05em}
  #xcloud-plus-panel label{display:flex;justify-content:space-between;align-items:center;margin:6px 0;gap:8px}
  #xcloud-plus-panel select,#xcloud-plus-panel input[type=range]{width:150px}
  #xcloud-plus-panel select{background:#2a2a2a;color:#eee;border:1px solid #444;border-radius:4px;padding:2px}
  #xcloud-plus-panel .note{font-size:11px;color:#999;margin-top:8px}
  #xcloud-plus-panel .row{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
  #xcloud-plus-panel button{background:#107c10;color:#fff;border:0;border-radius:4px;padding:5px 10px;cursor:pointer}
  #xcloud-plus-panel button.sec{background:#3a3a3a}
  #xcloud-plus-fab{position:fixed;left:16px;bottom:16px;z-index:2147483646;display:flex;align-items:center;gap:6px;
    padding:8px 12px;background:rgba(16,124,16,.92);color:#fff;border:0;border-radius:20px;cursor:pointer;
    font:600 13px "Segoe UI",Arial,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.5);transition:opacity .3s}
  #xcloud-plus-fab:hover{background:#13a10e}
  #xcloud-plus-fab.dim{opacity:0;pointer-events:none}
  #xcloud-plus-panel .close{position:absolute;top:8px;right:10px;background:none;color:#aaa;font-size:18px;padding:0 6px}
  #xcloud-plus-panel .mkb-state{font-weight:600}
  #xcloud-plus-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:2147483647;background:rgba(0,0,0,.8);color:#fff;
    padding:6px 14px;border-radius:6px;font:13px "Segoe UI",sans-serif;pointer-events:none}`;

  function toast(msg) {
    const t = document.createElement("div");
    t.id = "xcloud-plus-toast"; t.textContent = msg;
    (document.body || document.documentElement).appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }

  let panel;
  function buildPanel() {
    panel = document.createElement("div");
    panel.id = "xcloud-plus-panel";
    const regionOpts = [`<option value="default">Default (Xbox picks)</option>`]
      .concat(STATE.regions.map((r) => `<option value="${r.name}">${r.name}${r.isDefault ? " (default)" : ""}</option>`)).join("");
    panel.innerHTML = `
      <button class="close" data-act="close" title="Close (Alt+X)">×</button>
      <h3>xCloud Plus</h3>
      <h4>Stream (applies next launch)</h4>
      <label>Resolution<select data-k="resolution"><option value="auto">Auto</option><option value="720p">720p</option><option value="1080p">1080p</option><option value="1080p-hq">1080p (HQ)</option></select></label>
      <label>H.264 profile<select data-k="codec"><option value="default">Default</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label>
      <label>Max bitrate <span data-v="maxBitrate"></span><input type="range" min="0" max="40" step="1" data-k="maxBitrate"></label>
      <label>Server region<select data-k="region">${regionOpts}</select></label>
      <label>Prefer IPv6 server<input type="checkbox" data-k="preferIpv6"></label>
      <h4>Video &amp; audio (live)</h4>
      <label>Sharpness <span data-v="sharpness"></span><input type="range" min="0" max="10" step="1" data-k="sharpness"></label>
      <label>Brightness <span data-v="brightness"></span><input type="range" min="50" max="150" step="5" data-k="brightness"></label>
      <label>Contrast <span data-v="contrast"></span><input type="range" min="50" max="150" step="5" data-k="contrast"></label>
      <label>Saturation <span data-v="saturation"></span><input type="range" min="50" max="150" step="5" data-k="saturation"></label>
      <label>Volume <span data-v="audioBoost"></span><input type="range" min="100" max="300" step="10" data-k="audioBoost"></label>
      <h4>Keyboard &amp; mouse (F8)</h4>
      <label>Virtual controller <span class="mkb-state" data-mkb></span><button data-act="mkb">Toggle</button></label>
      <label>Mouse sensitivity <span data-v="mouseSens"></span><input type="range" min="10" max="200" step="5" data-k="mouseSens"></label>
      <label>Invert mouse Y<input type="checkbox" data-k="invertY"></label>
      <div class="note">WASD move · Mouse aim · LMB fire (RT) · RMB aim (LT) · Space A · C/Ctrl B · R X · V Y · Q LB · E RB · Shift L3 · F R3 · Wheel LB/RB · Tab View · Enter Menu · G Xbox · Arrows/1-4 D-pad. Esc releases the mouse.</div>
      <h4>Other</h4>
      <label>Stats bar on stream start<input type="checkbox" data-k="statsOnStart"></label>
      <label>Block tracking (reload)<input type="checkbox" data-k="blockTracking"></label>
      <div class="row"><button data-act="stats">Toggle stats</button><button data-act="shot">Screenshot</button><button class="sec" data-act="reset">Reset video</button></div>
      <div class="note">Alt+X panel · Alt+Z stats · Alt+C screenshot. Region list fills after the page loads once while signed in. Volume above 100% needs a launch with it already set.</div>`;
    (document.body || document.documentElement).appendChild(panel);

    const refresh = () => {
      panel.querySelectorAll("[data-k]").forEach((el) => { const k = el.dataset.k; if (el.type === "checkbox") el.checked = !!S[k]; else el.value = S[k]; });
      const ms = panel.querySelector("[data-mkb]");
      if (ms) { ms.textContent = MKB.on ? "ON" : "OFF"; ms.style.color = MKB.on ? "#7fd17f" : "#999"; }
      panel.querySelectorAll("[data-v]").forEach((el) => {
        const k = el.dataset.v, v = S[k];
        el.textContent = k === "maxBitrate" ? (v ? v + " Mbps" : "off") : ["brightness", "contrast", "saturation", "audioBoost"].includes(k) ? v + "%" : v;
      });
    };
    const onChange = (e) => {
      const el = e.target, k = el.dataset && el.dataset.k;
      if (!k) return;
      S[k] = el.type === "checkbox" ? el.checked : el.type === "range" ? Number(el.value) : el.value;
      save(); refresh(); applyVideo();
    };
    panel.addEventListener("input", onChange);
    panel.addEventListener("change", onChange);
    panel.addEventListener("click", (e) => {
      const a = e.target.dataset && e.target.dataset.act;
      if (a === "close") { togglePanel(); return; }
      if (a === "mkb") { setMkb(!MKB.on); refresh(); }
      if (a === "stats") toggleStats();
      if (a === "shot") screenshot();
      if (a === "reset") { Object.assign(S, { sharpness: 0, brightness: 100, contrast: 100, saturation: 100 }); save(); refresh(); applyVideo(); }
    });
    ["keydown", "keyup", "keypress", "mousedown", "mouseup", "wheel", "pointerdown"].forEach((t) => panel.addEventListener(t, (e) => e.stopPropagation()));
    refresh();
  }
  function togglePanel() {
    if (panel) { panel.remove(); panel = null; return; }
    buildPanel(); // rebuilt each time so the region list is current
    panel.style.display = "block";
  }

  window.addEventListener("keydown", (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    if (k === "x") togglePanel();
    else if (k === "z") toggleStats();
    else if (k === "c") screenshot();
    else return;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);

  // adoptedStyleSheets survive React replacing <head>; fall back to a <style> tag that re-attaches itself.
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch (e) {
    const style = document.createElement("style");
    style.textContent = CSS;
    const attach = () => { if (!style.isConnected) (document.head || document.documentElement).appendChild(style); };
    attach(); setInterval(attach, 2000);
  }

  // Re-apply filters when the stream video element is swapped.
  const startObserver = () => new MutationObserver(() => { const v = streamVideo(); if (v && !v.__xp) { v.__xp = 1; applyVideo(); } })
    .observe(document.documentElement, { childList: true, subtree: true });
  if (document.documentElement) startObserver(); else document.addEventListener("DOMContentLoaded", startObserver, { once: true });

  // Floating menu button (bottom-left). Fades out during a stream when the mouse is idle.
  let fab, idleTimer;
  function addFab() {
    if (fab || !document.body) return;
    fab = document.createElement("button");
    fab.id = "xcloud-plus-fab";
    fab.type = "button";
    fab.title = "xCloud Plus settings (Alt+X)";
    fab.textContent = "⚙ xCloud+";
    ["mousedown", "pointerdown", "mouseup"].forEach((t) => fab.addEventListener(t, (e) => e.stopPropagation()));
    fab.addEventListener("click", (e) => { e.stopPropagation(); togglePanel(); });
    document.body.appendChild(fab);
  }
  function wakeFab() {
    if (!fab) return;
    fab.classList.remove("dim");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (streamVideo() && !panel) fab.classList.add("dim"); }, 3000);
  }
  window.addEventListener("mousemove", () => { if (!document.pointerLockElement) wakeFab(); }, { passive: true });
  document.addEventListener("pointerlockchange", () => fab && fab.classList.toggle("dim", !!document.pointerLockElement));
  if (document.body) addFab(); else document.addEventListener("DOMContentLoaded", addFab, { once: true });
  // The app may re-render <body>; keep the button attached.
  setInterval(() => { if (fab && !fab.isConnected && document.body) document.body.appendChild(fab); }, 2000);

  log(`v${window.__XCLOUD_PLUS__} loaded at document-start. Alt+X or the ⚙ button for settings.`);
})();
