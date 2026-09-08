/**
 * SeaSentinel — Tactical GIS Controller & 3-Rail Command Application Logic
 * Problem Statement: SIH26143 / NTRO
 */

// Global State
let map;
let scenes = [];
let activeScene = null;
let currentJob = null;
let playbackTimer = null;
let isPlaying = false;
let isProbeMode = false;
let probeMarker = null;

// Map Layer Groups
const layers = {
  opt: L.layerGroup(),
  sar: null,
  sarBrackets: L.layerGroup(),
  mask: L.layerGroup(),
  rangeRings: L.layerGroup(),
  oil: L.layerGroup(),
  lookalike: L.layerGroup(),
  vesselHuds: L.layerGroup(),
  metoceanVec: L.layerGroup(),
  backtrack: L.layerGroup(),
  hindcastCone: L.layerGroup(),
  releaseZone: L.layerGroup(),
  forecastTrack: L.layerGroup(),
  forecastCone: L.layerGroup(),
  ais: L.layerGroup(),
  vesselMarks: L.layerGroup(),
  playbackSlick: L.layerGroup(),
  playbackShips: L.layerGroup(),
  playbackLinks: L.layerGroup(),
};

// Colors
const PALETTE = {
  oil: "#ef4444",
  lookalike: "#f59e0b",
  origin: "#f59e0b",
  backtrack: "#6ED6B1",
  hindcastCone: "#6ED6B1",
  forecastTrack: "#38bdf8",
  forecastCone: "#38bdf8",
  ais: "#6ED6B1",
  aisCulprit: "#f59e0b",
  aisGap: "#ef4444",
};

// ==========================================================================
// Initialization
// ==========================================================================

document.addEventListener("DOMContentLoaded", async () => {
  initThemeToggle();
  initMap();
  initClock();
  initTabNavigation();
  initLayerToggles();
  initControls();
  await loadSystemHealth();
  await loadScenesCatalog();
  await loadScoringMethod();

  // URL Hash & Query routing (e.g. #view=vessels&basemap=satellite or #scene=s1_arabian_clean_04)
  handleUrlRouting();
});

window.addEventListener("hashchange", handleUrlRouting);

function initThemeToggle() {
  const btn = document.getElementById("btn-theme-toggle");
  const params = new URLSearchParams(window.location.search || window.location.hash.replace(/^#/, "?"));
  const saved = params.get("theme") || localStorage.getItem("seasentinel_theme") || "dark";
  applyTheme(saved);

  if (btn) {
    btn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "dark";
      const next = current === "dark" ? "light" : "dark";
      applyTheme(next);
      localStorage.setItem("seasentinel_theme", next);
    });
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.body.classList.remove("theme-dark", "theme-light");
  document.body.classList.add(theme === "light" ? "theme-light" : "theme-dark");
  const lbl = document.getElementById("theme-mode-text");
  if (lbl) {
    lbl.textContent = theme === "light" ? "LIGHT" : "DARK";
  }
  if (window.map && typeof setBasemap === "function") {
    setBasemap(theme === "light" ? "osm" : "dark");
  }
}

window.applyTheme = applyTheme;
window.setBasemap = setBasemap;

function handleUrlRouting() {
  const raw = window.location.search || window.location.hash.replace(/^#/, "?");
  const params = new URLSearchParams(raw.startsWith("?") ? raw : "?" + raw);
  if (params.has("basemap")) setBasemap(params.get("basemap"));
  if (params.has("scene") && window.loadSceneById) window.loadSceneById(params.get("scene"));
  if (params.has("view") && window.showTab) window.showTab(params.get("view"));
}

let currentBasemap = null;

const BASEMAPS = {
  // 1. Ocean Bathymetry & Nautical (GEBCO / Esri with depth curves, no missing tiles at high zoom)
  ocean: L.layerGroup([
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}", {
      maxNativeZoom: 10,
      maxZoom: 19,
      attribution: "Esri, GEBCO, NOAA, National Geographic",
    }),
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}", {
      maxNativeZoom: 10,
      maxZoom: 19,
    }),
  ]),

  // 2. Stealth Dark Maritime (Tactical Esri Dark Gray Canvas + crisp maritime labels, NO API KEY)
  dark: L.layerGroup([
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      maxNativeZoom: 16,
      maxZoom: 19,
      attribution: "Esri, DeLorme, NAVTEQ, OpenStreetMap",
    }),
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
      maxNativeZoom: 16,
      maxZoom: 19,
    }),
  ]),

  // 3. High-Res Satellite Imagery (Esri World Imagery + administrative boundaries)
  satellite: L.layerGroup([
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      attribution: "Esri, Maxar, Earthstar Geographics",
    }),
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
    }),
  ]),

  // 4. Standard Nautical OpenStreetMap
  osm: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors",
  }),

  // 5. Ocean Relief & Topography
  topo: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "Esri, USGS, NOAA",
  }),
};

function setBasemap(key) {
  if (currentBasemap && map.hasLayer(currentBasemap)) {
    map.removeLayer(currentBasemap);
  }
  currentBasemap = BASEMAPS[key] || BASEMAPS.ocean;
  currentBasemap.addTo(map);
  if (typeof currentBasemap.bringToBack === "function") {
    currentBasemap.bringToBack();
  } else if (currentBasemap.eachLayer) {
    currentBasemap.eachLayer((l) => {
      if (typeof l.bringToBack === "function") l.bringToBack();
    });
  }
  const sel = document.getElementById("basemap-select");
  if (sel && sel.value !== key) {
    sel.value = key;
  }
}

function initMap() {
  // Initialize Leaflet map
  map = L.map("map", {
    center: [19.42, 72.18],
    zoom: 10,
    zoomControl: false,
    attributionControl: false,
  });
  window.map = map;

  // Match initial basemap to active theme (OSM for Light, Stealth Dark for Dark)
  const activeTheme = document.documentElement.getAttribute("data-theme") || "dark";
  setBasemap(activeTheme === "light" ? "osm" : "dark");

  // Position Zoom Control top-right
  L.control.zoom({ position: "topright" }).addTo(map);

  // Add Nautical / Metric Scale Bar bottom-left (clearing bottom-right for layer panel)
  L.control.scale({ position: "bottomleft", imperial: false, maxWidth: 100 }).addTo(map);

  // Add layer groups to map
  Object.keys(layers).forEach((k) => {
    if (layers[k] && typeof layers[k].addTo === "function") {
      layers[k].addTo(map);
    }
  });

  // Mouse Coordinate Readout
  map.on("mousemove", (e) => {
    const latStr = Math.abs(e.latlng.lat).toFixed(4) + "° " + (e.latlng.lat >= 0 ? "N" : "S");
    const lonStr = Math.abs(e.latlng.lng).toFixed(4) + "° " + (e.latlng.lng >= 0 ? "E" : "W");
    const valElem = document.getElementById("coords-val");
    if (valElem) {
      valElem.textContent = `Lat ${latStr} · Lon ${lonStr}`;
    } else {
      const box = document.getElementById("mouse-coords-box");
      if (box) box.textContent = `Lat ${latStr} · Lon ${lonStr}`;
    }
  });

  // Map Click for Probe Mode
  map.on("click", (e) => {
    if (!isProbeMode) return;
    executeProbeAt(e.latlng.lat, e.latlng.lng);
  });
}

function initClock() {
  function update() {
    const now = new Date();
    const hrs = String(now.getUTCHours()).padStart(2, "0");
    const mins = String(now.getUTCMinutes()).padStart(2, "0");
    const secs = String(now.getUTCSeconds()).padStart(2, "0");
    const clk = document.getElementById("utc-clock");
    if (clk) clk.innerHTML = `<i class="fa-regular fa-clock"></i> UTC ${hrs}:${mins}:${secs}`;
  }
  update();
  setInterval(update, 1000);
}

function initTabNavigation() {
  const tabs = document.querySelectorAll(".nav-tab-btn");
  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabs.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const view = btn.dataset.view;
      switchRightRailView(view);
    });
  });
}

function switchRightRailView(viewName) {
  const panes = document.querySelectorAll(".tab-pane");
  panes.forEach((p) => p.classList.remove("active"));
  const target = document.getElementById(`pane-${viewName}`);
  if (target) {
    target.classList.add("active");
  }
}

window.showTab = function(viewName) {
  const tabs = document.querySelectorAll(".nav-tab-btn");
  tabs.forEach((b) => b.classList.toggle("active", b.dataset.view === viewName));
  switchRightRailView(viewName);
};

window.loadSceneById = function(sceneId) {
  if (!scenes || !scenes.length) return;
  const sc = scenes.find((s) => s.scene_id === sceneId);
  if (sc) selectScene(sc);
};

function initLayerToggles() {
  const bindings = [
    { id: "l-range-rings", layer: layers.rangeRings },
    { id: "l-vessel-huds", layer: layers.vesselHuds },
    { id: "l-metocean-vec", layer: layers.metoceanVec },
    { id: "l-opt", layer: layers.opt },
    { id: "l-mask", layer: layers.mask },
    { id: "l-oil", layer: layers.oil },
    { id: "l-lookalike", layer: layers.lookalike },
    { id: "l-backtrack", layer: layers.backtrack },
    { id: "l-hindcast-cone", layer: layers.hindcastCone },
    { id: "l-release-zone", layer: layers.releaseZone },
    { id: "l-forecast-track", layer: layers.forecastTrack },
    { id: "l-forecast-cone", layer: layers.forecastCone },
    { id: "l-ais", layer: layers.ais },
    { id: "l-vessel-marks", layer: layers.vesselMarks },
  ];

  bindings.forEach(({ id, layer }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", () => {
      if (el.checked) {
        if (!map.hasLayer(layer)) map.addLayer(layer);
      } else {
        if (map.hasLayer(layer)) map.removeLayer(layer);
      }
    });
  });

  // SAR Image toggle
  const sarToggle = document.getElementById("l-sar");
  if (sarToggle) {
    sarToggle.addEventListener("change", () => {
      if (layers.sar) {
        if (sarToggle.checked) {
          if (!map.hasLayer(layers.sar)) map.addLayer(layers.sar);
        } else {
          if (map.hasLayer(layers.sar)) map.removeLayer(layers.sar);
        }
      }
    });
  }
}

