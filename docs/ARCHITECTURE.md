# SeaSentinel: Architectural Specification & Offline Boundary

![SeaSentinel C4ISR System Architecture](../architecture_diagram.svg)

## 1. System Overview & C4ISR Architecture

**SeaSentinel** is engineered as an intelligence-grade, air-gapped maritime surveillance and attribution platform designed to support the **National Technical Research Organisation (NTRO)**, Indian Coast Guard, and naval maritime domain awareness (MDA) enclaves.

The platform unifies multi-sensor satellite Earth observation, hydrodynamic Lagrangian physics, and high-frequency Automatic Identification System (AIS) telemetry into a court-defensible forensic pipeline.

### End-to-End System Architecture (Mermaid)

```mermaid
flowchart TD
    %% Styling classes
    classDef sensor fill:#210c38,stroke:#a855f7,stroke-width:2px,color:#fff;
    classDef cache fill:#1e1b4b,stroke:#6366f1,stroke-width:2px,color:#fff;
    classDef engine fill:#0b2b3a,stroke:#0284c7,stroke-width:2px,color:#fff;
    classDef scoring fill:#0e3328,stroke:#10b981,stroke-width:2px,color:#fff;
    classDef ui fill:#3b0764,stroke:#d946ef,stroke-width:2px,color:#fff;

    subgraph L1 ["LAYER 1: MULTI-SOURCE SENSORS & INGESTION (Online Prep Lane)"]
        S1["🛰️ Sentinel-1 SAR IW GRD<br/>C-Band (10m RTC, VV/VH)"]:::sensor
        S2["📷 Sentinel-2 MSI<br/>Level-2A Surface Refl."]:::sensor
        S3["🌊 CMEMS Currents &<br/>Open-Meteo ERA5 10m Wind"]:::sensor
        S4["🚢 MarineCadastre AIS<br/>Historical Broadcast Archives"]:::sensor
    end

    subgraph L_CACHE ["LOCAL DISK CACHE (The Offline Interface)"]
        C1[("📁 data/scenes/<br/>SAR GeoTIFFs")]:::cache
        C2[("📁 data/optical/<br/>S2 RGB Chips")]:::cache
        C3[("📁 data/metocean/<br/>*.npz Wind/Current Grids")]:::cache
        C4[("🗄️ data/ais/ais.sqlite<br/>Indexed AIS Telemetry")]:::cache
    end

    S1 -->|prepare_scenes.py| C1
    S2 -->|download_chips.py| C2
    S3 -->|build_metocean.py| C3
    S4 -->|ingest_ais.py| C4

    subgraph L2 ["LAYER 2: ANALYTICAL & AI PIPELINE (100% Offline Engine)"]
        E1["1. SAR ML Detector<br/>PyTorch U-Net (512px Tiles)<br/>Adaptive dB Baseline Fallback"]:::engine
        E2["2. LocalAEQD Morphometry<br/>Moore Boundary Trace<br/>Douglas-Peucker Simplification<br/>PCA Slick Orientation"]:::engine
        E3["3. Optical Corroborator<br/>Multispectral Band Ratio<br/>Biogenic/False-Alarm Filter"]:::engine
        E4["4. Lagrangian Drift Engine<br/>RK2 Midpoint Advection<br/>Hindcasting (Δt < 0) -> Origin<br/>Forecasting (Δt > 0) -> Cone"]:::engine
        E5["5. Spatiotemporal AIS Funnel<br/>BBox Clipping & Window Filter<br/>1-Min LocalAEQD Interpolation<br/>Dark-Ship Gap Classifier"]:::engine
    end

    C1 --> E1
    E1 -->|Binary Slick Mask| E2
    C2 --> E3
    E2 -->|Slick Contours| E4
    C3 --> E4
    E4 -->|Frozen Origin Zone & Time| E5
    C4 --> E5

    subgraph L3 ["LAYER 3: EXPLAINABLE MULTI-CRITERIA SCORING CORE"]
        SC1["Proximity Score (S_prox, 30%)<br/>exp(-d_origin / R_zone)"]:::scoring
        SC2["Temporal Coincidence (S_time, 20%)<br/>exp(-|Δt| / 1.5h)"]:::scoring
        SC3["Drift Trajectory Match (S_traj, 10%)<br/>COG vs Origin-to-Slick Bearing"]:::scoring
        SC4["Vessel Risk Prior (S_type, 15%)<br/>MARPOL & ITU-R M.1371 Pointers"]:::scoring
        SC5["Behavioral Signatures (S_beh, 25%)<br/>Discharge Speed, Course Jumps, AIS Gaps"]:::scoring
        CONF["Track Confidence Multiplier (C_track)<br/>1.0 - 0.65 × Fraction_DeadReckoned"]:::scoring
        FUSION["Final Score = 100 × (Σ w_i S_i / Σ w_i) × C_track"]:::scoring
    end

    E5 --> SC1 & SC2 & SC3 & SC4 & SC5 & CONF
    SC1 & SC2 & SC3 & SC4 & SC5 & CONF --> FUSION

    subgraph L4 ["LAYER 4: TACTICAL C4ISR CONSOLE & LEGAL ENFORCEMENT"]
        JOB[("📄 data/jobs/<id>.json<br/>Atomic Audit Document")]:::cache
        UI1["Tactical GIS Web Map<br/>Full-Bleed Leaflet 1.9<br/>Range Rings, Layer Toggles"]:::ui
        UI2["4D Lagrangian Flight Deck<br/>Scrubbable Timeline (-12h to +24h)<br/>Kinematic Motion Simulator"]:::ui
        UI3["Vessel Dossier Leaderboard<br/>Ranked Suspects with Evidence<br/>Solid-to-Hairline Score Bars"]:::ui
        UI4["Legal Law Enforcement Memo<br/>Maritime Attribution Note (PDF/HTML)<br/>GeoJSON Vector Intercept Data"]:::ui
    end

    FUSION --> JOB
    JOB --> UI1 & UI2 & UI3 & UI4
```

