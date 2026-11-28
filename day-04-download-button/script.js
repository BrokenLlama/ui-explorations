const btn = document.getElementById("dl");
const pupils = [...btn.querySelectorAll(".pupil")];
const eyesEl = btn.querySelector(".dl-eyes");
const label = btn.querySelector(".dl-label");
const ringFill = btn.querySelector(".progress-fill");

const RING_C = 119.4;
const FLOOD_IN = 300;
const DOWNLOAD_MS = 3200;
const DONE_HOLD_MS = 1600;
const FLOOD_OUT = 280;
/* Beat on a full ring before the label crossfades to "complete" */
const FULL_BEAT_MS = 200;

const LABEL_IDLE = "Download now";
const LABEL_BUSY = "Downloading…";
const LABEL_DONE = "Download complete";

/* Generation counter: every setInk/restore bumps it to invalidate async work */
let cycle = 0;

function showLabel(which) {
  btn.querySelectorAll(".lab").forEach((el) => {
    el.classList.toggle("on", el.classList.contains(`lab-${which}`));
  });
}

/* Content (eyes/label/aria) swaps at toggle time, keyed to the flood covering
   it — not when the flood finishes. The flood and progress ring just continue
   the state visually. */
function showBusyContent() {
  btn.classList.add("show-progress");
  btn.classList.remove("show-done");
  showLabel("busy");
  btn.setAttribute("aria-label", LABEL_BUSY);
  btn.setAttribute("aria-busy", "true");
  ringFill.style.strokeDashoffset = String(RING_C);
}

function showIdleContent() {
  btn.classList.remove("show-progress", "show-done");
  showLabel("idle");
  btn.setAttribute("aria-label", LABEL_IDLE);
  btn.setAttribute("aria-busy", "false");
  ringFill.style.strokeDashoffset = String(RING_C);
}

function completeDownload(my) {
  if (my !== cycle) return;
  btn.classList.add("show-done");
  showLabel("done");
  if (!reduceMotion) {
    btn.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(1.07)", offset: 0.35 },
        { transform: "scale(1)" }
      ],
      { duration: 450, easing: "cubic-bezier(0.3, 1.4, 0.4, 1)" }
    );
  }
  btn.setAttribute("aria-label", LABEL_DONE);
  btn.setAttribute("aria-busy", "false");
  setTimeout(() => {
    if (my === cycle && inked) setInk(false);
  }, DONE_HOLD_MS);
}

const params = new URLSearchParams(window.location.search);

if (params.has("embed")) {
  document.documentElement.classList.add("embed");
}

const sizeParam = parseFloat(params.get("size"));
if (Number.isFinite(sizeParam) && sizeParam > 0) {
  btn.style.setProperty("--fs", `${sizeParam}px`);
}

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* Persistent flood: black expands from the eyes' centre and latches until toggled off */
const flood = document.createElement("div");
flood.className = "flood";
flood.setAttribute("aria-hidden", "true");
btn.prepend(flood);

let inked = params.get("ink") === "1";

function floodGeometry() {
  const b = btn.getBoundingClientRect();
  const h = eyesEl.getBoundingClientRect();
  const ex = h.left + h.width / 2 - b.left;
  const ey = h.top + h.height / 2 - b.top;
  const R = Math.hypot(b.width, b.height);
  return { ex, ey, R };
}

/* The flood is driven by the one shared rAF loop, not WAAPI. Its progress is
   part of the same generation-guarded state machine as the download cycle, so
   settling can never be lost to a dropped/throttled animation finish event. */
const FLOOD_EASE = [0.3, 0.6, 0.3, 1];
let floodScale = 0; /* current rendered flood scale, 0 hidden .. 1 full */
let floodSeg = null; /* { my, from, to, dur, start } while a segment runs */
let progressSeg = null; /* { my, t0 } while the ring fills */

/* Arm the progress state; the shared frame() loop advances it. */
function startProgress(my) {
  progressSeg = { my, t0: performance.now() };
}

function paintFlood() {
  flood.style.transform = `scale(${floodScale})`;
}

