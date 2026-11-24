const hero = document.getElementById("main");

const params = new URLSearchParams(window.location.search);

/* Embed mode: transparent page so the gallery cell shows through */
if (params.has("embed")) {
  document.documentElement.classList.add("embed");
}

/* Allow the host page to scale the component (e.g. ?size=200) */
const sizeParam = parseFloat(params.get("size"));
if (Number.isFinite(sizeParam) && sizeParam > 0) {
  hero.style.setProperty("--size", `${sizeParam}px`);
}

/* Generate photographic, seamlessly-convolved micro-bead-blasted anodized aluminum grain */
(function applySandblastedGrain() {
  const size = 256;
  const mask = size - 1;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const raw = new Float32Array(size * size);
  for (let i = 0; i < raw.length; i++) {
    /* Zero-mean Gaussian micro-facet distribution with occasional specular aluminum crystal glint */
    const g = (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 32;
    raw[i] = g;
  }

  /* Seamless wrap-around 3x3 Gaussian blur kernel [1,2,1; 2,4,2; 1,2,1]/16 to remove blocky pixel edges */
  const img = ctx.createImageData(size, size);
  const data = img.data;

  for (let y = 0; y < size; y++) {
    const ym1 = ((y - 1) & mask) * size;
    const y0 = y * size;
    const yp1 = ((y + 1) & mask) * size;

    for (let x = 0; x < size; x++) {
      const xm1 = (x - 1) & mask;
      const xp1 = (x + 1) & mask;

      const filtered =
        (raw[ym1 + xm1] * 0.5 +
          raw[ym1 + x] +
          raw[ym1 + xp1] * 0.5 +
          raw[y0 + xm1] +
          raw[y0 + x] * 7 +
          raw[y0 + xp1] +
          raw[yp1 + xm1] * 0.5 +
          raw[yp1 + x] +
          raw[yp1 + xp1] * 0.5) /
        10.5;

      const v = Math.max(0, Math.min(255, Math.round(128 + filtered)));
      const idx = (y0 + x) * 4;
      data[idx] = v;
      data[idx + 1] = v;
      data[idx + 2] = v;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  document.documentElement.style.setProperty("--grain-url", `url("${canvas.toDataURL("image/png")}")`);
})();

let isOn = false;
let isPressing = false;
let pressedAt = 0;
let releaseTimer = null;

/* Full travel time, read from the component so JS and CSS never drift apart */
function travelMs() {
  const raw = getComputedStyle(hero).getPropertyValue("--press-ms").trim();
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) return 140;
  return raw.endsWith("ms") ? value : value * 1000;
}

/* Latch happens at the bottom of the travel, never on release */
function latch() {
  releaseTimer = null;
  isPressing = false;
  isOn = !isOn;
  paint();
}

function paint() {
  const state = isPressing ? "depress" : isOn ? "on" : "off";
  hero.dataset.state = state;
  hero.classList.toggle("is-pressing", isPressing);
  hero.setAttribute("aria-checked", String(isOn));
}

function press() {
  if (releaseTimer !== null) {
    clearTimeout(releaseTimer);
    latch();
  }
  if (isPressing) return;
  isPressing = true;
  pressedAt = performance.now();
  paint();
}

function release(commit) {
  if (!isPressing) return;

  if (!commit) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
    isPressing = false;
    paint();
    return;
  }

  const remaining = Math.max(0, travelMs() - (performance.now() - pressedAt));
  clearTimeout(releaseTimer);

  if (remaining === 0) {
    latch();
    return;
  }

  /* Keep the cap fully depressed until it bottoms out, then latch and spring back */
  releaseTimer = setTimeout(latch, remaining);
}

function isInside(e) {
  const r = hero.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

hero.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  hero.focus({ preventScroll: true });
  press();
  if (hero.setPointerCapture) {
    try {
      hero.setPointerCapture(e.pointerId);
    } catch (_) {}
  }
});

hero.addEventListener("pointerup", (e) => release(isInside(e)));
hero.addEventListener("pointercancel", () => release(false));

hero.addEventListener("keydown", (e) => {
  if (e.key !== " " && e.key !== "Enter") return;
  e.preventDefault();
  if (!e.repeat) press();
});

hero.addEventListener("keyup", (e) => {
  if (e.key !== " " && e.key !== "Enter") return;
  e.preventDefault();
  release(true);
});

hero.addEventListener("blur", () => release(false));

/* Optional initial state override via URL query (?state=off|depress|on) */
const initialState = params.get("state");
if (initialState === "on" || initialState === "depress") {
  hero.classList.add("no-transition");
  if (initialState === "on") isOn = true;
  if (initialState === "depress") isPressing = true;
  paint();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => hero.classList.remove("no-transition"));
  });
}
