// ==========================================================================
// CONFIGURACIÓN DE MAPBOX
// ==========================================================================
mapboxgl.accessToken = 'AQUÍ_VA_TU_TOKEN_REAL_DE_MAPBOX'; // <- REEMPLAZA CON TU TOKEN REAL

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-99.138, 19.495], // Naucalpan / Calacoaya / Lomas Verdes
    zoom: 12
});

// Colores oficiales Figma para la rejilla
const configuracionColores = {
    'Ruta 10': '#57AD31',
    'Ruta 16': '#B9DA17', // Color oficial de tu Ruta 16
    'Ruta 22': '#792886',
    'Ruta 25': '#0DB8ED',
    'Ruta 26': '#C30C0E',
    'Ruta 27': '#ED68A3'
};

// Archivo local de la Ruta 16
const archivosCSV = [
    './rutas  - Ruta 16.csv'
];

let baseDeDatosRutas = {}; 
let todasLasParadas = new Set(); 

map.on('load', () => {
    // 1. Forzar que se pinten las 6 cajitas vacías en el sidebar pase lo que pase
    Object.keys(configuracionColores).forEach(nombre => {
        baseDeDatosRutas[nombre] = { color: configuracionColores[nombre], subrutas: {} };
    });
    
    // 2. Cargar tus archivos reales
    cargarTodosLosCSVs();
});

// ==========================================================================
// PROCESAMIENTO TOLERANTE DE EXCEL (CSV)
// ==========================================================================
function cargarTodosLosCSVs() {
    let archivosProcesados = 0;

    archivosCSV.forEach((url) => {
        Papa.parse(url, {
            download: true,
            header: false, // Forzado en false para saltar líneas conflictivas manualmente
            skipEmptyLines: true,
            complete: function(results) {
                procesarDatosRuta('Ruta 16', results.data, configuracionColores['Ruta 16']);
                archivosProcesados++;
                
                if (archivosProcesados === archivosCSV.length) {
                    construirMenuSidebar();
                    inicializarBuscadorPredictivo();
                }
            }
        });
    });
}

function procesarDatosRuta(nombrePadre, filas, color) {
    filas.forEach((fila, index) => {
        // Ignorar fila de títulos
        if (index === 0 || !fila[0] || fila[0].toLowerCase().includes('nombre')) return;

        let nombreSubruta = fila[0].trim();
        let nombreParada = fila[1] ? fila[1].trim() : '';
        
        // En tu Excel: columna 2 (índice 2) es Longitud, columna 3 (índice 3) es Latitud
        let lng = limpiarCoordenadasDMS(fila[2]);
        let lat = limpiarCoordenadasDMS(fila[3]);

        if (isNaN(lat) || isNaN(lng)) return; // Salta celdas vacías o con errores de tipeo
        if (nombreParada) todasLasParadas.add(nombreParada);

        if (!baseDeDatosRutas[nombrePadre].subrutas[nombreSubruta]) {
            baseDeDatosRutas[nombrePadre].subrutas[nombreSubruta] = { coordenadas: [], paradas: [] };
        }

        // Mapbox exige estrictamente [Longitud, Latitud]
        baseDeDatosRutas[nombrePadre].subrutas[nombreSubruta].coordenadas.push([lng, lat]);
        if (nombreParada) {
            baseDeDatosRutas[nombrePadre].subrutas[nombreSubruta].paradas.push({ nombre: nombreParada, coords: [lng, lat] });
        }
    });

    // Inyectar trazos geométricos en las capas del mapa
    Object.keys(baseDeDatosRutas[nombrePadre].subrutas).forEach(subruta => {
        let datos = baseDeDatosRutas[nombrePadre].subrutas[subruta];
        let layerId = `line-${nombrePadre}-${subruta}`.replace(/\s+/g, '-');

        map.addSource(layerId, {
            type: 'geojson',
            data: {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: datos.coordenadas }
            }
        });

        map.addLayer({
            id: layerId,
            type: 'line',
            source: layerId,
            layout: { 'line-join': 'round', 'line-cap': 'round', 'visibility': 'none' }, // Ocultas al iniciar
            paint: { 'line-color': color, 'line-width': 5, 'line-opacity': 0.9 }
        });
    });
}