/* cubic-bezier(0.3, 0.6, 0.3, 1) evaluated in JS, matching the former easing */
function easeFlood(t) {
  const [x1, y1, x2, y2] = FLOOD_EASE;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (u) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u) => ((ay * u + by) * u + cy) * u;
  const slopeX = (u) => (3 * ax * u + 2 * bx) * u + cx;
  let u = t;
  for (let i = 0; i < 6; i += 1) {
    const x = sampleX(u) - t;
    if (Math.abs(x) < 1e-5) break;
    const d = slopeX(u);
    if (Math.abs(d) < 1e-6) break;
    u -= x / d;
  }
  u = Math.min(1, Math.max(0, u));
  return sampleY(u);
}

/* Advance the running flood segment from the frame clock. Synchronous with the
   rAF loop, so a recede always reaches 0 and settles even if the tab stalls. */
function advanceFlood(now) {
  if (!floodSeg) return;
  if (floodSeg.my !== cycle) {
    floodSeg = null;
    return;
  }
  if (floodSeg.start === null) floodSeg.start = now;
  const t = floodSeg.dur > 0 ? Math.min(1, (now - floodSeg.start) / floodSeg.dur) : 1;
  floodScale = floodSeg.from + (floodSeg.to - floodSeg.from) * easeFlood(t);
  paintFlood();
  if (t < 1) return;
  const to = floodSeg.to;
  const my = floodSeg.my;
  floodScale = to;
  paintFlood();
  floodSeg = null;
  /* Reaching full starts the ring; a recede has nothing left to do — the idle
     content was already restored at toggle time. */
  if (my === cycle && to === 1) startProgress(my);
}

/* Advance the ring from the same frame clock (no second rAF chain). */
function advanceProgress(now) {
  if (!progressSeg) return;
  if (progressSeg.my !== cycle) {
    progressSeg = null;
    return;
  }
  const t = Math.min(1, (now - progressSeg.t0) / DOWNLOAD_MS);
  const eased = 1 - (1 - t) * (1 - t);
  ringFill.style.strokeDashoffset = String(RING_C * (1 - eased));
  if (t >= 1) {
    const my = progressSeg.my;
    progressSeg = null;
    /* Hold the full ring for a beat, then crossfade to the done label.
       Guarded by the same generation counter as the done-hold. */
    setTimeout(() => {
      if (my === cycle) completeDownload(my);
    }, FULL_BEAT_MS);
  }
}

function setInk(next, instant = false) {
  cycle++;
  const my = cycle;
  inked = next;
  progressSeg = null;
  btn.classList.toggle("inked", inked);
  btn.setAttribute("aria-pressed", String(inked));
  broadcastState(`ink=${inked ? 1 : 0}`);

  const { ex, ey } = floodGeometry();
  flood.style.transformOrigin = `${ex}px ${ey}px`;
  const to = inked ? 1 : 0;

  /* Swap the content up front so eyes/labels leave as the flood covers them
     and return while it recedes. */
  if (inked) showBusyContent();
  else showIdleContent();

  /* Instant path (init / ui-restore / reduced motion): snap now */
  if (instant || reduceMotion) {
    floodSeg = null;
    floodScale = to;
    paintFlood();
    if (inked) startProgress(my);
    return;
  }

  /* Animated path: hand the flood to the rAF loop. Start from wherever it is
     now, so clicks that land mid-expand/mid-recede continue smoothly. */
  floodSeg = {
    my,
    from: floodScale,
    to,
    dur: to === 1 ? FLOOD_IN : FLOOD_OUT,
    start: null,
  };
}

btn.addEventListener("click", () => {
  setInk(!inked);
});

function broadcastState(query) {
  if (window.parent === window) return;
  try {
    window.parent.postMessage({ type: "ui-state", params: query }, "*");
  } catch (_) {}
}

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "ui-restore" || typeof data.params !== "string") return;
  const q = new URLSearchParams(data.params);
  const want = q.get("ink") === "1";
  if (want === inked) return;
  setInk(want, true);
});

/* Init: restore ink state from the URL, then announce it to the gallery */
(function initInk() {
  const inkEls = [...pupils, label];
  /* A restored inked state should land instantly, not fade in on load */
  if (inked) inkEls.forEach((el) => (el.style.transition = "none"));

  setInk(inked, true);

  if (inked) {
    getComputedStyle(btn).color; /* flush the restored colors */
    requestAnimationFrame(() => {
      inkEls.forEach((el) => (el.style.transition = ""));
    });
  }
})();

/* Range (px at current font size): pupils roam on the button face */
let range = { x: 2, y: 3 };
/* Half the pupil height (1.05em), used to pin the bottom edge when squashing */
let pupilHalfH = 18;

