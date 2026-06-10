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

// ── Toggle Search Bar ──────────────────────────────────────────────────────────
document.getElementById('btn-toggle-search').addEventListener('click', function() {
    const searchFooter = document.getElementById('search-footer');
    searchFooter.classList.toggle('collapsed');
    this.textContent = searchFooter.classList.contains('collapsed') ? '📍 Planea tu ruta' : '📍 Cerrar';
});

const sidebarHeader = document.getElementById('sidebar-header');
const sidebar = document.getElementById('sidebar');

function collapseSidebarOnPortrait() {
    if (!sidebar) return;
    if (window.matchMedia('(orientation: portrait)').matches) {
        sidebar.classList.remove('expanded');
        const icon = sidebarHeader?.querySelector('.handle-icon');
        if (icon) icon.textContent = '▴';
    }
}

if (sidebarHeader && sidebar) {
    sidebarHeader.addEventListener('click', () => {
        sidebar.classList.toggle('expanded');
        const icon = sidebarHeader.querySelector('.handle-icon');
        if (icon) icon.textContent = sidebar.classList.contains('expanded') ? '▾' : '▴';
    });
}

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

let routesData = {}; // { ruta: { canonicalSubruta: { display, paradas: [{parada,lat,lng}] } } }
let activeSubroute = null; // { ruta, subruta }
let directionsCache = {}; // Cache local de geometrías de direcciones
let endpointMarkers = []; // marcadores de inicio/fin
let planMarkers = []; // marcadores de ruta planeada
let stopIndex = {}; // { normalizedStop: { display, occurrences:[{ruta,subruta,parada,lat,lng,idx}] } }
let stopGraph = {}; // { normalizedStop: [{ neighbor, ruta, subruta, fromIdx, toIdx }] }

function clearPlanMarkers() {
    planMarkers.forEach(marker => marker.remove());
    planMarkers = [];
}

function setPlanInstructions(html) {
    const container = document.getElementById('plan-description');
    if (container) container.innerHTML = html;
}

function showPlanInstructions(plan) {
    if (!plan || !plan.segments || plan.segments.length === 0) {
        setPlanInstructions('<div class="plan-step">No se encontró una ruta válida.</div>');
        return;
    }

    const lines = plan.segments.map((segment, index) => {
        const displayName = routesData[segment.ruta]?.[segment.subruta]?.display || segment.subruta;
        const fromName = stopIndex[segment.from]?.display || segment.from;
        const toName = stopIndex[segment.to]?.display || segment.to;
        if (index === 0) {
            return `<div class="plan-step"><strong>1.</strong> Desde <strong>${fromName}</strong>, súbete a <strong>Ruta ${segment.ruta}</strong> (${displayName}) y viaja hasta <strong>${toName}</strong>.</div>`;
        }
        return `<div class="plan-step"><strong>${index + 1}.</strong> Bájate en <strong>${fromName}</strong>, luego súbete a <strong>Ruta ${segment.ruta}</strong> (${displayName}) hasta <strong>${toName}</strong>.</div>`;
    });

    setPlanInstructions(lines.join(''));
}

const PLANNER_SOURCE_ID = "planner-route";
const PLANNER_LAYER_ID = "planner-route-layer";

function normalizeStopName(value) {
    return value ? value.toString().trim().replace(/\s+/g, " ").toLowerCase() : "";
}

function buildStopIndexAndGraph() {
    stopIndex = {};
    stopGraph = {};

    Object.entries(routesData).forEach(([ruta, subrutas]) => {
        Object.entries(subrutas).forEach(([subruta, obj]) => {
            const paradas = obj.paradas || [];
            paradas.forEach((parada, idx) => {
                const key = normalizeStopName(parada.parada);
                if (!stopIndex[key]) {
                    stopIndex[key] = { display: parada.parada, occurrences: [] };
                }
                stopIndex[key].occurrences.push({
                    ruta,
                    subruta,
                    parada: parada.parada,
                    lat: parada.lat,
                    lng: parada.lng,
                    idx
                });
                if (!stopGraph[key]) stopGraph[key] = [];
            });

            for (let i = 0; i < paradas.length - 1; i++) {
                const current = paradas[i];
                const next = paradas[i + 1];
                const currentKey = normalizeStopName(current.parada);
                const nextKey = normalizeStopName(next.parada);

                stopGraph[currentKey].push({
                    neighbor: nextKey,
                    ruta,
                    subruta,
                    fromIdx: i,
                    toIdx: i + 1
                });
                stopGraph[nextKey].push({
                    neighbor: currentKey,
                    ruta,
                    subruta,
                    fromIdx: i + 1,
                    toIdx: i
                });
            }
        });
    });
}

