// ── Token Mapbox ──────────────────────────────────────────────────────────────
// Reemplaza este valor con tu token de Mapbox:  https://account.mapbox.com/access-tokens/
mapboxgl.accessToken = window.MAPBOX_TOKEN;

// ── Paleta de colores por ruta ────────────────────────────────────────────────
const ROUTE_COLORS = {
    "10": "#E6194B",
    "16": "#3CB44B",
    "22": "#911EB4",
    "25": "#F032E6",
    "26": "#FF5722",
    "27": "#3F51B5",
};

function colorForRoute(routeNum) { return ROUTE_COLORS[routeNum] || "#999999"; }

// ── Mapa ──────────────────────────────────────────────────────────────────────
const map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/crisreno/cmpd7jfkk000201qygdet1lne",
    center: [-99.228, 19.520],
    zoom: 11,
});
map.addControl(new mapboxgl.NavigationControl(), "top-right");

const SOURCE_ID     = "paradas";
const LINES_ID      = "rutas-lines";
const LAYER_LINES   = "rutas-lines-layer";
const LAYER_CIRCLES = "paradas-circles";
const LAYER_LABELS  = "paradas-labels";

let routesData = {}; // { ruta: { subruta: [{ parada, lat, lng }...] } }
let activeSubroute = null; // { ruta, subruta }

function applyFilter() {
    if (!activeSubroute) {
        // Sin selección: ocultar todo
        map.setFilter(LAYER_LINES,   ["==", "subruta", "__none__"]);
        map.setFilter(LAYER_CIRCLES, ["==", "subruta", "__none__"]);
        map.setFilter(LAYER_LABELS,  ["==", "subruta", "__none__"]);
        return;
    }
    
    const { ruta, subruta } = activeSubroute;
    const filter = ["all",
        ["==", ["get", "ruta"], ruta],
        ["==", ["get", "subruta"], subruta]
    ];
    
    map.setFilter(LAYER_LINES,   filter);
    map.setFilter(LAYER_CIRCLES, filter);
    map.setFilter(LAYER_LABELS,  filter);
}

// Popup
const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false });
map.on("mouseenter", LAYER_CIRCLES, (e) => {
    map.getCanvas().style.cursor = "pointer";
    const { ruta, subruta, parada } = e.features[0].properties;
    const color = colorForRoute(ruta);
    popup
        .setLngLat(e.features[0].geometry.coordinates)
        .setHTML(`<div class="popup-route" style="color:${color}"><strong>Ruta ${ruta}</strong></div><div class="popup-subroute">${subruta}</div><div class="popup-stop">${parada}</div>`)
        .addTo(map);
});
map.on("mouseleave", LAYER_CIRCLES, () => {
    map.getCanvas().style.cursor = "";
    popup.remove();
});

// Construir acordeón de rutas
function buildAccordion(routesData) {
    const container = document.getElementById("route-list");
    container.innerHTML = "";
    
    const sortedRoutes = Object.keys(routesData).sort((a, b) => parseInt(a) - parseInt(b));
    
    sortedRoutes.forEach(ruta => {
        const subrutas = Object.keys(routesData[ruta]);
        const color = colorForRoute(ruta);
        
        // Contenedor de la ruta
        const routeDiv = document.createElement("div");
        routeDiv.className = "accordion-item";
        
        // Header de la ruta
        const header = document.createElement("div");
        header.className = "accordion-header";
        header.style.borderColor = color;
        header.innerHTML = `<span class="dot" style="background:${color}"></span><span>Ruta ${ruta}</span><span class="toggle-icon">▼</span>`;
        
        // Contenedor de subrutas
        const subroutesDiv = document.createElement("div");
        subroutesDiv.className = "accordion-content";
        
        subrutas.forEach(subruta => {
            const subBtn = document.createElement("button");
            subBtn.className = "subroute-btn";
            subBtn.style.borderLeftColor = color;
            subBtn.textContent = subruta;
            subBtn.dataset.ruta = ruta;
            subBtn.dataset.subruta = subruta;
            
            subBtn.addEventListener("click", () => {
                // Actualizar selección activa
                document.querySelectorAll(".subroute-btn").forEach(b => b.classList.remove("active"));
                subBtn.classList.add("active");
                
                activeSubroute = { ruta, subruta };
                applyFilter();
            });
            
            subroutesDiv.appendChild(subBtn);
        });
        
        // Toggle al hacer clic en el header
        header.addEventListener("click", () => {
            const isHidden = !subroutesDiv.classList.contains("show");
            subroutesDiv.classList.toggle("show", isHidden);
            header.classList.toggle("open", isHidden);
        });
        
        routeDiv.appendChild(header);
        routeDiv.appendChild(subroutesDiv);
        container.appendChild(routeDiv);
    });
}