// Convertidor ultra-tolerante para strings DMS ej: "19°27'40.63\"N"
function limpiarCoordenadasDMS(valor) {
    if(!valor) return NaN;
    let str = valor.toString().replace(/["\s]/g, '').trim();
    let esNegativo = str.includes('W') || str.includes('S') || str.includes('-');
    let partes = str.split(/[°']/);
    
    if(partes.length >= 2) {
        let grados = parseFloat(partes[0]);
        let minutos = parseFloat(partes[1]) || 0;
        let segundos = parseFloat(partes[2]) || 0;
        let decimal = grados + (minutos / 60) + (segundos / 3600);
        return esNegativo ? -decimal : decimal;
    }
    return parseFloat(str);
}

// ==========================================================================
// RENDERIZADO DEL SIDEBAR CON DESPLIEGUE EXCLUSIVO
// ==========================================================================
function construirMenuSidebar() {
    const contenedorLista = document.getElementById('route-list');
    contenedorLista.innerHTML = '';

    Object.keys(baseDeDatosRutas).forEach(nombrePadre => {
        let datosPadre = baseDeDatosRutas[nombrePadre];
        let colorRuta = datosPadre.color;
        let numeroSolo = nombrePadre.replace(/[^0-9]/g, '');

        let divGrupo = document.createElement('div');
        divGrupo.className = 'grupo-ruta-padre';

        let btnPadre = document.createElement('button');
        btnPadre.className = 'btn-padre';
        btnPadre.style.color = colorRuta;
        btnPadre.innerHTML = `
            <span class="txt-ruta">RUTA</span>
            <span class="num-ruta">${numeroSolo}</span>
        `;
        
        // Al dar clic: Despliega subrutas y oculta las demás tarjetas
        btnPadre.onclick = () => {
            const yaEstaAbierto = divGrupo.classList.contains('abierto');
            
            document.querySelectorAll('.grupo-ruta-padre').forEach(g => {
                g.classList.remove('abierto');
                g.classList.remove('ocultar-tarjeta');
            });

            if (!yaEstaAbierto) {
                divGrupo.classList.add('abierto');
                document.querySelectorAll('.grupo-ruta-padre').forEach(g => {
                    if (g !== divGrupo) g.classList.add('ocultar-tarjeta');
                });
            } else {
                // Si se cierra, apagar las líneas visibles en el mapa de esta ruta
                Object.keys(datosPadre.subrutas).forEach(sub => {
                    let id = `line-${nombrePadre}-${sub}`.replace(/\s+/g, '-');
                    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
                });
                document.querySelectorAll('.route-btn').forEach(b => b.classList.add('off'));
            }
        };

        let divSubrutas = document.createElement('div');
        divSubrutas.className = 'subrutas-container';

        if (Object.keys(datosPadre.subrutas).length > 0) {
            Object.keys(datosPadre.subrutas).forEach(subruta => {
                let layerId = `line-${nombrePadre}-${subruta}`.replace(/\s+/g, '-');

                let btnSubruta = document.createElement('button');
                btnSubruta.className = 'route-btn off';
                btnSubruta.innerHTML = `<div class="dot" style="background:${colorRuta}"></div> <span>${subruta}</span>`;

                btnSubruta.onclick = () => {
                    let visibilidad = map.getLayoutProperty(layerId, 'visibility');
                    if (visibilidad === 'visible') {
                        map.setLayoutProperty(layerId, 'visibility', 'none');
                        btnSubruta.classList.add('off');
                    } else {
                        map.setLayoutProperty(layerId, 'visibility', 'visible');
                        btnSubruta.classList.remove('off');
                        
                        // Ajustar cámara automáticamente al trazado mapeado
                        let coords = datosPadre.subrutas[subruta].coordenadas;
                        if(coords.length > 0) {
                            let bounds = coords.reduce((b, c) => b.extend(c), new mapboxgl.LngLatBounds(coords[0], coords[0]));
                            map.fitBounds(bounds, { padding: 60 });
                        }
                    }
                };
                divSubrutas.appendChild(btnSubruta);
            });
        } else {
            let aviso = document.createElement('p');
            aviso.style.cssText = 'font-size:0.75rem; color:#999; text-align:center; margin:15px; font-weight:bold;';
            aviso.textContent = 'Base de datos en actualización';
            divSubrutas.appendChild(aviso);
        }

        divGrupo.appendChild(btnPadre);
        divGrupo.appendChild(divSubrutas);
        contenedorLista.appendChild(divGrupo);
    });
}

// ==========================================================================
// BUSCADOR DE PARADAS INTELIGENTE (FOOTER)
// ==========================================================================
function inicializarBuscadorPredictivo() {
    const arrayParadas = Array.from(todasLasParadas);
    configurarCajaPredictiva('search-origin', 'suggestions-origin', arrayParadas);
    configurarCajaPredictiva('search-destination', 'suggestions-destination', arrayParadas);

    document.getElementById('btn-search-route').onclick = () => {
        let origen = document.getElementById('search-origin').value.trim().toLowerCase();
        let destino = document.getElementById('search-destination').value.trim().toLowerCase();

        if (!origen || !destino) return alert('Por favor, introduce un origen y un destino.');

        let subrutaSeleccionada = null;
        let nombreSubrutaFinal = '';

        Object.keys(baseDeDatosRutas).forEach(padre => {
            Object.keys(baseDeDatosRutas[padre].subrutas).forEach(sub => {
                let listadoNombres = baseDeDatosRutas[padre].subrutas[sub].paradas.map(p => p.nombre.toLowerCase());
                if (listadoNombres.includes(origen) && listadoNombres.includes(destino)) {
                    subrutaSeleccionada = baseDeDatosRutas[padre].subrutas[sub];
                    nombreSubrutaFinal = `${padre} - ${sub}`;
                }
            });
        });

        if (subrutaSeleccionada) {
            alert(`¡Unidad Encontrada! Toma el transporte: ${nombreSubrutaFinal}`);
            let bounds = subrutaSeleccionada.coordenadas.reduce((b, c) => b.extend(c), new mapboxgl.LngLatBounds(subrutaSeleccionada.coordenadas[0], subrutaSeleccionada.coordenadas[0]));
            map.fitBounds(bounds, { padding: 60 });
        } else {
            alert('No se detectó un recorrido directo que vincule ambos puntos para la Ruta 16.');
        }
    };
}

function configurarCajaPredictiva(inputId, boxId, listado) {
    const input = document.getElementById(inputId);
    const box = document.getElementById(boxId);

    input.oninput = () => {
        let query = input.value.trim().toLowerCase();
        box.innerHTML = '';
        if (!query) { box.style.display = 'none'; return; }

        let filtrados = listado.filter(p => p.toLowerCase().includes(query)).slice(0, 5);

        if (filtrados.length > 0) {
            box.style.display = 'block';
            filtrados.forEach(item => {
                let itemDiv = document.createElement('div');
                itemDiv.className = 'suggestion-item';
                itemDiv.textContent = item;
                itemDiv.onclick = () => {
                    input.value = item;
                    box.style.display = 'none';
                };
                box.appendChild(itemDiv);
            });
        } else {
            box.style.display = 'none';
        }
    };
    
    document.addEventListener('click', (e) => {
        if (e.target !== input) box.style.display = 'none';
    });
}