function measure() {
  const fs = parseFloat(getComputedStyle(btn).fontSize) || 22;
  range = {
    x: Math.max(2, fs * 0.28),
    y: Math.max(3, fs * 0.48),
  };
  pupilHalfH = fs * 0.525;
  rectStamp = 0; /* force the cached rects to refresh next frame */
}

/* Rect cache: layout reads are throttled instead of forced every frame */
let cachedRect = null;
let cachedEyesRect = null;
let rectStamp = 0;

function refreshRects(now) {
  if (cachedRect && now - rectStamp < 500) return;
  rectStamp = now;
  cachedRect = btn.getBoundingClientRect();
  cachedEyesRect = eyesEl.getBoundingClientRect();
}

measure();
window.addEventListener("resize", measure);

const mouse = { x: 0, y: 0, here: false };
const eyes = pupils.map(() => ({ x: 0, y: 0, r: 0 }));
let pressed = false;
let blinkUntil = [0, 0];
let last = 0;

/* Neutral boot: stare straight ahead for 300ms on load, then engage. Uses the
   rAF clock (same as everything else) and starts on the first frame. */
const BOOT_MS = 300;
let bootUntil = 0;

/* Transient size pulses: squint on exit */
const sizes = pupils.map(() => 1);
/* Hover widens the eyes horizontally only */
const wide = pupils.map(() => 1);
let wasInside = false;
let squintUntil = 0;

/* Idle sleep + button hover state */
let lastActivity = performance.now();
let sleeping = false;
let lids = 1;
let hoveringBtn = false;

/* Cursor speed tracking + dizzy state */
let prevMX = 0;
let prevMY = 0;
let prevMT = 0;
let lastSpeed = 0;
let hotTime = 0;
let dizzyUntil = 0;
let dizzyStart = 0;
let calmUntil = 0;

window.addEventListener("mousemove", (e) => {
  const now = performance.now();
  const dtm = now - prevMT;
  if (prevMT && dtm > 0) {
    lastSpeed = Math.hypot(e.clientX - prevMX, e.clientY - prevMY) / (dtm / 1000);
  }
  prevMX = e.clientX;
  prevMY = e.clientY;
  prevMT = now;
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  mouse.here = true;
  lastActivity = now;
  sleeping = false;
});
document.addEventListener("mouseleave", () => {
  mouse.here = false;
});

btn.addEventListener("pointerdown", () => {
  pressed = true;
  btn.classList.add("is-down");
});
const lift = () => {
  pressed = false;
  btn.classList.remove("is-down");
};
btn.addEventListener("pointerup", lift);
btn.addEventListener("pointercancel", lift);

btn.addEventListener("pointerenter", () => {
  hoveringBtn = true;
});
btn.addEventListener("pointerleave", () => {
  hoveringBtn = false;
});

/* Occasional blink, second eye a beat behind */
function scheduleBlink() {
  setTimeout(() => {
    const now = performance.now();
    blinkUntil = [now + 130, now + 175];
    scheduleBlink();
  }, 2600 + Math.random() * 2800);
}
if (!reduceMotion) scheduleBlink();