// Cargar CSV
map.on("load", () => {
    Papa.parse("data/points.csv", {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: ({ data }) => {
            // Agrupar datos por Ruta y Subruta
            data.filter(row => row.Ruta && row.Subruta && row.Parada && row.Latitud && row.Longitud).forEach(row => {
                const ruta = row.Ruta;
                const subruta = row.Subruta;
                
                if (!routesData[ruta]) routesData[ruta] = {};
                if (!routesData[ruta][subruta]) routesData[ruta][subruta] = [];
                
                routesData[ruta][subruta].push({
                    parada: row.Parada,
                    lat: parseFloat(row.Latitud),
                    lng: parseFloat(row.Longitud)
                });
            });
            
            // Crear GeoJSON de líneas (una LineString por subruta)
            const linesGeojson = {
                type: "FeatureCollection",
                features: []
            };
            
            // Crear GeoJSON de puntos (una Feature por parada)
            const geojson = {
                type: "FeatureCollection",
                features: []
            };
            
            // Iterar por todas las rutas y subrutas
            Object.entries(routesData).forEach(([ruta, subrutas]) => {
                Object.entries(subrutas).forEach(([subruta, paradas]) => {
                    // LineString para esta subruta
                    if (paradas.length > 1) {
                        const coords = paradas.map(p => [p.lng, p.lat]);
                        linesGeojson.features.push({
                            type: "Feature",
                            geometry: { type: "LineString", coordinates: coords },
                            properties: { ruta, subruta }
                        });
                    }
                    
                    // Points para cada parada
                    paradas.forEach(parada => {
                        geojson.features.push({
                            type: "Feature",
                            geometry: { type: "Point", coordinates: [parada.lng, parada.lat] },
                            properties: { ruta, subruta, parada: parada.parada }
                        });
                    });
                });
            });
            
            // ── Fuentes ──────────────────────────────────────────────────────
            map.addSource(LINES_ID,  { type: "geojson", data: linesGeojson });
            map.addSource(SOURCE_ID, { type: "geojson", data: geojson });
            
            // Construir expresión de colores por ruta
            const colorExpr = ["match", ["get", "ruta"]];
            Object.keys(ROUTE_COLORS).forEach(ruta => {
                colorExpr.push(ruta, colorForRoute(ruta));
            });
            colorExpr.push("#999999");
            
            // ── Capa: líneas de ruta ──────────────────────────────────────────
            map.addLayer({
                id: LAYER_LINES,
                type: "line",
                source: LINES_ID,
                layout: { "line-join": "round", "line-cap": "round" },
                paint: {
                    "line-color": colorExpr,
                    "line-width": ["interpolate", ["linear"], ["zoom"], 9, 2, 14, 4],
                    "line-opacity": 0.8,
                },
            });
            
            // ── Capa: círculos de paradas ─────────────────────────────────────
            map.addLayer({
                id: LAYER_CIRCLES,
                type: "circle",
                source: SOURCE_ID,
                paint: {
                    "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 5, 14, 10],
                    "circle-color": ["case",
                        ["boolean", ["feature-state", "hover"], false],
                        "#FFD700",
                        colorExpr
                    ],
                    "circle-stroke-color": "#ffffff",
                    "circle-stroke-width": 1.5,
                    "circle-opacity": 0.9,
                },
            });
            
            // ── Capa: etiquetas de paradas ────────────────────────────────────
            map.addLayer({
                id: LAYER_LABELS,
                type: "symbol",
                source: SOURCE_ID,
                minzoom: 13,
                layout: {
                    "text-field": ["get", "parada"],
                    "text-size": 11,
                    "text-offset": [0, 1.3],
                    "text-anchor": "top",
                },
                paint: {
                    "text-color": "#222222",
                    "text-halo-color": "#ffffff",
                    "text-halo-width": 1.5,
                },
            });
            
            // Construir acordeón
            buildAccordion(routesData);
        },
    });
});