---

## 2. Runtime Execution Lifecycle (Sequence Diagram)

When an operator triggers surveillance via the UI button (`EXECUTE SURVEILLANCE`) or headless CLI (`python3 main.py --run s1_mumbai_high_01`), the system executes a deterministic sequence:

```mermaid
sequenceDiagram
    autonumber
    actor Operator as Maritime Operator / CLI
    participant Web as Web Command Console (web/)
    participant API as FastAPI Gateway (seasentinel/api/)
    participant ML as CV/ML Engine (seasentinel/ml/)
    participant Geo as Geodesy Engine (seasentinel/geo/)
    participant Drift as Lagrangian RK2 (seasentinel/drift/)
    participant AIS as AIS Store & Funnel (seasentinel/ais/)
    participant Scorer as Explainable Scorer (seasentinel/ais/score.py)
    participant Store as Audit Job Store (seasentinel/jobs/)

    Operator->>Web: Click "EXECUTE SURVEILLANCE"
    Web->>API: POST /api/run {"scene_id": "s1_mumbai_high_01"}
    Note over API: Step 1: Segmentation
    API->>ML: infer_slick_pixels(sar_chip, threshold, tile=512)
    ML-->>API: Binary raster mask, water noise floor (dB)
    
    Note over API: Step 2: Geometric Morphometry
    API->>Geo: extract_contours_and_metrics(mask, affine, crs)
    Geo-->>API: Polygons, Area (km²), Length, Width, Orientation, Centroid

    Note over API: Step 3: Metocean Interpolation
    API->>Drift: load_metocean_cube(bbox, t_sat)
    Drift-->>API: Bilinear U_curr, V_curr, U_wind10, V_wind10

    Note over API: Step 4: Backward Hindcast
    API->>Drift: advect_particles(direction="backward", 50 particles, RK2)
    Drift-->>API: Origin Zone [lat, lon, R_zone], t_origin, Reverse Path

    Note over API: Step 5: Forward Dispersion Forecast
    API->>Drift: advect_particles(direction="forward", +36h, RK2)
    Drift-->>API: Forecast Cone, Threatened BBox, Coast Landfall Flag

    Note over API: Step 6: AIS Spatiotemporal Filter
    API->>AIS: query_candidates(BBox, [t_origin - W, t_origin + W])
    AIS-->>API: Raw candidate AIS positions
    API->>AIS: interpolate_and_detect_gaps(tracks, step=60s)
    AIS-->>API: Clean 1-min tracks with dead-reckoned gap flags

    Note over API: Step 7: Multi-Factor Scoring
    API->>Scorer: score_candidates(tracks, origin_envelope)
    Scorer-->>API: Ranked suspect leaderboard with reason codes & C_track

    Note over API: Step 8: Atomic Audit Persistence
    API->>Store: save_atomic_job(job_document)
    Store-->>API: job_id, storage_uri
    API-->>Web: 200 OK {status: "completed", job_id, ...}
    Web->>Operator: Synchronized Map Overlays, Kinematic Scrubber & Leaderboard
```