function getAllStopOptions() {
    return Object.values(stopIndex)
        .map(entry => entry.display)
        .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

function showSuggestions(inputElement, boxElement, options) {
    boxElement.innerHTML = '';
    if (!options || options.length === 0) {
        boxElement.style.display = 'none';
        return;
    }

    options.forEach(option => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        item.textContent = option;
        item.onclick = () => {
            inputElement.value = option;
            boxElement.style.display = 'none';
        };
        boxElement.appendChild(item);
    });
    boxElement.style.display = 'block';
}

function configureSearchInput(inputId, suggestionsId) {
    const input = document.getElementById(inputId);
    const box = document.getElementById(suggestionsId);
    const options = getAllStopOptions();

    input.addEventListener('focus', () => {
        showSuggestions(input, box, options);
    });

    input.addEventListener('input', () => {
        const query = input.value.trim().toLowerCase();
        if (!query) {
            showSuggestions(input, box, options);
            return;
        }
        const filtered = options.filter(o => normalizeStopName(o).includes(query)).slice(0, 20);
        showSuggestions(input, box, filtered);
    });

    document.addEventListener('click', (event) => {
        if (event.target !== input && !box.contains(event.target)) {
            box.style.display = 'none';
        }
    });
}

function getStopOccurrences(name) {
    const key = normalizeStopName(name);
    return stopIndex[key]?.occurrences || [];
}

function buildPlanPath(origin, destination) {
    const originKey = normalizeStopName(origin);
    const destinationKey = normalizeStopName(destination);
    if (!originKey || !destinationKey || !stopIndex[originKey] || !stopIndex[destinationKey]) {
        return null;
    }

    const queue = [originKey];
    const prev = { [originKey]: null };
    const via = {};

    while (queue.length > 0) {
        const current = queue.shift();
        if (current === destinationKey) break;
        const neighbors = stopGraph[current] || [];
        for (const edge of neighbors) {
            if (!(edge.neighbor in prev)) {
                prev[edge.neighbor] = current;
                via[edge.neighbor] = { ruta: edge.ruta, subruta: edge.subruta };
                queue.push(edge.neighbor);
            }
        }
    }

    if (!prev[destinationKey]) return null;

    const rawPath = [];
    let node = destinationKey;
    while (node !== originKey) {
        rawPath.push({ stop: node, via: via[node] });
        node = prev[node];
    }
    rawPath.push({ stop: originKey, via: null });
    rawPath.reverse();

    const segments = [];
    let currentSegment = null;
    for (let i = 1; i < rawPath.length; i++) {
        const edge = rawPath[i].via;
        if (!currentSegment || currentSegment.ruta !== edge.ruta || currentSegment.subruta !== edge.subruta) {
            if (currentSegment) segments.push(currentSegment);
            currentSegment = {
                ruta: edge.ruta,
                subruta: edge.subruta,
                from: rawPath[i - 1].stop,
                to: rawPath[i].stop
            };
        } else {
            currentSegment.to = rawPath[i].stop;
        }
    }
    if (currentSegment) segments.push(currentSegment);

    return {
        origin: originKey,
        destination: destinationKey,
        segments
    };
}

function buildPlanInstructions(plan) {
    if (!plan || !plan.segments || plan.segments.length === 0) return 'No se encontró una ruta válida.';
    return plan.segments.map((segment, index) => {
        const displayName = routesData[segment.ruta]?.[segment.subruta]?.display || segment.subruta;
        const fromName = stopIndex[segment.from]?.display || segment.from;
        const toName = stopIndex[segment.to]?.display || segment.to;
        if (index === 0) {
            return `Desde ${fromName}, toma Ruta ${segment.ruta} (${displayName}) hasta ${toName}.`;
        }
        return `Después, cambia a Ruta ${segment.ruta} (${displayName}) en ${fromName} y viaja hasta ${toName}.`;
    }).join(' ');
}