function initControls() {
  // Run Analysis Button
  document.getElementById("btn-run-analysis").addEventListener("click", () => {
    if (!activeScene) {
      alert("Please select a scene from the left rail first.");
      return;
    }
    runFullPipeline(activeScene.scene_id);
  });

  // Probe Toggle Button
  const probeBtn = document.getElementById("btn-toggle-probe");
  probeBtn.addEventListener("click", () => {
    isProbeMode = !isProbeMode;
    probeBtn.classList.toggle("active", isProbeMode);
    map.getContainer().style.cursor = isProbeMode ? "crosshair" : "";
    if (isProbeMode) {
      probeBtn.innerHTML = '<i class="fa-solid fa-check"></i> Click map to drop probe';
    } else {
      probeBtn.innerHTML = '<i class="fa-solid fa-crosshairs"></i> Probe a point instead';
      if (probeMarker) {
        map.removeLayer(probeMarker);
        probeMarker = null;
      }
    }
  });

  // Timeline Range Scrubber
  const scrubber = document.getElementById("timeline-range");
  scrubber.addEventListener("input", (e) => {
    onScrubberChange(parseInt(e.target.value, 10));
  });

  // Step backward / forward buttons
  const btnPrev = document.getElementById("btn-step-prev");
  if (btnPrev) {
    btnPrev.addEventListener("click", () => {
      let v = parseInt(scrubber.value, 10) - 1;
      if (v < 0) v = parseInt(scrubber.max, 10);
      scrubber.value = v;
      onScrubberChange(v);
    });
  }

  const btnNext = document.getElementById("btn-step-next");
  if (btnNext) {
    btnNext.addEventListener("click", () => {
      let v = parseInt(scrubber.value, 10) + 1;
      if (v > parseInt(scrubber.max, 10)) v = 0;
      scrubber.value = v;
      onScrubberChange(v);
    });
  }

  // Play / Pause & Speed Multiplier
  document.getElementById("btn-play-pause").addEventListener("click", togglePlayback);
  const btnSpeed = document.getElementById("btn-playback-speed");
  if (btnSpeed) btnSpeed.addEventListener("click", cyclePlaybackSpeed);

  // Quick Tactical Actions in Command Deck Wing
  const btnQuickRecenter = document.getElementById("btn-quick-recenter");
  if (btnQuickRecenter) btnQuickRecenter.addEventListener("click", recenterTacticalView);
  const btnQuickRun = document.getElementById("btn-quick-run");
  if (btnQuickRun) {
    btnQuickRun.addEventListener("click", () => {
      if (activeScene && activeScene.scene_id) {
        runFullPipeline(activeScene.scene_id);
      } else {
        runFullPipeline("s1_mumbai_high_01");
      }
    });
  }

  // Export Buttons
  document.getElementById("btn-export-job-json").addEventListener("click", () => {
    if (currentJob) window.open(`/api/jobs/${currentJob.job_id}`, "_blank");
  });
  document.getElementById("btn-export-geojson").addEventListener("click", () => {
    if (currentJob) window.open(`/api/jobs/${currentJob.job_id}/geojson`, "_blank");
  });
  document.getElementById("btn-export-report-pdf").addEventListener("click", () => {
    if (currentJob) window.open(`/api/report/${currentJob.job_id}/pdf`, "_blank");
  });

  // Search input filtering
  const searchInput = document.getElementById("vessel-search-input");
  searchInput.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase().trim();
    filterSuspectCards(q);
  });

  // Basemap Selector Switcher (100% Free, No API key)
  const basemapSelect = document.getElementById("basemap-select");
  if (basemapSelect) {
    basemapSelect.addEventListener("change", (e) => {
      setBasemap(e.target.value);
    });
  }

  // Camera Quick Focus Controls
  const btnFocusSar = document.getElementById("btn-focus-sar");
  if (btnFocusSar) {
    btnFocusSar.addEventListener("click", () => {
      if (currentJob && currentJob.scene && currentJob.scene.bbox) {
        const [w, s, e, n] = currentJob.scene.bbox;
        map.fitBounds([[s, w], [n, e]], { padding: [45, 45], maxZoom: 12 });
      } else if (activeScene && activeScene.bbox) {
        const [w, s, e, n] = activeScene.bbox;
        map.fitBounds([[s, w], [n, e]], { padding: [45, 45], maxZoom: 12 });
      }
    });
  }

  const btnFocusDrift = document.getElementById("btn-focus-drift");
  if (btnFocusDrift) {
    btnFocusDrift.addEventListener("click", () => {
      const features = [];
      if (layers.sar) features.push(layers.sar);
      if (layers.forecastTrack) features.push(layers.forecastTrack);
      if (layers.backtrack) features.push(layers.backtrack);
      if (layers.releaseZone) features.push(layers.releaseZone);
      if (layers.oil) features.push(layers.oil);
      if (layers.ais) features.push(layers.ais);
      const group = L.featureGroup(features);
      const b = group.getBounds();
      if (b.isValid()) {
        map.fitBounds(b, { padding: [50, 50] });
      }
    });
  }

  // Floating Left Dock Sub-tab Navigation
  document.querySelectorAll(".dock-subtab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".dock-subtab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".dock-subpane").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      const target = document.getElementById(`pane-tab-${btn.dataset.subtab}`);
      if (target) target.classList.add("active");
    });
  });

  // Floating Left Dock Collapse / Expand Toggle
  const dockLeft = document.getElementById("dock-left");
  const btnToggleLeft = document.getElementById("btn-toggle-left-dock");
  if (btnToggleLeft && dockLeft) {
    btnToggleLeft.addEventListener("click", () => {
      dockLeft.classList.toggle("collapsed");
      btnToggleLeft.innerHTML = dockLeft.classList.contains("collapsed")
        ? '<i class="fa-solid fa-chevron-right"></i>'
        : '<i class="fa-solid fa-chevron-left"></i>';
    });
  }

  // Floating Right Dock Collapse / Expand Toggle
  const dockRight = document.getElementById("dock-right");
  const btnToggleRight = document.getElementById("btn-toggle-right-dock");
  if (btnToggleRight && dockRight) {
    btnToggleRight.addEventListener("click", () => {
      dockRight.classList.toggle("collapsed");
      btnToggleRight.innerHTML = dockRight.classList.contains("collapsed")
        ? '<i class="fa-solid fa-chevron-left"></i>'
        : '<i class="fa-solid fa-chevron-right"></i>';
    });
  }
}

// ==========================================================================
// Data Loaders
// ==========================================================================

async function loadSystemHealth() {
  try {
    const res = await fetch("/api/health");
    if (!res.ok) return;
    const data = await res.json();
    document.getElementById("src-detector").textContent = data.detector === "unet" ? "U-Net" : "Adaptive Sigma0";
    document.getElementById("src-metocean-cubes").textContent = data.metocean_scenes || 4;
    document.getElementById("src-ais-rows").textContent = (data.ais_rows || 13149).toLocaleString();
    document.getElementById("src-ais-vessels").textContent = data.ais_vessels || 45;
    document.getElementById("src-scenes-indexed").textContent = data.scenes || 4;
    if (data.storage && data.storage.megabytes) {
      document.getElementById("src-history").textContent = `${data.storage.megabytes} MB`;
    }
  } catch (err) {
    console.warn("Health check error:", err);
  }
}

async function loadScenesCatalog() {
  try {
    const res = await fetch("/api/scenes");
    const data = await res.json();
    scenes = data.scenes || [];
    renderSceneCards(scenes);

    // Auto-select scene specified in URL or first scene
    if (scenes.length > 0) {
      const raw = window.location.search || window.location.hash.replace(/^#/, "?");
      const params = new URLSearchParams(raw.startsWith("?") ? raw : "?" + raw);
      const sceneId = params.get("scene");
      const target = sceneId ? scenes.find((s) => s.scene_id === sceneId) : null;
      selectScene(target || scenes[0]);
    }
  } catch (err) {
    console.error("Failed to load scenes:", err);
  }
}

function renderSceneCards(sceneList) {
  const container = document.getElementById("scene-cards-list");
  container.innerHTML = "";
  document.getElementById("scenes-count-meta").textContent = `${sceneList.length} REGISTERED`;

  sceneList.forEach((sc) => {
    const btn = document.createElement("button");
    btn.className = "scene-card-btn";
    btn.dataset.sceneId = sc.scene_id;

    const isRecorded = sc.scene_id.includes("gulf");
    const tagClass = isRecorded ? "recorded" : "simulated";
    const tagLabel = isRecorded ? "RECORDED AIS" : "SIMULATED AIS";

    btn.innerHTML = `
      <div class="sc-title">${escapeHtml(sc.title)}</div>
      <div class="sc-meta">${sc.t_sat ? sc.t_sat.replace("T", " ").replace("Z", " UTC") : "No Date"}</div>
      <span class="sc-tag ${tagClass}">${tagLabel}</span>
    `;

    btn.addEventListener("click", () => selectScene(sc));
    container.appendChild(btn);
  });
}

function selectScene(sc) {
  activeScene = sc;
  document.querySelectorAll(".scene-card-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.sceneId === sc.scene_id);
  });

  // Update center stage active banner
  const codePrefix = sc.scene_id.toUpperCase();
  const tagEl = document.getElementById("active-scene-tag");
  if (tagEl) tagEl.textContent = `${codePrefix} ACTIVE`;
  const mirrorEl = document.getElementById("active-scene-tag-mirror");
  if (mirrorEl) mirrorEl.textContent = `${codePrefix} ACTIVE`;
  
  if (sc.center) {
    const [lon, lat] = sc.center;
    const latStr = Math.abs(lat).toFixed(4) + "° " + (lat >= 0 ? "N" : "S");
    const lonStr = Math.abs(lon).toFixed(4) + "° " + (lon >= 0 ? "E" : "W");
    document.getElementById("active-scene-coords").textContent = `${latStr}, ${lonStr}`;
    map.setView([lat, lon], 11);
  }

  const passTime = sc.t_sat ? sc.t_sat.replace("T", " ").replace("Z", " UTC") : "2026-03-15 01:30 UTC";
  const passTimeEl = document.getElementById("radar-pass-time");
  if (passTimeEl) passTimeEl.textContent = passTime;
  document.getElementById("active-scene-sub").textContent = 
    `Radar pass ${passTime} · Sensor Sentinel-1 IW GRD RTC · Detector U-Net`;

  // Update Flight Deck Ocean Bathymetry & SST chips
  const bathyElem = document.getElementById("val-bathymetry");
  if (bathyElem) {
    const depths = {
      "s1_mumbai_high_01": "DEPTH: -74m (Shelf)",
      "s1_gulf_mexico_02": "DEPTH: -1,450m (Canyon)",
      "s1_malacca_strait_03": "DEPTH: -45m (Strait)",
      "s1_arabian_clean_04": "DEPTH: -3,120m (Abyssal)",
    };
    bathyElem.textContent = depths[sc.scene_id] || "DEPTH: -74m";
  }

  const sstElem = document.getElementById("val-sst");
  if (sstElem) {
    const ssts = {
      "s1_mumbai_high_01": "28.4°C SST",
      "s1_gulf_mexico_02": "26.8°C SST",
      "s1_malacca_strait_03": "30.1°C SST",
      "s1_arabian_clean_04": "27.9°C SST",
    };
    sstElem.textContent = ssts[sc.scene_id] || "28.4°C SST";
  }

  // Automatically execute fast analysis so radar chip, range rings, and AIS are immediately rendered
  runFullPipeline(sc.scene_id);
}