---

## 3. The Offline Air-Gap Boundary Specification

In military C4ISR facilities, edge patrol cutters, and coastal radar stations, computing systems must comply with strict physical and network isolation protocols.

### Architectural Invariants:
1. **Zero Runtime Outbound Calls**:
   All networking code is restricted to `scripts/` (executed once during data staging). The core engine `seasentinel/` has no HTTP client, WebSocket client, or DNS lookup capabilities during runtime.
2. **Local Storage Compliance**:
   All datasets are stored in self-contained, queryable formats on local solid-state drives:
   - SAR Imagery: Level-1 Ground Range Detected (GRD) GeoTIFFs (`data/scenes/`)
   - AIS Position Feeds: Indexed SQLite tables compliant with the MarineCadastre column dictionary (`data/ais/ais.sqlite`)
   - Metocean Fields: Precomputed NumPy structured multidimensional velocity grids (`data/metocean/*.npz`)
3. **Reproducibility & Verification**:
   Running `POST /api/run` twice with the same inputs produces byte-identical JSON outputs, ensuring court admissibility under maritime pollution prosecution protocols.

---

## 4. Resilience & Zero-Dependency Fallbacks

SeaSentinel eliminates fragile C/C++ compilation failures by providing transparent, hand-crafted pure-Python implementations for all geospatial operations:

| Subsystem | Primary Component | Zero-Dependency Fallback | Algorithmic Mechanism |
| :--- | :--- | :--- | :--- |
| **Raster GeoTIFF IO** | `rasterio` (GDAL) | `seasentinel/geo/tiffio.py` | Native binary parser supporting uncompressed and Deflate-compressed strip/tiled TIFFs. |
| **Cartographic Projections** | `pyproj` (PROJ.4) | `seasentinel/geo/crs.py` | Analytical spherical trigonometry for Local Azimuthal Equidistant (LocalAEQD) transformation. |
| **Vector Geometry** | `shapely` (GEOS) | `seasentinel/geo/geometry.py` | Custom Ray-Casting Point-in-Polygon (PIP), Moore contour tracing, and Douglas-Peucker reduction. |
| **Morphology Filters** | `scipy.ndimage` | Pure NumPy kernels | Binary dilation, erosion, and connected-component labeling using vector operations. |
| **AI Segmentation** | PyTorch CUDA/MPS | Adaptive relative dB | Statistical dark-patch thresholding dynamically tracking ocean backscatter noise floor. |
| **Forensic Reporting** | `reportlab` | Standalone HTML | High-fidelity print-optimized HTML templates with CSS `@media print` directives. |