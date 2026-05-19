// ── Token Mapbox ──────────────────────────────────────────────────────────────
// Reemplaza este valor con tu token de Mapbox:  https://account.mapbox.com/access-tokens/
mapboxgl.accessToken = '';

// ── Paleta de colores por ruta ────────────────────────────────────────────────
const ROUTE_COLORS = {
    "10 de abril - Calvario Calacoaya":                          "#F58231",
    "Ahuehuetes - Los Juanes (Atizapán de Zaragoza)":            "#E6194B",
    "Ampliación Higuera - Metro 4 caminos":                      "#FF9800",
    "Ampliación Higuera - Metro chapultepec":                    "#795548",
    "Amplición Higuera - Tlanepantla":                           "#2980B9",
    "Barrio Norte - Las palomas":                                "#FF5722",
    "Bodegas Atizapan - Unidad Maravillas Ceylan":               "#8E44AD",
    "Bodegas Atizapán - Monte sol":                              "#7F8C8D",
    "Calacoaya - Tlanapantla":                                   "#D35400",
    "Col. Huguera - Tlanepantla":                                "#8B4513",
    "Lazaro Cardenas - Tlanepantla":                             "#C0392B",
    "Lomas San Miguel - Metro chapultepec":                      "#3F51B5",
    "Metro 4 caminos - Calvario Calacoaya por Ahuizotla":        "#4363D8",
    "Metro 4 caminos - Calvario Calacoaya por Lomas Verdes":     "#3CB44B",
    "Metro Observatorio - Col. Las Águilas":                     "#F39C12",
    "Metro Observatorio - Lomas de Atizapán":                    "#2ECC71",
    "Metro Observatorio - Lomas de las torres":                  "#E74C3C",
    "Metro Observatorio - Tecnologico":                          "#1ABC9C",
    "Metro Observatorio - Tlanepantla":                          "#9B59B6",
    "Mexico 86 - Metro 4 caminos":                               "#00BFFF",
    "Mexico Nuevo - Central de abastos Atizapán":                "#16A085",
    "México 86 - Metro 4 caminos":                               "#F032E6",
    "México 86 - Tlanepantla":                                   "#911EB4",
    "Peñitas - Atizapán palacio municipal":                      "#607D8B",
    "Zona 1 México Nuevo - Hospital Ceylan":                     "#E91E63",
    "Zona 7 México nuevo - Tlanepantla":                         "#27AE60",
};

function colorFor(ruta) { return ROUTE_COLORS[ruta] || "#999999"; }

// ── Mapa ──────────────────────────────────────────────────────────────────────
const map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/light-v11",
    center: [-99.228, 19.520],
    zoom: 11,
});
map.addControl(new mapboxgl.NavigationControl(), "top-right");

const SOURCE_ID     = "paradas";
const LINES_ID      = "rutas-lines";
const LAYER_LINES   = "rutas-lines-layer";
const LAYER_CIRCLES = "paradas-circles";
const LAYER_LABELS  = "paradas-labels";

let allRoutes    = [];
let activeRoutes = new Set();

function buildColorExpr(routes) {
    const expr = ["match", ["get", "ruta"]];
    routes.forEach(r => expr.push(r, colorFor(r)));
    expr.push("#999999");
    return expr;
}

function applyFilter() {
    const visible = allRoutes.filter(r => activeRoutes.has(r));
    const f = visible.length === 0
        ? ["==", "ruta", "__none__"]
        : ["in", ["get", "ruta"], ["literal", visible]];
    map.setFilter(LAYER_LINES,   f);
    map.setFilter(LAYER_CIRCLES, f);
    map.setFilter(LAYER_LABELS,  f);
}

function syncButtons() {
    document.querySelectorAll(".route-btn").forEach(btn => {
        btn.classList.toggle("off", !activeRoutes.has(btn.dataset.ruta));
    });
}

