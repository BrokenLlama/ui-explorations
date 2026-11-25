const widget = document.getElementById("slider");
const track = document.getElementById("track");
const fill = document.getElementById("fill");
const knob = document.getElementById("knob");
const ringTop = document.getElementById("ringTop");
const ringBot = document.getElementById("ringBot");

const params = new URLSearchParams(window.location.search);
/* Bar -> Ring is the main behaviour; ?variant=forward keeps the original Ring -> Bar */
const isReverse = params.get("variant") !== "forward";

if (params.has("embed")) {
  document.documentElement.classList.add("embed");
}

const sizeParam = parseFloat(params.get("size"));
if (Number.isFinite(sizeParam) && sizeParam > 0) {
  widget.style.setProperty("--size", `${sizeParam}px`);
}

/* ---------- slider position ---------- */

let pos = 0.44;
let targetPos = 0.44;
let isPressed = false;
let grabOffset = 0;

function renderPosition() {
  const w = track.clientWidth;
  const knobR = knob.offsetWidth * 0.44; /* outer ring radius (44 in 100 viewBox) */
  const minX = knobR;
  const maxX = Math.max(minX, w - knobR);
  const x = minX + pos * (maxX - minX);

  knob.style.transform = `translate(${x.toFixed(2)}px, -50%) translateX(-50%)`;
  /* Fill tucks cleanly into the 9 o'clock ring wall so it connects seamlessly without poking into the black center pit */
  const fillW = Math.max(0, x - knobR * 0.55);
  fill.style.width = `${fillW.toFixed(2)}px`;
  widget.setAttribute("aria-valuenow", String(Math.round(pos * 100)));
}

/* ---------- synchronized ring <-> bar light transfer ---------- */

/*
 * renderLight(p) renders the conservation-of-light state for p in [0, 1]:
 *   p = 0   -> Full white ring around knob, solid gray left bar (#8e8e8e)
 *   p = 0.25-> Ring opens at 3 o'clock, white gradient wave at 9 o'clock end of bar
 *   p = 0.50-> Left-half white ring (12 -> 9 -> 6 o'clock), white wave halfway down bar
 *   p = 0.78-> Small left crescent at 9 o'clock, white wave 80% down bar
 *   p = 1.00-> Ring is 100% dark gray (#585858), left bar is 100% solid white (#ffffff)
 *
 * Main behaviour (Bar -> Ring):
 *   Idle rests at a = 0 (p = 1, light in bar).
 *   Press/move animates a: 0 -> 1 (p: 1 -> 0, light drains from bar into ring).
 *   Release animates a: 1 -> 0 (p: 0 -> 1, light retreats from ring back into bar).
 *
 * Alternate behaviour (?variant=forward, Ring -> Bar):
 *   Idle rests at a = 0 (p = 0, light in ring).
 *   Press/move animates a: 0 -> 1 (p: 0 -> 1, light retreats from ring into bar).
 *   Release animates a: 1 -> 0 (p: 1 -> 0, light sweeps from bar back into ring).
 */
let a = 0; /* actuation progress: 0 = idle, 1 = engaged */
let phase = "idle"; /* "idle" | "engaging" | "held" | "releasing" */
let pendingRelease = false;
let rafId = null;
let lastTime = 0;

const ENGAGE_MS = 320;
const RELEASE_MS = 360;

function easeInOutCubic(x) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

function renderLight(progress) {
  const p = Math.min(1, Math.max(0, progress));

  /*
   * 1. Ring arc (3 o'clock <-> 9 o'clock):
   *    For p in [0, 0.84], dashoffset moves between 0 and 83 at full stroke-width 23.
   *    For p in [0.84, 1], the 9 o'clock crescent funnels directly into/out of the left bar.
   */
  let dashOffset;
  let strokeW = 23;

  if (p <= 0.84) {
    const k = p / 0.84;
    dashOffset = k * 83;
    strokeW = 23;
  } else {
    const k = (p - 0.84) / 0.16;
    dashOffset = 83 + k * 18;
    strokeW = 23 * (1 - k);
  }

  const offsetStr = dashOffset.toFixed(2);
  const widthStr = strokeW.toFixed(2);
  ringTop.style.strokeDashoffset = offsetStr;
  ringBot.style.strokeDashoffset = offsetStr;
  ringTop.style.strokeWidth = widthStr;
  ringBot.style.strokeWidth = widthStr;

  const showStroke = p < 0.995 ? "1" : "0";
  ringTop.style.opacity = showStroke;
  ringBot.style.opacity = showStroke;

  /*
   * 2. Left bar white gradient wave (flowing between 9 o'clock and the far-left tip):
   */
  const core = Math.pow(p, 1.45) * 100;
  const tail = Math.min(100, p * 124);

  fill.style.setProperty("--wave-core", `${core.toFixed(1)}%`);
  fill.style.setProperty("--wave-tail", `${Math.max(core, tail).toFixed(1)}%`);
  widget.style.setProperty("--glow-bar", p.toFixed(3));
  widget.style.setProperty("--glow-ring", (1 - p).toFixed(3));
}