function showPlanOnMap(plan) {
    clearPlanMarkers();
    clearEndpointMarkers();
    map.getSource(DIRECTIONS_SOURCE_ID)?.setData({ type: 'FeatureCollection', features: [] });

    if (!plan || !plan.segments || plan.segments.length === 0) {
        map.getSource(PLANNER_SOURCE_ID).setData({ type: 'FeatureCollection', features: [] });
        showPlanInstructions(null);
        return;
    }

    const coordinates = [];
    const transferStops = [];

    plan.segments.forEach((segment, index) => {
        const obj = routesData[segment.ruta]?.[segment.subruta];
        if (!obj) return;
        const paradas = obj.paradas;
        const fromKey = normalizeStopName(segment.from);
        const toKey = normalizeStopName(segment.to);
        const startIdx = paradas.findIndex(p => normalizeStopName(p.parada) === fromKey);
        const endIdx = paradas.findIndex(p => normalizeStopName(p.parada) === toKey);
        if (startIdx === -1 || endIdx === -1) return;
        const slice = startIdx <= endIdx
            ? paradas.slice(startIdx, endIdx + 1)
            : paradas.slice(endIdx, startIdx + 1).reverse();
        slice.forEach(p => coordinates.push([p.lng, p.lat]));

        if (index > 0) {
            transferStops.push({ stop: segment.from, lat: paradas[startIdx].lat, lng: paradas[startIdx].lng, type: 'transfer' });
        }
    });

    if (coordinates.length === 0) {
        map.getSource(PLANNER_SOURCE_ID).setData({ type: 'FeatureCollection', features: [] });
        showPlanInstructions(null);
        return;
    }

    map.getSource(PLANNER_SOURCE_ID).setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates } }]
    });

    const originSegment = plan.segments[0];
    const originStop = stopIndex[originSegment.from];
    const destinationStop = stopIndex[plan.segments[plan.segments.length - 1].to];
    if (originStop) {
        const originOcc = originStop.occurrences.find(o => o.ruta === originSegment.ruta && o.subruta === originSegment.subruta);
        if (originOcc) {
            planMarkers.push(new mapboxgl.Marker({ color: '#000' }).setLngLat([originOcc.lng, originOcc.lat]).setPopup(new mapboxgl.Popup({ offset: 18 }).setText(`Origen: ${originStop.display}`)).addTo(map));
        }
    }
    if (destinationStop) {
        const destSegment = plan.segments[plan.segments.length - 1];
        const destOcc = destinationStop.occurrences.find(o => o.ruta === destSegment.ruta && o.subruta === destSegment.subruta);
        if (destOcc) {
            planMarkers.push(new mapboxgl.Marker({ color: '#000' }).setLngLat([destOcc.lng, destOcc.lat]).setPopup(new mapboxgl.Popup({ offset: 18 }).setText(`Destino: ${destinationStop.display}`)).addTo(map));
        }
    }

    transferStops.forEach(transfer => {
        const label = stopIndex[transfer.stop]?.display || transfer.stop;
        planMarkers.push(new mapboxgl.Marker({ color: '#ea5d24' }).setLngLat([transfer.lng, transfer.lat]).setPopup(new mapboxgl.Popup({ offset: 18 }).setText(`Transferencia en: ${label}`)).addTo(map));
    });

    const bounds = coordinates.reduce((b, coord) => b.extend(coord), new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]));
    map.fitBounds(bounds, { padding: 80 });
}

function planRoute(origin, destination) {
    const plan = buildPlanPath(origin, destination);
    if (!plan) {
        setPlanInstructions('<div class="plan-step">No se encontró ningún camino directo o por combinación de rutas entre esos puntos.</div>');
        return;
    }

    showPlanInstructions(plan);
    showPlanOnMap(plan);
}