function buildSidebar(routes) {
    const list = document.getElementById("route-list");
    list.innerHTML = "";
    routes.forEach(ruta => {
        const color = colorFor(ruta);
        const btn = document.createElement("button");
        btn.className = "route-btn";
        btn.dataset.ruta = ruta;
        btn.style.borderColor = color;
        btn.innerHTML = `<span class="dot" style="background:${color}"></span><span>${ruta}</span>`;
        btn.addEventListener("click", () => {
            activeRoutes.has(ruta) ? activeRoutes.delete(ruta) : activeRoutes.add(ruta);
            syncButtons();
            applyFilter();
        });
        list.appendChild(btn);
    });
}

document.getElementById("btn-all").addEventListener("click", () => {
    const anyOff = allRoutes.some(r => !activeRoutes.has(r));
    anyOff ? allRoutes.forEach(r => activeRoutes.add(r)) : activeRoutes.clear();
    syncButtons();
    applyFilter();
});

// Popup
const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false });
map.on("mouseenter", LAYER_CIRCLES, (e) => {
    map.getCanvas().style.cursor = "pointer";
    const { ruta, parada } = e.features[0].properties;
    popup
        .setLngLat(e.features[0].geometry.coordinates)
        .setHTML(`<div class="popup-route" style="color:${colorFor(ruta)}">${ruta}</div><div class="popup-stop">${parada}</div>`)
        .addTo(map);
});
map.on("mouseleave", LAYER_CIRCLES, () => {
    map.getCanvas().style.cursor = "";
    popup.remove();
});

// Cargar CSV
map.on("load", () => {
    Papa.parse("data/points.csv", {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: ({ data }) => {
            const seen = new Set();
            data.forEach(row => {
                if (row.Ruta && !seen.has(row.Ruta)) { seen.add(row.Ruta); allRoutes.push(row.Ruta); }
            });
            allRoutes.forEach(r => activeRoutes.add(r));

            // Agrupar paradas por ruta (en orden de aparición en el CSV)
            const stopsByRoute = {};
            data.filter(row => row.Latitud && row.Longitud).forEach(row => {
                if (!stopsByRoute[row.Ruta]) stopsByRoute[row.Ruta] = [];
                stopsByRoute[row.Ruta].push([parseFloat(row.Longitud), parseFloat(row.Latitud)]);
            });

            // GeoJSON de líneas (una LineString por ruta)
            const linesGeojson = {
                type: "FeatureCollection",
                features: Object.entries(stopsByRoute)
                    .filter(([, coords]) => coords.length > 1)
                    .map(([ruta, coords]) => ({
                        type: "Feature",
                        geometry: { type: "LineString", coordinates: coords },
                        properties: { ruta },
                    })),
            };

            // GeoJSON de puntos (una Feature por parada)
            const geojson = {
                type: "FeatureCollection",
                features: data
                    .filter(row => row.Latitud && row.Longitud)
                    .map(row => ({
                        type: "Feature",
                        geometry: { type: "Point", coordinates: [parseFloat(row.Longitud), parseFloat(row.Latitud)] },
                        properties: { ruta: row.Ruta, parada: row.Parada },
                    })),
            };

            // ── Fuentes ──────────────────────────────────────────────────────
            map.addSource(LINES_ID,  { type: "geojson", data: linesGeojson });
            map.addSource(SOURCE_ID, { type: "geojson", data: geojson });

            // ── Capa: líneas de ruta ──────────────────────────────────────────
            map.addLayer({
                id: LAYER_LINES,
                type: "line",
                source: LINES_ID,
                layout: { "line-join": "round", "line-cap": "round" },
                paint: {
                    "line-color": buildColorExpr(allRoutes),
                    "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.5, 14, 3.5],
                    "line-opacity": 0.65,
                },
            });

            map.addLayer({
                id: LAYER_LINES,
            // ── Capa: círculos de paradas ─────────────────────────────────────
                type: "circle",
                source: SOURCE_ID,
                paint: {
                    "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 5, 14, 10],
                    "circle-color": buildColorExpr(allRoutes),
                    "circle-stroke-color": "#ffffff",
                    "circle-stroke-width": 1.5,
                    "circle-opacity": 0.9,
                },
            });

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

            buildSidebar(allRoutes);
            syncButtons();
        },
    });
});