function renderActuation(actuation) {
  const eased = easeInOutCubic(Math.min(1, Math.max(0, actuation)));
  const p = isReverse ? 1 - eased : eased;
  renderLight(p);
}

function tick(now) {
  if (!lastTime) lastTime = now;
  const dt = Math.min(64, now - lastTime);
  lastTime = now;

  /* Smoothly glide position if clicked on track */
  if (Math.abs(targetPos - pos) > 0.0005) {
    pos += (targetPos - pos) * Math.min(1, dt * 0.028);
    if (Math.abs(targetPos - pos) <= 0.0005) pos = targetPos;
    renderPosition();
  }

  if (phase === "engaging") {
    a += dt / ENGAGE_MS;
    if (a >= 1) {
      a = 1;
      if (pendingRelease && !isPressed) {
        pendingRelease = false;
        phase = "releasing";
      } else {
        phase = "held";
      }
    }
    renderActuation(a);
  } else if (phase === "releasing") {
    a -= dt / RELEASE_MS;
    if (a <= 0) {
      a = 0;
      phase = "idle";
    }
    renderActuation(a);
  }

  if (phase === "engaging" || phase === "releasing" || Math.abs(targetPos - pos) > 0.0005) {
    rafId = requestAnimationFrame(tick);
  } else {
    rafId = null;
    lastTime = 0;
  }
}

function ensureLoop() {
  if (rafId === null) {
    lastTime = 0;
    rafId = requestAnimationFrame(tick);
  }
}

/* ---------- pointer interaction ---------- */

function pointerToPos(e, immediate) {
  const rect = track.getBoundingClientRect();
  const knobR = knob.offsetWidth * 0.44;
  const minX = knobR;
  const maxX = Math.max(minX + 1, rect.width - knobR);
  const rawX = e.clientX - rect.left - grabOffset;
  const clamped = Math.min(1, Math.max(0, (rawX - minX) / (maxX - minX)));

  targetPos = clamped;
  if (immediate) {
    pos = clamped;
    renderPosition();
  } else {
    ensureLoop();
  }
}

widget.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  widget.focus({ preventScroll: true });
  if (widget.setPointerCapture) {
    try {
      widget.setPointerCapture(e.pointerId);
    } catch (_) {}
  }

  const kr = knob.getBoundingClientRect();
  const center = kr.left + kr.width / 2;
  const dist = Math.abs(e.clientX - center);
  const onKnob = dist <= kr.width * 0.55;
  grabOffset = onKnob ? e.clientX - center : 0;

  isPressed = true;
  pendingRelease = false;
  if (phase !== "held") {
    phase = "engaging";
  }

  pointerToPos(e, onKnob);
  ensureLoop();
});

widget.addEventListener("pointermove", (e) => {
  if (!isPressed) return;
  pointerToPos(e, true);
});

function releasePointer() {
  if (!isPressed) return;
  isPressed = false;

  /* Always complete full transfer first before reversing back */
  if (phase === "engaging" && a < 1) {
    pendingRelease = true;
  } else {
    phase = "releasing";
  }
  ensureLoop();
}

widget.addEventListener("pointerup", releasePointer);
widget.addEventListener("pointercancel", releasePointer);
widget.addEventListener("blur", releasePointer);

/* ---------- keyboard ---------- */

widget.addEventListener("keydown", (e) => {
  let next = null;
  switch (e.key) {
    case "ArrowLeft": next = targetPos - 0.05; break;
    case "ArrowRight": next = targetPos + 0.05; break;
    case "PageDown": next = targetPos - 0.15; break;
    case "PageUp": next = targetPos + 0.15; break;
    case "Home": next = 0; break;
    case "End": next = 1; break;
    default: return;
  }
  e.preventDefault();
  targetPos = Math.min(1, Math.max(0, next));
  ensureLoop();
});

/* ---------- initial layout & optional storyboard frame preview (?t=0..1&pos=0..1) ---------- */

const posParam = parseFloat(params.get("pos"));
if (Number.isFinite(posParam)) {
  pos = Math.min(1, Math.max(0, posParam));
  targetPos = pos;
}

const tParam = parseFloat(params.get("t"));
if (Number.isFinite(tParam)) {
  renderLight(Math.min(1, Math.max(0, tParam)));
} else if (params.has("engage")) {
  a = 1;
  renderActuation(1);
} else {
  a = 0;
  renderActuation(0);
}

renderPosition();
window.addEventListener("resize", renderPosition);