function setupSearchRoute() {
    configureSearchInput('search-origin', 'suggestions-origin');
    configureSearchInput('search-destination', 'suggestions-destination');
    document.getElementById('btn-search-route').addEventListener('click', () => {
        const origin = document.getElementById('search-origin').value.trim();
        const destination = document.getElementById('search-destination').value.trim();
        if (!origin || !destination) {
            return alert('Por favor, selecciona un origen y un destino válidos.');
        }
        planRoute(origin, destination);
    });
}

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
    const displaySubruta = routesData[ruta]?.[subruta]?.display || subruta;
    popup
        .setLngLat(e.features[0].geometry.coordinates)
        .setHTML(`<div class="popup-route" style="color:${color}"><strong>Ruta ${ruta}</strong></div><div class="popup-subroute">${displaySubruta}</div><div class="popup-stop">${parada}</div>`)
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
        const subrutas = Object.keys(routesData[ruta] || {});
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
            // Mostrar nombre original, no la clave canónica
            const displayName = routesData[ruta][subruta]?.display || subruta;
            subBtn.textContent = displayName;
            subBtn.dataset.ruta = ruta;
            subBtn.dataset.subruta = subruta; // canonical key
            
            subBtn.addEventListener("click", () => {
                // Actualizar selección activa
                document.querySelectorAll(".subroute-btn").forEach(b => b.classList.remove("active"));
                subBtn.classList.add("active");
                
                activeSubroute = { ruta, subruta };
                applyFilter();
                fetchDirectionsForSubroute(ruta, subruta, color);
                addEndpointMarkersForSubroute(ruta, subruta);
                collapseSidebarOnPortrait();

                // Si el usuario selecciona manualmente una subruta en el acordeón,
                // ocultar cualquier ruta alternativa que haya mostrado el buscador
                clearPlanMarkers();
                setPlanInstructions('Selecciona tu origen y destino para ver el mejor recorrido.');
                if (map.getSource(PLANNER_SOURCE_ID)) map.getSource(PLANNER_SOURCE_ID).setData({ type: 'FeatureCollection', features: [] });
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
            document.querySelectorAll(".subroute-btn").forEach(b => b.classList.remove("active"));

            if (isHidden) {
                subroutesDiv.classList.add("show");
                header.classList.add("open");
                const firstBtn = subroutesDiv.querySelector(".subroute-btn");
                if (firstBtn) firstBtn.click();
            } else {
                activeSubroute = null;
                applyFilter();
                map.getSource(DIRECTIONS_SOURCE_ID)?.setData({ type: "FeatureCollection", features: [] });
                clearEndpointMarkers();
                // Al cerrar el grupo, también limpiar cualquier plan mostrado
                clearPlanMarkers();
                setPlanInstructions('Selecciona tu origen y destino para ver el mejor recorrido.');
                if (map.getSource(PLANNER_SOURCE_ID)) map.getSource(PLANNER_SOURCE_ID).setData({ type: 'FeatureCollection', features: [] });
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
        addEndpointMarkersForSubroute(defaultSelection.ruta, defaultSelection.subruta);
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
    const paradas = routesData[ruta]?.[subruta]?.paradas || [];
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
                // Agrupar datos por Ruta y Subruta (usar clave canónica para evitar duplicados leves)
                const normalize = s => s ? s.toString().trim().replace(/\s+/g, ' ') : '';
                const canonical = s => normalize(s).toLowerCase();

                data.filter(row => row.Ruta && row.Subruta && row.Parada && row.Latitud && row.Longitud).forEach(row => {
                    const ruta = row.Ruta.toString().trim();
                    const subrutaOrig = normalize(row.Subruta);
                    const subrutaKey = canonical(subrutaOrig);

                    if (!routesData[ruta]) routesData[ruta] = {};
                    if (!routesData[ruta][subrutaKey]) routesData[ruta][subrutaKey] = { display: subrutaOrig, paradas: [] };

                    routesData[ruta][subrutaKey].paradas.push({
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
                Object.entries(subrutas).forEach(([subrutaKey, obj]) => {
                    // Points para cada parada
                    (obj.paradas || []).forEach(parada => {
                        geojson.features.push({
                            type: "Feature",
                            geometry: { type: "Point", coordinates: [parada.lng, parada.lat] },
                            properties: { ruta, subruta: subrutaKey, parada: parada.parada }
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

            map.addSource(PLANNER_SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            map.addLayer({
                id: PLANNER_LAYER_ID,
                type: 'line',
                source: PLANNER_SOURCE_ID,
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': '#ea5d24',
                    'line-width': ['interpolate', ['linear'], ['zoom'], 9, 3, 14, 8],
                    'line-opacity': 0.85,
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
            buildStopIndexAndGraph();
            setupSearchRoute();
        },
    });
});

function clearEndpointMarkers() {
    endpointMarkers.forEach(m => m.remove());
    endpointMarkers = [];
}

function addEndpointMarkersForSubroute(ruta, subruta) {
    clearEndpointMarkers();
    const color = '#ea5d24';
    const obj = routesData?.[ruta]?.[subruta];
    const paradas = obj?.paradas || [];
    if (!paradas || paradas.length === 0) return;

    const primero = paradas[0];
    const ultimo = paradas[paradas.length - 1];

    const crear = (lng, lat, texto) => {
        const el = document.createElement('div');
        el.className = 'endpoint-marker';
        el.style.width = '18px';
        el.style.height = '18px';
        el.style.borderRadius = '50%';
        el.style.background = color;
        el.style.border = '2px solid #fff';
        el.style.boxShadow = '0 0 4px rgba(0,0,0,0.4)';

        const marker = new mapboxgl.Marker(el)
            .setLngLat([lng, lat])
            .setPopup(new mapboxgl.Popup({ offset: 18 }).setText(texto))
            .addTo(map);

        endpointMarkers.push(marker);
    };

    const displayName = obj.display || subruta;
    crear(primero.lng, primero.lat, `Ruta ${ruta} — ${displayName} — Inicio: ${primero.parada}`);
    if (primero.lng !== ultimo.lng || primero.lat !== ultimo.lat) {
        crear(ultimo.lng, ultimo.lat, `Ruta ${ruta} — ${displayName} — Fin: ${ultimo.parada}`);
    }
}