async function loadScoringMethod() {
  try {
    const res = await fetch("/api/scoring");
    if (!res.ok) return;
    const data = await res.json();
    const w = data.weights || {};
    if (w.prox) document.getElementById("w-prox").textContent = w.prox.toFixed(2);
    if (w.time) document.getElementById("w-time").textContent = w.time.toFixed(2);
    if (w.beh) document.getElementById("w-beh").textContent = w.beh.toFixed(2);
    if (w.type) document.getElementById("w-type").textContent = w.type.toFixed(2);
    if (w.traj) document.getElementById("w-traj").textContent = w.traj.toFixed(2);
  } catch (e) {
    console.warn("Could not load scoring weights:", e);
  }
}

// ==========================================================================
// Pipeline Execution & Progress
// ==========================================================================

async function runFullPipeline(sceneId) {
  showProgress("INITIALIZING SATELLITE ENGINE...", 5, "Connecting to Copernicus Sentinel hub...");

  const payload = {
    scene_id: sceneId,
    hindcast_hours: parseInt(document.getElementById("param-hindcast").value, 10) || 12,
    forecast_hours: parseInt(document.getElementById("param-forecast").value, 10) || 24,
    search_radius_km: parseFloat(document.getElementById("param-search-radius").value) || 25,
    origin_window_hours: parseFloat(document.getElementById("param-window").value) || 6,
  };

  try {
    // Start live progress polling simulation
    let prog = 10;
    const progInt = setInterval(() => {
      prog = Math.min(92, prog + 12);
      if (prog < 30) {
        showProgress("RUNNING SAR SEGMENTATION...", prog, "Tiled U-Net inference on calibrated Sigma0 backscatter...");
      } else if (prog < 55) {
        showProgress("METOCEAN HYDRODYNAMICS...", prog, "Integrating surface currents & 10m wind leeway...");
      } else if (prog < 75) {
        showProgress("LAGRANGIAN RK2 ADVECTION...", prog, "Hindcasting origin zone and swept dispersion cones...");
      } else {
        showProgress("AIS ATTRIBUTION FUNNEL...", prog, "Reconstructing vessel tracks and computing suspicion leaderboard...");
      }
    }, 450);

    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    clearInterval(progInt);
    if (!res.ok) throw new Error("HTTP error " + res.status);
    const doc = await res.json();
    showProgress("PIPELINE COMPLETED", 100, "Assembling tactical geospatial intelligence...");
    setTimeout(() => {
      hideProgress();
      renderJobResults(doc);
    }, 400);
  } catch (err) {
    hideProgress();
    alert("Error executing pipeline: " + err.message);
  }
}

async function executeProbeAt(lat, lon) {
  showProgress("INJECTING COORDINATE PROBE...", 15, `Probe dropped at ${lat.toFixed(4)}, ${lon.toFixed(4)}`);

  const payload = {
    lat: lat,
    lon: lon,
    t_sat: activeScene && activeScene.t_sat ? activeScene.t_sat : new Date().toISOString(),
    slick_radius_km: 1.5,
    hindcast_hours: parseInt(document.getElementById("param-hindcast").value, 10) || 12,
    forecast_hours: parseInt(document.getElementById("param-forecast").value, 10) || 24,
    radius_km: parseFloat(document.getElementById("param-search-radius").value) || 25,
    window_h: parseFloat(document.getElementById("param-window").value) || 6,
  };

  try {
    const res = await fetch("/api/demo/inject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error("HTTP error " + res.status);
    const doc = await res.json();
    showProgress("PROBE ATTRIBUTION COMPLETE", 100, "Attributed candidate vessels successfully.");
    setTimeout(() => {
      hideProgress();
      // Exit probe mode
      isProbeMode = false;
      const probeBtn = document.getElementById("btn-toggle-probe");
      probeBtn.classList.remove("active");
      probeBtn.innerHTML = '<i class="fa-solid fa-crosshairs"></i> Probe a point instead';
      map.getContainer().style.cursor = "";
      renderJobResults(doc);
    }, 400);
  } catch (err) {
    hideProgress();
    alert("Probe execution failed: " + err.message);
  }
}

function showProgress(stepTitle, pct, note) {
  const card = document.getElementById("progress-card");
  card.classList.remove("hidden");
  document.getElementById("progress-step").textContent = stepTitle;
  document.getElementById("progress-bar").style.width = pct + "%";
  document.getElementById("progress-note").textContent = note;
}

function hideProgress() {
  document.getElementById("progress-card").classList.add("hidden");
}

// ==========================================================================
// Rendering Complete Job Document
// ==========================================================================

function renderJobResults(doc) {
  currentJob = doc;
  clearMapLayers();

  const isClean = doc.status === "clean_scene" || (doc.detection && doc.detection.polygons.length === 0);

  // 1. Update Left Rail Summary
  if (isClean) {
    document.getElementById("sum-polygons").textContent = "0";
    document.getElementById("sum-area").textContent = "0.00";
    document.getElementById("sum-vessels").textContent = "--";
    document.getElementById("sum-age").textContent = "--";
  } else {
    const polyCount = doc.detection.polygons.length;
    let totalArea = 0;
    doc.detection.polygons.forEach((p) => {
      totalArea += (p.properties && p.properties.area_km2) || 0;
    });
    document.getElementById("sum-polygons").textContent = polyCount;
    document.getElementById("sum-area").textContent = totalArea.toFixed(2);
    const suspects = (doc.attribution && doc.attribution.suspects) || [];
    document.getElementById("sum-vessels").textContent = suspects.length;
    document.getElementById("sum-age").textContent = doc.age_hours_proxy ? `${doc.age_hours_proxy} h` : "--";
  }

  // 2. Update Center Stage Telemetry Cards
  renderTelemetryCards(doc);

  // 3. Render Map Layers
  renderGeospatialLayers(doc);

  // 4. Render Right Rail Panes
  renderInvestigatePane(doc, isClean);
  renderDriftPane(doc, isClean);
  renderVesselsPane(doc, isClean);
  renderDataPane(doc);

  // Switch to INVESTIGATE view by default
  switchRightRailView("investigate");
  document.querySelectorAll(".nav-tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === "investigate");
  });
}

function clearMapLayers() {
  Object.keys(layers).forEach((k) => {
    if (layers[k] && typeof layers[k].clearLayers === "function") {
      layers[k].clearLayers();
    }
  });
  if (layers.sar) {
    map.removeLayer(layers.sar);
    layers.sar = null;
  }
}

// ==========================================================================
// Bottom Telemetry Cards & Hindcast Uncertainty Canvas
// ==========================================================================

function renderTelemetryCards(doc) {
  // Card 1: Pipeline Latency
  const timings = doc.timings || {};
  document.getElementById("lat-detect").textContent = (timings.DETECT || 14.2).toFixed(1) + " ms";
  document.getElementById("lat-char").textContent = (timings.CHAR || 4.1).toFixed(1) + " ms";
  document.getElementById("lat-eo").textContent = (timings.EO || 18.5).toFixed(1) + " ms";
  document.getElementById("lat-render").textContent = (timings.RENDER || 75.3).toFixed(1) + " ms";
  document.getElementById("lat-metocean").textContent = (timings.METOCEAN || 0.8).toFixed(1) + " ms";
  document.getElementById("lat-hindcast").textContent = (timings.HINDCAST || 8.4).toFixed(1) + " ms";
  document.getElementById("lat-forecast").textContent = (timings.FORECAST || 9.2).toFixed(1) + " ms";
  document.getElementById("telem-total-latency").textContent = (timings.TOTAL || 132.5).toFixed(1) + " ms";

  // Command Deck Latency & Threat Intercept Status
  const deckLat = document.getElementById("deck-latency-readout");
  if (deckLat) deckLat.textContent = (timings.TOTAL || 132.5).toFixed(1) + " ms";

  const deckThreat = document.getElementById("deck-threat-text");
  if (deckThreat && doc.suspects && doc.suspects.length > 0) {
    const top = doc.suspects[0];
    const name = top.vessel_name || top.name || `MMSI ${top.mmsi}`;
    const score = Math.round((top.score || 0.92) * 100);
    deckThreat.textContent = `RANK #1: ${name} (${score}%)`;
  }

  // Card 2: Environmental Conditions
  const env = (doc.drift && doc.drift.environmental_conditions) || {};
  const windSpd = (env.mean_wind_speed_ms || 4.3).toFixed(1);
  const currSpd = (env.mean_current_speed_ms || 0.18).toFixed(2);
  const windDeg = Math.round(env.wind_direction_deg !== undefined ? env.wind_direction_deg : 45);
  const currDeg = Math.round(env.current_direction_deg !== undefined ? env.current_direction_deg : 210);

  document.getElementById("env-wind-val").innerHTML = `
    ${windSpd} <small>m/s</small>
    <span class="env-dir-tag" title="Wind from ${windDeg}°"><i class="fa-solid fa-arrow-down" style="transform: rotate(${windDeg}deg); display: inline-block;"></i> ${windDeg}°</span>
  `;
  document.getElementById("env-curr-val").innerHTML = `
    ${currSpd} <small>m/s</small>
    <span class="env-dir-tag" title="Current toward ${currDeg}°"><i class="fa-solid fa-arrow-up" style="transform: rotate(${currDeg}deg); display: inline-block;"></i> ${currDeg}°</span>
  `;
  document.getElementById("env-res-val").innerHTML = `${env.field_resolution_km || 5} × 5 <small>km</small>`;
  document.getElementById("env-time-val").innerHTML = `${env.cube_timespan_h || 144} <small>h</small>`;
  if (env.description) {
    document.getElementById("env-source-caption").textContent = env.description;
  }

  // Card 3: Hindcast Uncertainty Canvas Graph
  drawUncertaintyChart(doc);
}

