// ── Token Mapbox ──────────────────────────────────────────────────────────────
// Reemplaza este valor con tu token de Mapbox:  https://account.mapbox.com/access-tokens/
mapboxgl.accessToken = window.MAPBOX_TOKEN;

// ── Paleta de colores por ruta ────────────────────────────────────────────────
const ROUTE_COLORS = {
    "10": "#58AD46",
    "16": "#B8D433",
    "22": "#7a2a83",
    "25": "#12B5EA",
    "26": "#C22126",
    "27": "#EA6AA1",
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

const SOURCE_ID           = "paradas";
const DIRECTIONS_SOURCE_ID = "directions-route";
const LAYER_DIRECTIONS     = "directions-route-layer";
const LAYER_CIRCLES        = "paradas-circles";
const LAYER_LABELS         = "paradas-labels";

let routesData = {}; // { ruta: { subruta: [{ parada, lat, lng }...] } }
let activeSubroute = null; // { ruta, subruta }
let directionsCache = {}; // Cache local de geometrías de direcciones

function applyFilter() {
    if (!activeSubroute) {
        // Sin selección: ocultar todo y borrar la ruta mostrada
        map.setFilter(LAYER_CIRCLES, ["==", ["get", "subruta"], "__none__"]);
        map.setFilter(LAYER_LABELS,  ["==", ["get", "subruta"], "__none__"]);
        map.getSource(DIRECTIONS_SOURCE_ID)?.setData({ type: "FeatureCollection", features: [] });
        return;
    }
    
    const { ruta, subruta } = activeSubroute;
    const filter = ["all",
        ["==", ["get", "ruta"], ruta],
        ["==", ["get", "subruta"], subruta]
    ];
    
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
    let defaultSelection = null;
    
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
        const isDefaultOpen = ruta === "10";
        if (isDefaultOpen) {
            subroutesDiv.classList.add("show");
            header.classList.add("open");
        }
        
        subrutas.forEach((subruta, index) => {
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
                fetchDirectionsForSubroute(ruta, subruta, color);
            });
            
            if (isDefaultOpen && index === 0 && !defaultSelection) {
                subBtn.classList.add("active");
                defaultSelection = { ruta, subruta, color };
            }
            
            subroutesDiv.appendChild(subBtn);
        });
        
        // Toggle al hacer clic en el header
        header.addEventListener("click", () => {
            const isHidden = !subroutesDiv.classList.contains("show");
            document.querySelectorAll(".accordion-content").forEach(content => content.classList.remove("show"));
            document.querySelectorAll(".accordion-header").forEach(h => h.classList.remove("open"));

            if (isHidden) {
                subroutesDiv.classList.add("show");
                header.classList.add("open");
            }
        });
        
        routeDiv.appendChild(header);
        routeDiv.appendChild(subroutesDiv);
        container.appendChild(routeDiv);
    });

    if (defaultSelection) {
        activeSubroute = { ruta: defaultSelection.ruta, subruta: defaultSelection.subruta };
        applyFilter();
        fetchDirectionsForSubroute(defaultSelection.ruta, defaultSelection.subruta, defaultSelection.color);
    }
}

function getRouteCacheKey(coords) {
    return coords.map(point => point.join(",")).join("|");
}

function fitBoundsFromGeojson(featureCollection) {
    const routeFeature = featureCollection.features?.[0];
    if (!routeFeature || !routeFeature.geometry || !routeFeature.geometry.coordinates) return;
    const coords = routeFeature.geometry.coordinates;
    if (coords.length === 0) return;

    const bounds = coords.reduce(
        (b, coord) => b.extend(coord),
        new mapboxgl.LngLatBounds(coords[0], coords[0])
    );
    map.fitBounds(bounds, { padding: 60 });
}

function fetchDirectionsForSubroute(ruta, subruta, color) {
    const paradas = routesData[ruta]?.[subruta] || [];
    if (paradas.length < 2) return;

    const coords = paradas.map(p => [p.lng, p.lat]);
    const cacheKey = getRouteCacheKey(coords);

    if (directionsCache[cacheKey]) {
        map.getSource(DIRECTIONS_SOURCE_ID).setData(directionsCache[cacheKey]);
        map.setPaintProperty(LAYER_DIRECTIONS, "line-color", color);
        fitBoundsFromGeojson(directionsCache[cacheKey]);
        return;
    }

    const coordinateString = coords.map(coord => coord.join(",")).join(";");
    const endpoint = `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinateString}`;
    const url = `${endpoint}?geometries=geojson&overview=full&access_token=${encodeURIComponent(mapboxgl.accessToken)}`;

    fetch(url)
        .then(response => response.json())
        .then(data => {
            if (!data.routes || data.routes.length === 0) {
                console.warn("No se recibió una ruta de la API de direcciones de Mapbox.");
                map.getSource(DIRECTIONS_SOURCE_ID).setData({ type: "FeatureCollection", features: [] });
                return;
            }

            const routeGeojson = {
                type: "FeatureCollection",
                features: [
                    {
                        type: "Feature",
                        geometry: data.routes[0].geometry,
                        properties: { ruta, subruta }
                    }
                ]
            };

            directionsCache[cacheKey] = routeGeojson;
            map.getSource(DIRECTIONS_SOURCE_ID).setData(routeGeojson);
            map.setPaintProperty(LAYER_DIRECTIONS, "line-color", color);
            fitBoundsFromGeojson(routeGeojson);
        })
        .catch(error => {
            console.error("Error al solicitar la ruta de Mapbox Directions:", error);
            map.getSource(DIRECTIONS_SOURCE_ID).setData({ type: "FeatureCollection", features: [] });
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
            
            // Crear GeoJSON de puntos (una Feature por parada)
            const geojson = {
                type: "FeatureCollection",
                features: []
            };
            
            // Iterar por todas las rutas y subrutas
            Object.entries(routesData).forEach(([ruta, subrutas]) => {
                Object.entries(subrutas).forEach(([subruta, paradas]) => {
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
            map.addSource(SOURCE_ID, { type: "geojson", data: geojson });
            map.addSource(DIRECTIONS_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
            
            // Construir expresión de colores por ruta
            const colorExpr = ["match", ["get", "ruta"]];
            Object.keys(ROUTE_COLORS).forEach(ruta => {
                colorExpr.push(ruta, colorForRoute(ruta));
            });
            colorExpr.push("#999999");
            
            // ── Capa: línea de la ruta trazada por la API de direcciones ───────
            map.addLayer({
                id: LAYER_DIRECTIONS,
                type: "line",
                source: DIRECTIONS_SOURCE_ID,
                layout: { "line-join": "round", "line-cap": "round" },
                paint: {
                    "line-color": "#000000",
                    "line-width": ["interpolate", ["linear"], ["zoom"], 9, 3, 14, 6],
                    "line-opacity": 0.9,
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
