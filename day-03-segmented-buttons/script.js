const segmented = document.getElementById("segmented");
const indicator = document.getElementById("indicator");
const tabs = [...segmented.querySelectorAll(".tab")];

const params = new URLSearchParams(window.location.search);

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
  const tabIndex = parseInt(q.get("tab"), 10);
  if (!Number.isFinite(tabIndex)) return;
  selectTab(tabIndex - 1);
});

if (params.has("embed")) {
  document.documentElement.classList.add("embed");
}

const sizeParam = parseFloat(params.get("size"));
if (Number.isFinite(sizeParam) && sizeParam > 0) {
  segmented.style.setProperty("--size", `${sizeParam}px`);
}

let activeIndex = 1;

function selectTab(index) {
  activeIndex = Math.min(2, Math.max(0, index));
  segmented.style.setProperty("--pos", String(activeIndex));

  tabs.forEach((tab, i) => {
    const isActive = i === activeIndex;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
    tab.tabIndex = isActive ? 0 : -1;
  });

  broadcastState(`tab=${activeIndex + 1}`);
}

tabs.forEach((tab, index) => {
  tab.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    segmented.classList.add("is-pressing");
    selectTab(index);
  });
  tab.addEventListener("click", () => selectTab(index));
});

window.addEventListener("pointerup", () => segmented.classList.remove("is-pressing"));
window.addEventListener("pointercancel", () => segmented.classList.remove("is-pressing"));

segmented.addEventListener("keydown", (e) => {
  let next = null;
  switch (e.key) {
    case "ArrowRight": next = activeIndex + 1; break;
    case "ArrowLeft": next = activeIndex - 1; break;
    case "Home": next = 0; break;
    case "End": next = 2; break;
    default: return;
  }
  e.preventDefault();
  selectTab(next);
  tabs[activeIndex].focus({ preventScroll: true });
});

/* Initial placement — no slide on load. Default Date (index 1), or ?tab=1|2|3. */
const initialTab = parseInt(params.get("tab"), 10);
segmented.classList.add("no-transition");
selectTab(Number.isFinite(initialTab) ? initialTab - 1 : 1);
requestAnimationFrame(() => {
  requestAnimationFrame(() => segmented.classList.remove("no-transition"));
});