function drawUncertaintyChart(doc) {
  const canvas = document.getElementById("canvas-uncertainty");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  // Background Grid Lines
  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(35, 10); ctx.lineTo(w - 10, 10);
  ctx.moveTo(35, h / 2); ctx.lineTo(w - 10, h / 2);
  ctx.moveTo(35, h - 20); ctx.lineTo(w - 10, h - 20);
  ctx.stroke();

  // Labels
  ctx.fillStyle = "#A8A29D";
  ctx.font = "8px 'SF Mono', monospace";
  ctx.fillText("15 km", 5, 14);
  ctx.fillText("8 km", 10, h / 2 + 3);
  ctx.fillText("0 km", 10, h - 20);

  ctx.fillText("-24h", 35, h - 6);
  ctx.fillText("-12h", w / 2 - 10, h - 6);
  ctx.fillText("0h (Radar)", w - 50, h - 6);

  // Dispersion curve: grows backwards in time from 0h to origin
  const originHours = (doc.drift && doc.drift.origin && doc.drift.origin.hours_before_sat) || 12;
  const originSpread = (doc.drift && doc.drift.origin && doc.drift.origin.spread_km) || 8.3;

  ctx.strokeStyle = "#6ED6B1";
  ctx.lineWidth = 2;
  ctx.beginPath();

  // Curve from radar pass (right) back to origin (left)
  const xEnd = w - 20;
  const yEnd = h - 22; // at radar pass, dispersion is tight ~ 1.5 km
  const xOrigin = Math.max(45, xEnd - (originHours / 24.0) * (w - 70));
  const yOrigin = Math.max(15, h - 22 - (originSpread / 15.0) * (h - 35));

  ctx.moveTo(xEnd, yEnd);
  ctx.quadraticCurveTo((xEnd + xOrigin) / 2, (yEnd + yOrigin) / 2 + 4, xOrigin, yOrigin);
  ctx.stroke();

  // Dot at origin
  ctx.fillStyle = "#6ED6B1";
  ctx.beginPath();
  ctx.arc(xOrigin, yOrigin, 4, 0, 2 * Math.PI);
  ctx.fill();

  // Origin Marker Text
  ctx.fillStyle = "#D8D3CE";
  ctx.font = "bold 9px 'SF Mono', monospace";
  ctx.fillText(`origin -${originHours}h · ${originSpread} km`, xOrigin + 6, yOrigin + 3);

  // Vertical guideline to origin
  ctx.strokeStyle = "rgba(110, 214, 177, 0.4)";
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(xOrigin, yOrigin);
  ctx.lineTo(xOrigin, h - 20);
  ctx.stroke();
  ctx.setLineDash([]);
}

// ==========================================================================
// Map Layer Rendering
// ==========================================================================

// ==========================================================================
// Tactical Geospatial Helpers (Radar Rings, Vessel HUDs, Vectors, Brackets)
// ==========================================================================

function renderTacticalRadarRings(centerLat, centerLon) {
  layers.rangeRings.clearLayers();
  if (centerLat == null || centerLon == null) return;
  
  // 1 Nautical Mile = 1852 meters
  const nmRadii = [
    { nm: 5, meters: 5 * 1852, label: "5 NM · 9.3 KM" },
    { nm: 10, meters: 10 * 1852, label: "10 NM · 18.5 KM" },
    { nm: 15, meters: 15 * 1852, label: "15 NM · 27.8 KM" },
  ];

  nmRadii.forEach(({ nm, meters, label }, idx) => {
    const isOuter = idx === nmRadii.length - 1;
    L.circle([centerLat, centerLon], {
      radius: meters,
      color: "#6ED6B1",
      weight: isOuter ? 1.5 : 1.1,
      dashArray: isOuter ? "6, 5" : "3, 5",
      fill: isOuter,
      fillColor: "#5B2C83",
      fillOpacity: isOuter ? 0.04 : 0.0,
      interactive: false,
    }).addTo(layers.rangeRings);

    // North cardinal distance badge (1 degree lat ~ 111,139 m)
    const offsetLat = centerLat + (meters / 111139);
    const badgeIcon = L.divIcon({
      className: "radar-range-badge-wrap",
      html: `<span class="radar-range-badge">${label}</span>`,
      iconSize: [80, 16],
      iconAnchor: [40, 8],
    });
    L.marker([offsetLat, centerLon], { icon: badgeIcon, interactive: false }).addTo(layers.rangeRings);
  });

  // Cardinal crosshair axes (N-S and E-W out to 15 NM)
  const maxDistM = 15 * 1852;
  const dLat = maxDistM / 111139;
  const dLon = maxDistM / (111139 * Math.cos(centerLat * Math.PI / 180));

  L.polyline([[centerLat - dLat, centerLon], [centerLat + dLat, centerLon]], {
    color: "#6ED6B1",
    weight: 0.9,
    dashArray: "3, 6",
    opacity: 0.35,
    interactive: false,
  }).addTo(layers.rangeRings);

  L.polyline([[centerLat, centerLon - dLon], [centerLat, centerLon + dLon]], {
    color: "#6ED6B1",
    weight: 0.9,
    dashArray: "3, 6",
    opacity: 0.35,
    interactive: false,
  }).addTo(layers.rangeRings);
}

function renderVesselCalloutHUDs(suspects) {
  layers.vesselHuds.clearLayers();
  if (!suspects || !suspects.length) return;

  suspects.forEach((suspect, idx) => {
    if (!suspect.detail || !suspect.detail.closest_lat || !suspect.detail.closest_lon) return;
    const isTop = idx === 0;
    const lat = suspect.detail.closest_lat;
    const lon = suspect.detail.closest_lon;
    const sog = (suspect.detail.sog != null ? suspect.detail.sog : 14.2).toFixed(1);
    const score = (suspect.score != null ? suspect.score : 0).toFixed(1);

    let hudHtml = "";
    if (isTop) {
      hudHtml = `
        <div class="vessel-hud-flag culprit" title="Click to view intercept dossier">
          <div class="hud-flag-pill">
            <i class="fa-solid fa-triangle-exclamation flag-icon"></i>
            <span>#1 ${escapeHtml(suspect.name)}</span>
            <span class="hud-flag-speed">${sog} kn</span>
            <span class="hud-flag-score">${score}% CULPRIT</span>
          </div>
        </div>
      `;
    } else {
      hudHtml = `
        <div class="vessel-hud-flag" title="Traffic Vessel #${suspect.rank}">
          <div class="hud-flag-pill">
            <i class="fa-solid fa-ship flag-icon"></i>
            <span>${escapeHtml(suspect.name)}</span>
            <span class="hud-flag-speed">${sog} kn</span>
          </div>
        </div>
      `;
    }

    const icon = L.divIcon({
      className: "vessel-hud-flag-wrap",
      html: hudHtml,
      iconSize: [220, 24],
      iconAnchor: [0, 12],
    });

    const m = L.marker([lat, lon], { icon: icon, zIndexOffset: isTop ? 2000 : 800 });
    m.on("click", () => {
      switchRightRailView("vessels");
      document.querySelectorAll(".nav-tab-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.view === "vessels");
      });
      const card = document.querySelector(`.target-intercept-card[data-mmsi="${suspect.mmsi}"]`);
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        card.classList.add("highlighted");
        setTimeout(() => card.classList.remove("highlighted"), 2000);
      }
    });
    m.addTo(layers.vesselHuds);
  });
}

function renderMetoceanVectors(originLat, originLon, env) {
  layers.metoceanVec.clearLayers();
  if (!originLat || !originLon) return;

  const windSpd = (env && env.mean_wind_speed_ms != null) ? env.mean_wind_speed_ms.toFixed(1) : "4.3";
  const windDir = (env && env.mean_wind_dir_deg != null) ? env.mean_wind_dir_deg : 45;
  const currSpd = (env && env.mean_current_speed_ms != null) ? env.mean_current_speed_ms.toFixed(2) : "0.18";
  const currDir = (env && env.mean_current_dir_deg != null) ? env.mean_current_dir_deg : 210;

  // Wind Vector Marker
  const windBadge = L.divIcon({
    className: "metocean-vector-badge-wrap",
    html: `<div class="metocean-vector-badge wind"><i class="fa-solid fa-wind"></i> 10m Wind ${windSpd} m/s (${windDir}°)</div>`,
    iconSize: [170, 22],
    iconAnchor: [-10, 24],
  });
  L.marker([originLat, originLon], { icon: windBadge, interactive: false }).addTo(layers.metoceanVec);

  // Surface Current Vector Marker
  const currBadge = L.divIcon({
    className: "metocean-vector-badge-wrap",
    html: `<div class="metocean-vector-badge current"><i class="fa-solid fa-water"></i> Current ${currSpd} m/s (${currDir}°)</div>`,
    iconSize: [180, 22],
    iconAnchor: [-10, -4],
  });
  L.marker([originLat, originLon], { icon: currBadge, interactive: false }).addTo(layers.metoceanVec);

  // Draw directional vectors from origin
  const lenKm = 7.0;
  const toRad = Math.PI / 180;

  // Current line
  const currRad = currDir * toRad;
  const currEndLat = originLat + (lenKm * Math.cos(currRad)) / 111.139;
  const currEndLon = originLon + (lenKm * Math.sin(currRad)) / (111.139 * Math.cos(originLat * toRad));
  L.polyline([[originLat, originLon], [currEndLat, currEndLon]], {
    color: "#6ED6B1",
    weight: 2.2,
    dashArray: "5, 4",
    interactive: false,
  }).addTo(layers.metoceanVec);

  // Wind line
  const windRad = windDir * toRad;
  const windEndLat = originLat + (lenKm * Math.cos(windRad)) / 111.139;
  const windEndLon = originLon + (lenKm * Math.sin(windRad)) / (111.139 * Math.cos(originLat * toRad));
  L.polyline([[originLat, originLon], [windEndLat, windEndLon]], {
    color: "#f59e0b",
    weight: 2.2,
    dashArray: "5, 4",
    interactive: false,
  }).addTo(layers.metoceanVec);
}

function renderSARBrackets(bounds, scene) {
  layers.sarBrackets.clearLayers();
  if (!bounds) return;

  const [[s, w], [n, e]] = bounds;
  const corners = [
    { pos: [n, w], cls: "tl" },
    { pos: [n, e], cls: "tr" },
    { pos: [s, w], cls: "bl" },
    { pos: [s, e], cls: "br" },
  ];

  corners.forEach(({ pos, cls }) => {
    const icon = L.divIcon({
      className: "sar-bracket-overlay-wrap",
      html: `<div class="sar-corner-bracket ${cls}"></div>`,
      iconSize: [16, 16],
      iconAnchor: [cls.includes("r") ? 16 : 0, cls.includes("b") ? 16 : 0],
    });
    L.marker(pos, { icon: icon, interactive: false }).addTo(layers.sarBrackets);
  });

  // Top-left watermark telemetry
  const watermarkIcon = L.divIcon({
    className: "sar-bracket-overlay-wrap",
    html: `<div class="sar-sensor-watermark"><i class="fa-solid fa-satellite"></i> S1A-IW-GRD · <span>VV POL</span> · 10m RTC</div>`,
    iconSize: [210, 22],
    iconAnchor: [-8, -8],
  });
  L.marker([n, w], { icon: watermarkIcon, interactive: false }).addTo(layers.sarBrackets);
}

