(function () {
  "use strict";

  const vp = document.getElementById("viewport");
  const stage = document.getElementById("scale-stage");
  const ui = document.getElementById("ui");
  if (!vp || !stage || !ui) return;

  /** Figma 125:5 画布 — 比例严格锁定 */
  const DESIGN_W = 1436;
  const DESIGN_H = 957;
  const PAD = 12;
  const COMPACT_SCALE = 0.92;
  const MIN_READABLE_SCALE = 0.72;

  function viewportSize() {
    const vv = window.visualViewport;
    if (vv) {
      return {
        w: Math.round(vv.width),
        h: Math.round(vv.height),
      };
    }
    return {
      w: window.innerWidth,
      h: window.innerHeight,
    };
  }

  function layout() {
    document.body.classList.add("layout-scale");
    document.body.classList.remove("layout-fluid");
    ui.classList.remove("ui-fluid");
    vp.classList.add("viewport--scale");
    stage.classList.add("scale-stage--active");

    const size = viewportSize();
    const availW = Math.max(size.w - PAD * 2, 1);
    const availH = Math.max(size.h - PAD * 2, 1);

    const fitScale = Math.min(availW / DESIGN_W, availH / DESIGN_H);
    const useScrollMode = fitScale < MIN_READABLE_SCALE;
    const scale = useScrollMode ? MIN_READABLE_SCALE : fitScale;
    const scaledW = DESIGN_W * scale;
    const scaledH = DESIGN_H * scale;

    stage.style.width = scaledW + "px";
    stage.style.height = scaledH + "px";
    stage.style.aspectRatio = DESIGN_W + " / " + DESIGN_H;
    stage.style.overflow = "hidden";

    ui.style.width = DESIGN_W + "px";
    ui.style.height = DESIGN_H + "px";
    ui.style.transformOrigin = "0 0";
    ui.style.transform = "scale(" + scale + ")";

    vp.style.height = size.h + "px";
    vp.style.minHeight = size.h + "px";

    if (useScrollMode) {
      vp.style.display = "block";
      vp.style.overflow = "auto";
      vp.style.padding = PAD + "px";
      stage.style.margin = "0 auto";
    } else {
      vp.style.display = "flex";
      vp.style.alignItems = "center";
      vp.style.justifyContent = "center";
      vp.style.overflow = "hidden";
      vp.style.padding = "0";
      stage.style.margin = "0";
    }

    document.body.classList.toggle("layout-compact", scale < COMPACT_SCALE);
    document.body.classList.toggle("layout-scroll-fit", useScrollMode);

    document.documentElement.style.setProperty("--ui-scale", String(scale));
    document.documentElement.dataset.uiScale = scale.toFixed(4);
  }

  let raf = 0;
  function scheduleLayout() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(layout);
  }

  layout();
  window.addEventListener("resize", scheduleLayout);
  window.addEventListener("orientationchange", scheduleLayout);

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scheduleLayout);
  }

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(scheduleLayout).observe(document.documentElement);
  }
})();