function frame(now) {
  const dt = Math.min(64, now - last || 16) / 1000;
  last = now;

  refreshRects(now);

  if (bootUntil === 0) bootUntil = now + BOOT_MS;
  const booting = now < bootUntil;

  advanceFlood(now);
  advanceProgress(now);

  /* Sleep after 7s of stillness; a parked cursor on the button keeps it awake */
  if (!reduceMotion && now - lastActivity > 7000 && !hoveringBtn) sleeping = true;
  lids += ((sleeping ? 0.06 : 1) - lids) * (1 - Math.exp(-2.5 * dt));

  const rect = cachedRect;
  const hr = cachedEyesRect;
  const cx = hr.left + hr.width / 2;
  const cy = hr.top + hr.height / 2;
  const headR = rect.height / 2;
  /* equal detection margin beyond the pill on all four sides */
  const margin = Math.max(280, headR * 6);
  const inZone =
    mouse.x >= rect.left - margin &&
    mouse.x <= rect.right + margin &&
    mouse.y >= rect.top - margin &&
    mouse.y <= rect.bottom + margin;

  const insideNow = mouse.here && inZone && !reduceMotion;

  /* Dizzy: 1.5s of sustained aggressive movement near the eyes */
  const dtMs = dt * 1000;
  const aggressive =
    mouse.here &&
    now >= calmUntil &&
    now - prevMT < 120 &&
    Math.hypot(mouse.x - cx, mouse.y - cy) < 700 &&
    lastSpeed > 900 &&
    !reduceMotion &&
    !booting;

  if (aggressive) {
    hotTime += dtMs;
  } else {
    hotTime = Math.max(0, hotTime - dtMs * 3);
  }

  if (hotTime >= 1500 && now > calmUntil && !reduceMotion && !booting) {
    hotTime = 0;
    dizzyStart = now;
    dizzyUntil = now + 1100;
    calmUntil = now + 1700;
  }

  /* Tracking is paused while regaining calm after a dizzy spell, and during boot */
  const active = insideNow && now >= calmUntil && !booting;

  let strength = 0;
  let nx = 0;
  let ny = 0;
  if (active) {
    const dx = mouse.x - cx;
    const dy = mouse.y - cy;
    const dist = Math.hypot(dx, dy);
    strength = Math.min(1, dist / (headR * 3.3));
    nx = dx / (dist || 1);
    ny = dy / (dist || 1);
  }

  const k = 1 - Math.exp(-10 * dt);

  /* Target roam position; asleep, tracking goes slack and droops down */
  let txTarget = nx * strength * range.x;
  let tyTarget = ny * strength * range.y;
  if (sleeping) {
    txTarget = 0;
    tyTarget = range.y * 0.35;
  }
  /* Boot wins over sleep: force a neutral, straight-ahead stare */
  if (booting) {
    txTarget = 0;
    tyTarget = 0;
  }

  /* Edge-triggered pulse: squint on exit. Suppressed during boot, but keep
     `wasInside` current so boot ending never fires a stale exit pulse. */
  if (!booting && !insideNow && wasInside) {
    squintUntil = now + 500;
  }
  wasInside = insideNow;

  eyes.forEach((eye, i) => {
    eye.x += (txTarget - eye.x) * k;
    eye.y += (tyTarget - eye.y) * k;

    /* Lean follows the horizontal target, so it settles to 0 while asleep */
    const leanTarget = (tyTarget >= 0 ? 1 : -1) * (txTarget / (range.x || 1)) * 14;
    eye.r += (leanTarget - eye.r) * k;

    let rx = eye.x;
    let ry = eye.y;
    let rr = eye.r;
    /* Dizzy: rapid side-to-side head shake, easing out as the spell decays */
    if (now < dizzyUntil) {
      const t = now - dizzyStart;
      const decay = Math.max(0, 1 - t / 1100);
      rx += (Math.sin(t * 0.045) * 9 + Math.sin(t * 0.09 + 1.0) * 2) * decay;
      ry += Math.sin(t * 0.03 + 0.4) * 1.5 * decay;
      rr += Math.sin(t * 0.045 + 0.5) * 3 * decay;
    }

    const blinking = now < blinkUntil[i] ? 0.12 : 1;
    const squint = pressed && !booting ? 0.55 : 1;
    /* up: squash toward 0.7× (as before); down: shorten just a touch from the top, bottom edge pinned */
    const t = eye.y / (range.y || 1);
    let syPersp = 1;
    let anchorShift = 0;
    if (t <= 0) {
      syPersp = 1 + t * 0.3;
    } else {
      syPersp = 1 - t * 0.12;
      anchorShift = (1 - syPersp) * pupilHalfH;
    }
    /* transient uniform size: exit squint narrows (hover widening lives in `wide`) */
    let targetSz = 1;
    if (now < squintUntil) {
      targetSz *= 0.82;
    }
    sizes[i] += (targetSz - sizes[i]) * k;

    /* hover widens horizontally, with a half-rate rounder follow vertically */
    const wideTarget = hoveringBtn && !booting ? 1.3 : 1;
    wide[i] += (wideTarget - wide[i]) * k;
    const roundFactor = 1 + (wide[i] - 1) * 0.5;

    pupils[i].style.transform =
      `translate(${rx.toFixed(2)}px, ${(ry + anchorShift).toFixed(2)}px) rotate(${rr.toFixed(2)}deg) scale(${(sizes[i] * wide[i]).toFixed(3)}, ${(sizes[i] * syPersp * blinking * squint * lids * roundFactor).toFixed(3)})`;
  });

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