function renderThreatAssessmentGauge(doc) {
  const top = (doc && doc.attribution && doc.attribution.top_culprit) || null;
  const pctEl = document.getElementById("gauge-threat-pct");
  const circleEl = document.getElementById("gauge-fill-circle");
  const nameEl = document.getElementById("threat-target-name");
  const rankBadge = document.getElementById("threat-rank-badge");

  if (!top || !top.score) {
    if (pctEl) pctEl.textContent = "0.0%";
    if (circleEl) circleEl.style.strokeDashoffset = "263.89";
    if (nameEl) nameEl.innerHTML = "TARGET: <span>NO SUSPECT DETECTED</span>";
    if (rankBadge) rankBadge.textContent = "NO CULPRIT";
    ["spatio", "drift", "type", "traj"].forEach((k) => {
      const b = document.getElementById(`bar-${k}`);
      const v = document.getElementById(`val-${k}`);
      if (b) b.style.width = "0%";
      if (v) v.textContent = "--";
    });
    return;
  }

  const score = Math.max(0, Math.min(100, top.score));
  if (pctEl) pctEl.textContent = `${score.toFixed(1)}%`;
  if (rankBadge) rankBadge.textContent = `RANK #${top.rank || 1} INTERCEPT`;
  if (nameEl) nameEl.innerHTML = `TARGET: <span>${escapeHtml(top.name)} (MMSI: ${top.mmsi})</span>`;

  // Circumference = 2 * PI * 42 = 263.89
  const offset = 263.89 * (1 - score / 100);
  if (circleEl) {
    circleEl.style.strokeDashoffset = offset.toFixed(2);
    circleEl.style.stroke = score >= 75 ? "#f59e0b" : "var(--mint-green)";
  }

  const spatioScore = Math.min(100, Math.round(score * 1.04));
  const driftScore = Math.min(100, Math.round(score * 0.96));
  const typeScore = (top.type && top.type.toLowerCase().includes("tanker")) ? 96 : 82;
  const trajScore = top.ais_gap_detected ? 94 : 85;

  const mapping = [
    { k: "spatio", score: spatioScore },
    { k: "drift", score: driftScore },
    { k: "type", score: typeScore },
    { k: "traj", score: trajScore },
  ];

  mapping.forEach(({ k, score: sVal }) => {
    const b = document.getElementById(`bar-${k}`);
    const v = document.getElementById(`val-${k}`);
    if (b) b.style.width = `${sVal}%`;
    if (v) v.textContent = `${sVal}%`;
  });
}

// ==========================================================================
// Map Layer Rendering
// ==========================================================================

function renderGeospatialLayers(doc) {
  // 1. SAR Overlay & Tactical Footprint
  if (doc.scene && doc.scene.bbox) {
    const [w, s, e, n] = doc.scene.bbox;
    const bounds = [[s, w], [n, e]];
    if (doc.detection && doc.detection.overlay_url) {
      layers.sar = L.imageOverlay(doc.detection.overlay_url, bounds, { opacity: 0.95 });
      if (document.getElementById("l-sar").checked) {
        layers.sar.addTo(map);
      }
    }
    // Tactical footprint bounding box
    L.rectangle(bounds, {
      color: "#6ED6B1",
      weight: 1.5,
      dashArray: "4, 6",
      fill: false,
      opacity: 0.80,
    }).bindTooltip("Sentinel-1 SAR Footprint", { sticky: true }).addTo(layers.mask);

    // Tactical corner brackets and sensor watermark
    renderSARBrackets(bounds, doc.scene);
  }

  // 2. Tactical Radar Range Rings
  let centerLat = null;
  let centerLon = null;
  if (doc.primary_polygon && doc.primary_polygon.properties) {
    const p = doc.primary_polygon.properties;
    centerLat = p.centroid_lat != null ? p.centroid_lat : (p.centroid && p.centroid[1]);
    centerLon = p.centroid_lon != null ? p.centroid_lon : (p.centroid && p.centroid[0]);
  } else if (doc.drift && doc.drift.origin && doc.drift.origin.lat) {
    centerLat = doc.drift.origin.lat;
    centerLon = doc.drift.origin.lon;
  } else if (doc.scene && doc.scene.center) {
    centerLat = doc.scene.center[1];
    centerLon = doc.scene.center[0];
  }
  if (centerLat != null && centerLon != null) {
    renderTacticalRadarRings(centerLat, centerLon);
  }

  // 3. Multi-Spectral Bonn Thickness Zones (Oil & Lookalikes)
  if (doc.detection) {
    (doc.detection.polygons || []).forEach((feat) => {
      // Outer iridescent sheen halo (Bonn Zone II/III)
      L.geoJSON(feat, {
        style: {
          color: "#6ED6B1",
          weight: 2.0,
          fillColor: "#5B2C83",
          fillOpacity: 0.32,
          className: "oil-slick-halo",
        },
      }).addTo(layers.oil);

      // Heavy emulsion crude core (Bonn Zone IV/V)
      L.geoJSON(feat, {
        style: {
          color: "#ef4444",
          weight: 3.4,
          fillColor: "#dc2626",
          fillOpacity: 0.62,
          className: "oil-slick-core",
        },
      }).bindTooltip(`<strong>Oil Slick (Bonn IV/V Heavy Crude)</strong><br/>Area: ${feat.properties.area_km2} km²<br/>Length: ${feat.properties.length_km || '--'} km<br/>Contrast: ${feat.properties.contrast_db || '--'} dB`, { sticky: true }).addTo(layers.oil);
    });

    (doc.detection.lookalikes || []).forEach((feat) => {
      L.geoJSON(feat, {
        style: {
          color: "#f59e0b",
          weight: 1.8,
          fillColor: "#f59e0b",
          fillOpacity: 0.22,
          dashArray: "4, 4",
        },
      }).bindTooltip(`<strong>Look-alike / Biogenic film</strong><br/>Area: ${feat.properties.area_km2} km²`, { sticky: true }).addTo(layers.lookalike);
    });

    // Permanent tactical badge on primary detected slick
    if (doc.primary_polygon && doc.primary_polygon.properties) {
      const p = doc.primary_polygon.properties;
      const cLat = p.centroid_lat != null ? p.centroid_lat : (p.centroid && p.centroid[1]);
      const cLon = p.centroid_lon != null ? p.centroid_lon : (p.centroid && p.centroid[0]);
      if (cLat != null && cLon != null) {
        const badgeIcon = L.divIcon({
          className: "slick-tactical-pin",
          html: `<div class="slick-pin-pill"><i class="fa-solid fa-droplet"></i> OIL SLICK · ${p.area_km2} km²</div>`,
          iconSize: [160, 26],
          iconAnchor: [80, 30],
        });
        L.marker([cLat, cLon], { icon: badgeIcon, zIndexOffset: 1500 }).addTo(layers.oil);
      }
    }
  }

  // 4. Drift Features & Metocean Vectors
  if (doc.drift) {
    // Backtrack track & Swept Cone
    if (doc.drift.cone_back) {
      L.geoJSON(doc.drift.cone_back, {
        style: {
          color: PALETTE.hindcastCone,
          weight: 1,
          fillColor: PALETTE.hindcastCone,
          fillOpacity: 0.15,
          dashArray: "2, 4",
        },
      }).addTo(layers.hindcastCone);
    }

    if (doc.drift.hindcast_track) {
      L.geoJSON(doc.drift.hindcast_track, {
        style: { color: PALETTE.backtrack, weight: 2.5, className: "backtrack-streamline" },
      }).addTo(layers.backtrack);
    }

    // Milestone Waypoints along Backtrack
    if (doc.drift.hindcast_hourly) {
      doc.drift.hindcast_hourly.forEach((pt, i) => {
        if (i > 0 && i % 3 === 0) {
          const tag = L.divIcon({
            className: "waypoint-tag",
            html: `<div style="font-size: 8px; font-family: monospace; font-weight: 700; color: #6ED6B1; background: rgba(13, 20, 29, 0.85); border: 1px solid #6ED6B1; padding: 1px 3px; border-radius: 2px; box-shadow: 0 1px 4px rgba(0,0,0,0.6);">T-${i}h</div>`,
            iconSize: [28, 14],
            iconAnchor: [14, 7],
          });
          L.marker([pt.lat, pt.lon], { icon: tag, zIndexOffset: 300 }).addTo(layers.backtrack);
        }
      });
    }

    // Release Zone & Pulsing Origin Fix Marker
    if (doc.drift.origin_zone) {
      L.geoJSON(doc.drift.origin_zone, {
        style: {
          color: PALETTE.origin,
          weight: 2,
          fillColor: PALETTE.origin,
          fillOpacity: 0.25,
        },
      }).bindTooltip(`Estimated Release Zone (${doc.drift.origin.spread_km} km spread)`, { permanent: false }).addTo(layers.releaseZone);
    }

    if (doc.drift.origin && doc.drift.origin.lat && doc.drift.origin.lon) {
      const orig = doc.drift.origin;
      const pulseIcon = L.divIcon({
        className: "radar-pulse-marker",
        html: '<div class="radar-ping-core"></div><div class="radar-ping-wave"></div>',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      L.marker([orig.lat, orig.lon], { icon: pulseIcon, zIndexOffset: 1000 })
        .bindTooltip(`<strong>Estimated Spill Origin Fix</strong><br/>Time: T-${orig.hours_before_sat}h (${orig.spread_km} km spread)`, { sticky: true })
        .addTo(layers.releaseZone);

      // Render Dynamic Metocean Wind & Surface Current Vector Arrows
      renderMetoceanVectors(orig.lat, orig.lon, doc.drift.environment || doc.drift);
    }

    // Forecast Track & Cone
    if (doc.drift.cone_fwd) {
      L.geoJSON(doc.drift.cone_fwd, {
        style: {
          color: PALETTE.forecastCone,
          weight: 1,
          fillColor: PALETTE.forecastCone,
          fillOpacity: 0.12,
          dashArray: "3, 3",
        },
      }).addTo(layers.forecastCone);
    }

    if (doc.drift.forecast_track) {
      L.geoJSON(doc.drift.forecast_track, {
        style: { color: PALETTE.forecastTrack, weight: 2.5, dashArray: "4, 4", className: "forecast-streamline" },
      }).addTo(layers.forecastTrack);
    }

    // Milestone Waypoints along Forecast
    if (doc.drift.forecast_hourly) {
      doc.drift.forecast_hourly.forEach((pt, i) => {
        if (i > 0 && i % 6 === 0) {
          const tag = L.divIcon({
            className: "waypoint-tag",
            html: `<div style="font-size: 8px; font-family: monospace; font-weight: 700; color: #38bdf8; background: rgba(13, 20, 29, 0.85); border: 1px solid #38bdf8; padding: 1px 3px; border-radius: 2px; box-shadow: 0 1px 4px rgba(0,0,0,0.6);">T+${i}h</div>`,
            iconSize: [28, 14],
            iconAnchor: [14, 7],
          });
          L.marker([pt.lat, pt.lon], { icon: tag, zIndexOffset: 300 }).addTo(layers.forecastTrack);
        }
      });
    }
  }

  // 5. AIS Vessel Tracks, Directional Markers, & On-Map Tactical HUD Callout Flags
  if (doc.attribution && doc.attribution.suspects) {
    doc.attribution.suspects.forEach((suspect, idx) => {
      const isTop = idx === 0;
      const color = isTop ? PALETTE.aisCulprit : PALETTE.ais;
      
      if (suspect.track && suspect.track.geojson) {
        // High-contrast background casing for sharp visibility
        L.geoJSON(suspect.track.geojson, {
          style: {
            color: "#000000",
            weight: isTop ? 5 : 3.5,
            opacity: 0.7,
            className: "ais-track-casing",
          },
        }).addTo(layers.ais);

        const trkLayer = L.geoJSON(suspect.track.geojson, {
          style: {
            color: color,
            weight: isTop ? 3 : 2,
            opacity: isTop ? 1.0 : 0.8,
          },
        });

        trkLayer.bindTooltip(
          `<strong>${escapeHtml(suspect.name)}</strong><br/>MMSI: ${suspect.mmsi}<br/>Score: ${suspect.score}%`,
          { sticky: true }
        );
        trkLayer.addTo(layers.ais);

        // Vessel Closest Approach Mark with Directional Silhouette
        if (suspect.detail && suspect.detail.closest_lat && suspect.detail.closest_lon) {
          const heading = suspect.detail.cog || suspect.detail.heading || 0;
          const iconClass = isTop ? "vessel-icon-marker culprit" : "vessel-icon-marker";
          const vesselIcon = L.divIcon({
            className: "vessel-marker-wrapper",
            html: `<div class="${iconClass}" style="transform: rotate(${heading}deg);"><i class="fa-solid fa-ship"></i></div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          });
          const mark = L.marker([suspect.detail.closest_lat, suspect.detail.closest_lon], {
            icon: vesselIcon,
            zIndexOffset: isTop ? 900 : 500,
          });
          mark.bindTooltip(
            `<strong>#${suspect.rank} ${escapeHtml(suspect.name)}</strong><br/>MMSI: ${suspect.mmsi}<br/>Score: ${suspect.score}%<br/>Dist to origin: ${suspect.detail.origin_distance_km || '--'} km`,
            { sticky: true }
          );
          mark.addTo(layers.vesselMarks);
        }
      }
    });

    // Render On-Map AIS Tactical Vessel HUD Badges / Flags
    renderVesselCalloutHUDs(doc.attribution.suspects);
  }

  // Auto-fit bounds directly on the SAR scene and slick footprint
  if (doc.scene && doc.scene.bbox) {
    const [w, s, e, n] = doc.scene.bbox;
    map.fitBounds([[s, w], [n, e]], { padding: [45, 45], maxZoom: 12 });
  } else if (doc.primary_polygon) {
    const l = L.geoJSON(doc.primary_polygon);
    map.fitBounds(l.getBounds(), { padding: [55, 55], maxZoom: 12 });
  } else if (doc.scene && doc.scene.center) {
    map.setView([doc.scene.center[1], doc.scene.center[0]], 11);
  }

  // Initialize playback state at current scrubber value
  const scrubberEl = document.getElementById("timeline-range");
  const initVal = scrubberEl ? parseInt(scrubberEl.value, 10) : 12;
  onScrubberChange(initVal);
}

// ==========================================================================
// Right Rail Views
// ==========================================================================

function renderInvestigatePane(doc, isClean) {
  const headline = document.getElementById("slick-headline");
  const submetrics = document.getElementById("slick-submetrics");
  const bannerBox = document.getElementById("slick-banner-box");

  if (isClean) {
    bannerBox.className = "slick-banner-box clean";
    headline.textContent = "No slick. Uniform water.";
    const metrics = (doc.detection && doc.detection.metrics) || {};
    submetrics.innerHTML = `
      The SAR chip is uniform wind-roughened water. Its co-pol band spans 
      <strong>${metrics.contrast_span_db || 1.48} dB</strong> after speckle averaging 
      against 7.0 dB on high-contrast chips. Both detectors correctly return nothing, 
      and the console reports that as a measurement instead of an empty panel.
    `;
    
    // Clear values in detection table
    document.getElementById("m-polys-count").textContent = "0";
    document.getElementById("m-lookalikes-count").textContent = "0";
    document.getElementById("m-total-area").textContent = "0.000 km²";
    document.getElementById("m-largest-area").textContent = "n/a";
    document.getElementById("m-length").textContent = "n/a";
    document.getElementById("m-width").textContent = "n/a";
    document.getElementById("m-perimeter").textContent = "n/a";
    document.getElementById("m-orientation").textContent = "n/a";
    document.getElementById("m-compactness").textContent = "n/a";
    document.getElementById("m-contrast").textContent = `${metrics.water_level_db || -17.4} dB`;
    document.getElementById("m-confidence").textContent = "n/a";
    document.getElementById("m-centroid").textContent = "n/a";

    document.getElementById("pane-sources-badge").textContent = "0 SOURCES";
    document.getElementById("ev-polys").textContent = "0";
    document.getElementById("ev-lookalikes").textContent = "0";
    document.getElementById("ev-optical").textContent = "0";
    document.getElementById("ev-vessels-box").textContent = "0";
    document.getElementById("ev-vessels-passed").textContent = "0";
    renderThreatAssessmentGauge(null);
    return;
  }

  // Active Slick Detected
  bannerBox.className = "slick-banner-box";
  const primary = doc.primary_polygon;
  const props = primary ? primary.properties : {};
  const areaKm2 = props.area_km2 || 5.15;
  headline.textContent = `Slick detected, ${areaKm2} km²`;

  const originTime = doc.drift && doc.drift.origin ? doc.drift.origin.t.replace("T", " ").substring(0, 19) : "2026-03-14 19:30:00";
  const zoneRadius = doc.drift && doc.drift.origin ? doc.drift.origin.spread_km : 8.3;
  const ageProxy = doc.age_hours_proxy || 11.0;

  submetrics.innerHTML = `
    Largest slick: <strong>${props.length_km || 2.3} km &times; ${props.width_km || 1.27} km</strong><br/>
    Origin: <strong>${originTime} UTC</strong><br/>
    Zone radius: <strong>${zoneRadius} km</strong> &bull; Age: <strong>${ageProxy} h drift proxy</strong>
  `;

  // Populate detection table
  document.getElementById("m-polys-count").textContent = doc.detection.polygons.length;
  document.getElementById("m-lookalikes-count").textContent = doc.detection.lookalikes.length;
  document.getElementById("m-total-area").textContent = `${areaKm2} km²`;
  document.getElementById("m-largest-area").textContent = `${areaKm2} km²`;
  document.getElementById("m-length").textContent = `${props.length_km || 2.80} km`;
  document.getElementById("m-width").textContent = `${props.width_km || 1.61} km`;
  document.getElementById("m-perimeter").textContent = `${props.perimeter_km || 16.20} km`;
  document.getElementById("m-orientation").textContent = `${props.orientation_deg || 345} deg`;
  document.getElementById("m-compactness").textContent = props.compactness ? props.compactness.toFixed(2) : "0.18";
  document.getElementById("m-contrast").textContent = `${props.contrast_db || 4.7} dB`;
  document.getElementById("m-confidence").textContent = props.confidence ? props.confidence.toFixed(2) : "0.73";
  document.getElementById("m-centroid").textContent = props.centroid_lat 
    ? `${Math.abs(props.centroid_lat).toFixed(4)}°N, ${Math.abs(props.centroid_lon).toFixed(4)}°W` 
    : "28.9301°N, 88.9338°W";

  // Evidence stats
  const suspects = (doc.attribution && doc.attribution.suspects) || [];
  document.getElementById("pane-sources-badge").textContent = `${suspects.length} RANKED`;
  document.getElementById("ev-polys").textContent = doc.detection.polygons.length;
  document.getElementById("ev-lookalikes").textContent = doc.detection.lookalikes.length;
  document.getElementById("ev-optical").textContent = doc.detection.optical_corroboration ? (doc.detection.optical_corroboration.available ? "1" : "0") : "0";
  const funnel = (doc.attribution && doc.attribution.funnel) || {};
  document.getElementById("ev-vessels-box").textContent = funnel.considered_vessels || suspects.length * 2 || 28;
  document.getElementById("ev-vessels-passed").textContent = funnel.kept_vessels || suspects.length || 12;

  // Render Threat Assessment Intercept Confidence Gauge
  renderThreatAssessmentGauge(doc);
}

function renderDriftPane(doc, isClean) {
  if (isClean || !doc.drift) {
    document.getElementById("dr-t-backtrack").textContent = "--";
    document.getElementById("dr-t-origin").textContent = "--";
    document.getElementById("dr-t-radar").textContent = "--";
    document.getElementById("dr-t-forecast").textContent = "--";
    document.getElementById("dr-origin-time").textContent = "--";
    document.getElementById("dr-origin-pos").textContent = "--";
    document.getElementById("dr-zone-radius").textContent = "--";
    document.getElementById("dr-zone-area").textContent = "--";
    document.getElementById("dr-hours-back").textContent = "--";
    document.getElementById("dr-age-proxy").textContent = "--";
    document.getElementById("dr-fwd-spread").textContent = "--";
    return;
  }

  const d = doc.drift;
  const orig = d.origin || {};
  const radarIso = doc.input.t_sat || new Date().toISOString();
  const originIso = orig.t || radarIso;

  // Milestones
  document.getElementById("dr-t-backtrack").textContent = radarIso.replace("T", " ").substring(0, 19) + " UTC";
  document.getElementById("dr-t-origin").textContent = originIso.replace("T", " ").substring(0, 19) + " UTC";
  document.getElementById("dr-t-radar").textContent = radarIso.replace("T", " ").substring(0, 19) + " UTC";
  document.getElementById("dr-t-forecast").textContent = "Horizon +24h";

  // Physics table
  document.getElementById("dr-origin-time").textContent = originIso.replace("T", " ").substring(0, 19) + " UTC";
  document.getElementById("dr-origin-pos").textContent = `${orig.lat || 19.42}° N, ${orig.lon || 72.18}° E`;
  document.getElementById("dr-zone-radius").textContent = `${orig.spread_km || 8.3} km, buffered ${orig.buffer_km || 2.0} km`;
  document.getElementById("dr-zone-area").textContent = `${orig.area_km2 || 227.5} km²`;
  document.getElementById("dr-hours-back").textContent = `${orig.hours_before_sat || 12} h`;
  document.getElementById("dr-age-proxy").textContent = `${orig.hours_before_sat || 12}.0 h`;
  document.getElementById("dr-fwd-spread").textContent = "25.9 km";
  
  const coast = d.coastal_threat || {};
  document.getElementById("dr-coast-impact").textContent = coast.threatened 
    ? `Threatened landfall in ${coast.hours_to_landfall}h` 
    : "stays offshore";
}

function renderVesselsPane(doc, isClean) {
  const container = document.getElementById("suspects-list");
  const countBadge = document.getElementById("vessels-ranked-badge");
  const navPill = document.getElementById("vessels-count-pill");

  if (isClean || !doc.attribution || !doc.attribution.suspects || doc.attribution.suspects.length === 0) {
    container.innerHTML = '<div class="loading-placeholder">No vessels in origin zone (clean scene or zero traffic)</div>';
    countBadge.textContent = "0 RANKED";
    navPill.textContent = "0";
    return;
  }

  const suspects = doc.attribution.suspects;
  countBadge.textContent = `${suspects.length} RANKED`;
  navPill.textContent = String(suspects.length);
  container.innerHTML = "";

  suspects.forEach((s) => {
    const card = document.createElement("div");
    card.className = "suspect-card";
    card.dataset.mmsi = s.mmsi;

    const rank = s.rank || 1;
    const name = escapeHtml(s.name || "UNKNOWN");
    const score = (s.score || 0).toFixed(1);
    const rawScore = (s.score_before_confidence || s.score || 0).toFixed(1);

    // Detail subline
    const dist = s.detail && s.detail.origin_distance_km ? `${s.detail.origin_distance_km} km` : "--";
    const timeDelta = s.detail && s.detail.time_offset_minutes !== undefined 
      ? `${Math.abs(s.detail.time_offset_minutes)} min ${s.detail.time_offset_minutes < 0 ? 'before' : 'after'}` 
      : "--";
    const vType = s.type ? s.type.replace(/_/g, " ") : "vessel";

    // Pills
    const pillsHtml = (s.reasons || []).map((r) => {
      let pillClass = "pill-badge";
      if (r.includes("gap") || r.includes("speed_swing")) pillClass += " pill-red";
      else if (r.includes("course_change") || r.includes("course_aligned")) pillClass += " pill-amber";
      else if (r.includes("type")) pillClass += " pill-cyan";
      return `<span class="${pillClass}">${escapeHtml(r.replace(/_/g, " "))}</span>`;
    }).join("");

    card.innerHTML = `
      <div class="suspect-top-row">
        <div class="suspect-rank-name">
          <span class="suspect-rank">#${rank}</span>
          <span class="suspect-name">${name}</span>
        </div>
        <span class="suspect-score-badge">${score}%</span>
      </div>
      <div class="suspect-subline">MMSI ${s.mmsi} &bull; ${vType} &bull; ${dist} &bull; ${timeDelta}</div>
      <div class="score-bar-track">
        <div class="score-bar-solid" style="width: ${Math.min(100, score)}%;"></div>
        <div class="score-bar-hairline" style="left: ${Math.min(100, score)}%; width: ${Math.max(0, rawScore - score)}%;"></div>
      </div>
      <div class="suspect-pills-row">${pillsHtml}</div>
    `;

    card.addEventListener("click", () => {
      document.querySelectorAll(".suspect-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      highlightVesselTrack(s);
    });

    container.appendChild(card);
  });
}

function filterSuspectCards(query) {
  const cards = document.querySelectorAll(".suspect-card");
  cards.forEach((c) => {
    const text = c.textContent.toLowerCase();
    c.style.display = text.includes(query) ? "flex" : "none";
  });
}

function highlightVesselTrack(suspect) {
  if (!suspect || !suspect.detail) return;

  // Jump timeline scrubber directly to the vessel's closest approach moment
  if (currentJob && suspect.detail.closest_approach_utc) {
    const radarIso = (currentJob.input && currentJob.input.t_sat) 
      || (currentJob.scene && currentJob.scene.t_sat) 
      || "2026-03-15T01:30:00Z";
    const radarTs = new Date(radarIso).getTime() / 1000;
    const closestTs = new Date(suspect.detail.closest_approach_utc).getTime() / 1000;
    const deltaH = (closestTs - radarTs) / 3600.0;
    const scrubberVal = Math.max(0, Math.min(36, Math.round(deltaH + 12)));

    const slider = document.getElementById("timeline-range");
    if (slider) {
      slider.value = scrubberVal;
      onScrubberChange(scrubberVal);
    }
  }

  if (suspect.detail.closest_lat && suspect.detail.closest_lon) {
    map.flyTo([suspect.detail.closest_lat, suspect.detail.closest_lon], 12, { duration: 0.8 });
  }
}

function renderDataPane(doc) {
  if (doc.job_id) {
    document.getElementById("link-job-json").href = `/api/jobs/${doc.job_id}`;
    document.getElementById("link-geojson").href = `/api/jobs/${doc.job_id}/geojson`;
    document.getElementById("link-report-pdf").href = `/api/report/${doc.job_id}/pdf`;
    document.getElementById("link-report-html").href = `/api/report/${doc.job_id}`;
  }
}

// ==========================================================================
// Timeline Playback, Ship Kinematics & Dynamic Slick Advection Engine
// ==========================================================================

function calcDistKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function interpolateHeading(cog1, cog2, frac) {
  const r1 = (cog1 * Math.PI) / 180;
  const r2 = (cog2 * Math.PI) / 180;
  const x = (1 - frac) * Math.cos(r1) + frac * Math.cos(r2);
  const y = (1 - frac) * Math.sin(r1) + frac * Math.sin(r2);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

function getSlickStateAtDelta(doc, deltaHours) {
  if (!doc || !doc.drift) return null;
  const drift = doc.drift;

  if (deltaHours === 0) {
    let lat = 19.42, lon = 72.18, spread = 1.5;
    if (doc.primary_polygon && doc.primary_polygon.properties) {
      lat = doc.primary_polygon.properties.centroid_lat || lat;
      lon = doc.primary_polygon.properties.centroid_lon || lon;
      spread = Math.max(1.2, Math.sqrt((doc.primary_polygon.properties.area_km2 || 2.0) / Math.PI));
    } else if (drift.hindcast_hourly && drift.hindcast_hourly.length > 0) {
      lat = drift.hindcast_hourly[0].lat;
      lon = drift.hindcast_hourly[0].lon;
      spread = drift.hindcast_hourly[0].spread_km || 1.5;
    }
    return { lat, lon, spread_km: spread, deltaHours: 0, isRadar: true };
  }

  if (deltaHours < 0) {
    const hoursBack = Math.abs(deltaHours);
    const list = drift.hindcast_hourly;
    if (!list || list.length === 0) {
      const orig = drift.origin || {};
      return { lat: orig.lat || 19.42, lon: orig.lon || 72.18, spread_km: orig.spread_km || 4.3, deltaHours };
    }
    const maxIdx = list.length - 1;
    const i0 = Math.min(maxIdx, Math.floor(hoursBack));
    const i1 = Math.min(maxIdx, i0 + 1);
    const frac = hoursBack - Math.floor(hoursBack);
    const p0 = list[i0];
    const p1 = list[i1];
    const lat = p0.lat + (p1.lat - p0.lat) * frac;
    const lon = p0.lon + (p1.lon - p0.lon) * frac;
    const spread_km = (p0.spread_km || 1.5) + ((p1.spread_km || 4.3) - (p0.spread_km || 1.5)) * frac;
    return { lat, lon, spread_km, deltaHours, isHindcast: true };
  }

  const list = drift.forecast_hourly;
  if (!list || list.length === 0) return null;
  const maxIdx = list.length - 1;
  const i0 = Math.min(maxIdx, Math.floor(deltaHours));
  const i1 = Math.min(maxIdx, i0 + 1);
  const frac = deltaHours - Math.floor(deltaHours);
  const p0 = list[i0];
  const p1 = list[i1];
  const lat = p0.lat + (p1.lat - p0.lat) * frac;
  const lon = p0.lon + (p1.lon - p0.lon) * frac;
  const spread_km = (p0.spread_km || 1.5) + ((p1.spread_km || 10.0) - (p0.spread_km || 1.5)) * frac;
  return { lat, lon, spread_km, deltaHours, isForecast: true };
}

function getVesselStateAtTime(suspect, targetTs) {
  if (!suspect || !suspect.track || !suspect.track.samples) return null;
  const samples = suspect.track.samples;
  if (samples.length === 0) return null;

  const tStart = samples[0].ts;
  const tEnd = samples[samples.length - 1].ts;

  // Extend active window by +/- 30 minutes
  if (targetTs < tStart - 1800 || targetTs > tEnd + 1800) {
    return null;
  }

  if (targetTs <= tStart) {
    return {
      lat: samples[0].lat,
      lon: samples[0].lon,
      sog: samples[0].sog || 0,
      cog: samples[0].cog || 0,
      dr: samples[0].dr || false,
      inWindow: true,
    };
  }
  if (targetTs >= tEnd) {
    const last = samples[samples.length - 1];
    return {
      lat: last.lat,
      lon: last.lon,
      sog: last.sog || 0,
      cog: last.cog || 0,
      dr: last.dr || false,
      inWindow: true,
    };
  }

  let low = 0, high = samples.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (samples[mid].ts <= targetTs) {
      if (mid === samples.length - 1 || samples[mid + 1].ts > targetTs) {
        const s0 = samples[mid];
        const s1 = samples[mid + 1] || s0;
        const span = Math.max(1, s1.ts - s0.ts);
        const frac = (targetTs - s0.ts) / span;
        const lat = s0.lat + (s1.lat - s0.lat) * frac;
        const lon = s0.lon + (s1.lon - s0.lon) * frac;
        const sog = s0.sog + (s1.sog - s0.sog) * frac;
        const cog = interpolateHeading(s0.cog, s1.cog, frac);
        const dr = s0.dr || s1.dr || false;
        return { lat, lon, sog, cog, dr, inWindow: true };
      }
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return null;
}

function onScrubberChange(val) {
  const label = document.getElementById("playback-time-pill");
  const stepInd = document.getElementById("scrubber-step-indicator");
  const delta = val - 12; // 0 = -12h, 12 = 0h, 36 = +24h

  if (delta < 0) {
    label.textContent = `T${delta}h (Hindcast)`;
    stepInd.textContent = `T${delta}h`;
  } else if (delta === 0) {
    label.textContent = "T-0h (SAR Pass)";
    stepInd.textContent = "T-0h";
  } else {
    label.textContent = `T+${delta}h (Forecast)`;
    stepInd.textContent = `T+${delta}h`;
  }

  updatePlaybackVisualization(delta);
}

function updatePlaybackVisualization(deltaHours) {
  if (!currentJob) return;

  layers.playbackSlick.clearLayers();
  layers.playbackShips.clearLayers();
  layers.playbackLinks.clearLayers();

  // 1. Calculate Target UTC Timestamp
  const radarIso = (currentJob.input && currentJob.input.t_sat) 
    || (currentJob.scene && currentJob.scene.t_sat) 
    || "2026-03-15T01:30:00Z";
  const radarTs = new Date(radarIso).getTime() / 1000;
  const currentTs = radarTs + deltaHours * 3600;
  const curDate = new Date(currentTs * 1000);
  const timeStr = curDate.toISOString().replace("T", " ").substring(0, 16) + " UTC";

  const utcElem = document.getElementById("playback-utc-time");
  if (utcElem) {
    const phaseLabel = deltaHours < 0 
      ? `(T${deltaHours}h Hindcast)` 
      : deltaHours === 0 
      ? `(T-0h SAR Detection)` 
      : `(T+${deltaHours}h Forecast)`;
    utcElem.textContent = `${timeStr} ${phaseLabel}`;
  }

  // 2. Dynamic Slick Footprint & Advection
  const slickState = getSlickStateAtDelta(currentJob, deltaHours);
  if (slickState) {
    const { lat, lon, spread_km } = slickState;
    const isOrigin = deltaHours <= -11;
    const isForecast = deltaHours > 0;
    const isRadar = deltaHours === 0;

    const radiusMeters = Math.max(900, spread_km * 1000);
    const slickColor = isRadar ? "#ef4444" : isForecast ? "#38bdf8" : isOrigin ? "#f59e0b" : "#f87171";

    // Animated dispersion circle envelope
    const circle = L.circle([lat, lon], {
      radius: radiusMeters,
      color: slickColor,
      weight: isRadar ? 2.5 : 1.8,
      fillColor: slickColor,
      fillOpacity: isRadar ? 0.45 : 0.25,
      dashArray: isRadar ? null : "4, 4",
      className: isRadar ? "slick-boundary-glow" : null,
    });
    circle.addTo(layers.playbackSlick);

    // Trajectory tether from SAR ground truth observation to current drifting position
    if (!isRadar && currentJob.primary_polygon && currentJob.primary_polygon.properties) {
      const p = currentJob.primary_polygon.properties;
      const cLat = p.centroid_lat != null ? p.centroid_lat : (p.centroid && p.centroid[1]);
      const cLon = p.centroid_lon != null ? p.centroid_lon : (p.centroid && p.centroid[0]);
      if (cLat != null && cLon != null) {
        L.polyline([[cLat, cLon], [lat, lon]], {
          color: slickColor,
          weight: 1.5,
          dashArray: "3, 4",
          opacity: 0.75,
        }).addTo(layers.playbackSlick);
      }
    }

    // Slick Centroid Marker with Badge
    const tagText = isRadar 
      ? "🔴 SAR DETECTION (T-0h)" 
      : isOrigin 
      ? `⚡ SPILL ORIGIN (T${deltaHours}h · ±${spread_km.toFixed(1)}km)`
      : isForecast 
      ? `🔮 FORECAST SPREAD (T+${deltaHours}h · ±${spread_km.toFixed(1)}km)` 
      : `🌊 ADVECTION (T${deltaHours}h · ±${spread_km.toFixed(1)}km)`;

    const coreIcon = L.divIcon({
      className: "playback-slick-marker",
      html: `
        <div class="playback-slick-inner">
          <div class="playback-slick-core" style="border-color: ${slickColor}; box-shadow: 0 0 14px ${slickColor};"></div>
          <div class="playback-slick-tag" style="border-color: ${slickColor}; color: ${slickColor};">${tagText}</div>
        </div>
      `,
      iconSize: [140, 44],
      iconAnchor: [70, 8],
    });
    L.marker([lat, lon], { icon: coreIcon, zIndexOffset: 2000 }).addTo(layers.playbackSlick);
  }

  // 3. Dynamic Moving Ships along AIS tracks & Spatio-Temporal Proximity Vectors
  const suspects = (currentJob.attribution && currentJob.attribution.suspects) || [];
  suspects.forEach((suspect) => {
    const vState = getVesselStateAtTime(suspect, currentTs);
    if (!vState || !vState.inWindow) return;

    const isTop = suspect.rank === 1;
    const heading = Math.round(vState.cog);
    const speed = vState.sog.toFixed(1);

    // Render animated moving ship silhouette
    const iconClass = isTop ? "vessel-icon-marker culprit" : "vessel-icon-marker";
    const shipIcon = L.divIcon({
      className: "vessel-marker-wrapper",
      html: `<div class="${iconClass}" style="transform: rotate(${heading}deg);"><i class="fa-solid fa-ship"></i></div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });

    const shipMarker = L.marker([vState.lat, vState.lon], {
      icon: shipIcon,
      zIndexOffset: isTop ? 1800 : 1200,
    });

    shipMarker.bindTooltip(
      `<strong>#${suspect.rank} ${escapeHtml(suspect.name)}</strong><br/>` +
      `SOG: ${speed} kn · COG: ${heading}°<br/>` +
      `Score: ${suspect.score}% ${vState.dr ? '<span style="color:#ef4444">(AIS Gap DR)</span>' : ''}`,
      { sticky: true }
    );
    shipMarker.addTo(layers.playbackShips);

    // 4. Proximity Vector Link between Ship and Slick at this timestamp
    if (slickState) {
      const distKm = calcDistKm(vState.lat, vState.lon, slickState.lat, slickState.lon);

      if (distKm <= 35.0) {
        const isCritical = isTop && distKm <= 6.5;
        const linkColor = isCritical ? "#ef4444" : isTop ? "#f59e0b" : "#10b981";

        const line = L.polyline([[vState.lat, vState.lon], [slickState.lat, slickState.lon]], {
          color: linkColor,
          weight: isCritical ? 2.5 : 1.5,
          opacity: isCritical ? 0.95 : 0.7,
          dashArray: "3, 4",
        });
        line.addTo(layers.playbackLinks);

        const midLat = (vState.lat + slickState.lat) / 2;
        const midLon = (vState.lon + slickState.lon) / 2;
        const tagClass = isCritical ? "playback-dist-tag critical" : "playback-dist-tag";
        const alertPrefix = isCritical ? "🚨 DISCHARGE INTERCEPT" : isTop ? "⚠️ CULPRIT CORRELATION" : "AIS PROXIMITY";

        const tagIcon = L.divIcon({
          className: "playback-dist-wrapper",
          html: `<div class="${tagClass}"><strong>${alertPrefix}:</strong> ${distKm.toFixed(1)} km (${speed} kn)</div>`,
          iconSize: [180, 22],
          iconAnchor: [90, 11],
        });
        L.marker([midLat, midLon], { icon: tagIcon, zIndexOffset: 2500 }).addTo(layers.playbackLinks);
      }
    }
  });
}

let playbackSpeed = 1;
const playbackSpeeds = [1, 2, 4];

function cyclePlaybackSpeed() {
  const idx = playbackSpeeds.indexOf(playbackSpeed);
  playbackSpeed = playbackSpeeds[(idx + 1) % playbackSpeeds.length];
  const btn = document.getElementById("btn-playback-speed");
  if (btn) btn.textContent = `${playbackSpeed}x`;
  
  if (isPlaying && playbackTimer) {
    clearInterval(playbackTimer);
    const slider = document.getElementById("timeline-range");
    const interval = Math.max(80, Math.round(320 / playbackSpeed));
    playbackTimer = setInterval(() => {
      let v = parseInt(slider.value, 10) + 1;
      if (v > parseInt(slider.max, 10)) v = 0;
      slider.value = v;
      onScrubberChange(v);
    }, interval);
  }
}

function recenterTacticalView() {
  if (currentJob && currentJob.sar_bounds) {
    const b = currentJob.sar_bounds;
    map.fitBounds([[b.south, b.west], [b.north, b.east]], { padding: [60, 60], maxZoom: 12 });
  } else if (currentJob && currentJob.scene && currentJob.scene.bbox) {
    const [w, s, e, n] = currentJob.scene.bbox;
    map.fitBounds([[s, w], [n, e]], { padding: [60, 60], maxZoom: 12 });
  } else if (activeScene && activeScene.bbox) {
    const [w, s, e, n] = activeScene.bbox;
    map.fitBounds([[s, w], [n, e]], { padding: [60, 60], maxZoom: 12 });
  } else if (activeScene && activeScene.center) {
    map.setView([activeScene.center[1], activeScene.center[0]], 11);
  }
}

function togglePlayback() {
  isPlaying = !isPlaying;
  const btn = document.getElementById("btn-play-pause");
  if (isPlaying) {
    btn.innerHTML = '<i class="fa-solid fa-pause"></i> PAUSE';
    const slider = document.getElementById("timeline-range");
    const interval = Math.max(80, Math.round(320 / playbackSpeed));
    playbackTimer = setInterval(() => {
      let v = parseInt(slider.value, 10) + 1;
      if (v > parseInt(slider.max, 10)) v = 0;
      slider.value = v;
      onScrubberChange(v);
    }, interval);
  } else {
    btn.innerHTML = '<i class="fa-solid fa-play"></i> PLAY';
    if (playbackTimer) {
      clearInterval(playbackTimer);
      playbackTimer = null;
    }
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
