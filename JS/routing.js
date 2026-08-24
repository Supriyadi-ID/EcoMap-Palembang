// =============================================================================
// routing.js — Modul Analisis Routing ke Fasilitas Pengelolaan Sampah
// Menggunakan OSRM (Open Source Routing Machine) — API gratis, tanpa API key
// =============================================================================

const OSRM_BASE = 'https://router.project-osrm.org';
const OSRM_TIMEOUT = 10000; // 10 detik timeout

// State
window.isRoutingMode = false;
window.routingOriginMarker = null;

// ─── OSRM API Helpers ───────────────────────────────────────────────────────

/**
 * Memanggil OSRM Route API untuk mendapatkan rute antara 2 titik.
 * @param {number} fromLng - Longitude asal
 * @param {number} fromLat - Latitude asal
 * @param {number} toLng - Longitude tujuan
 * @param {number} toLat - Latitude tujuan
 * @returns {Promise<{distance_km: number, duration_min: number, geometry: object}|null>}
 */
async function osrmRoute(fromLng, fromLat, toLng, toLat) {
    const url = `${OSRM_BASE}/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), OSRM_TIMEOUT);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        const data = await response.json();

        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            return {
                distance_km: route.distance / 1000,
                duration_min: route.duration / 60,
                geometry: route.geometry
            };
        }
        return null;
    } catch (e) {
        console.warn('OSRM Route API error:', e.message);
        return null;
    }
}

/**
 * Memanggil OSRM Table API untuk mendapatkan matriks jarak/waktu dari 1 sumber ke banyak tujuan.
 * @param {number} srcLng - Longitude sumber
 * @param {number} srcLat - Latitude sumber
 * @param {Array<{lng: number, lat: number}>} destinations - Array tujuan
 * @returns {Promise<{distances: number[], durations: number[]}|null>}
 */
async function osrmTable(srcLng, srcLat, destinations) {
    const coords = `${srcLng},${srcLat};` + destinations.map(d => `${d.lng},${d.lat}`).join(';');
    const url = `${OSRM_BASE}/table/v1/driving/${coords}?sources=0&annotations=distance,duration`;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), OSRM_TIMEOUT);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        const data = await response.json();

        if (data.code === 'Ok') {
            return {
                distances: data.distances[0].slice(1), // skip first (self)
                durations: data.durations[0].slice(1)
            };
        }
        return null;
    } catch (e) {
        console.warn('OSRM Table API error:', e.message);
        return null;
    }
}

// ─── Pengumpulan Fasilitas ──────────────────────────────────────────────────

/**
 * Mengumpulkan semua fasilitas yang aktif (visible), dengan opsi filter jenis.
 * @param {string} [facilityFilter=''] - Nama kategori fasilitas (kosong = semua yang visible)
 * @returns {Array<{lat: number, lng: number, nama: string, jenis: string, kategori: string, feature: object}>}
 */
function collectFacilities(facilityFilter) {
    let points = [];
    for (let key in window.facilitiesData) {
        const fd = window.facilitiesData[key];
        // Jika filter dipilih, hanya ambil kategori yang cocok
        if (facilityFilter && facilityFilter !== key) continue;
        // Jika tidak ada filter, hanya ambil yang visible
        if (!facilityFilter && !fd.visible) continue;

        if (fd.geojson && fd.geojson.features) {
            fd.geojson.features.forEach(f => {
                if (f.geometry && f.geometry.coordinates) {
                    const status = f.properties.status || 'Beroperasi';
                    if (status === 'Tidak Beroperasi') return; // Skip fasilitas yang tidak beroperasi
                    points.push({
                        lng: f.geometry.coordinates[0],
                        lat: f.geometry.coordinates[1],
                        nama: f.properties.nama || f.properties.jenis || key,
                        jenis: f.properties.jenis || key,
                        kategori: key,
                        feature: f
                    });
                }
            });
        }
    }
    return points;
}

// ─── Fungsi Utama: Cari Fasilitas Terdekat ──────────────────────────────────

/**
 * Mencari fasilitas terdekat dari lokasi user dan menampilkan rute di peta.
 * Strategi: pre-filter 10 terdekat (Turf.js garis lurus) → OSRM Table → OSRM Route
 * @param {number} userLat
 * @param {number} userLng
 * @param {string} [facilityFilter=''] - Filter jenis fasilitas
 */
async function findAndRouteNearestFacility(userLat, userLng, facilityFilter) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.remove('hidden');

    try {
        // Bersihkan rute sebelumnya
        clearRoutingLayers();

        const allFacilities = collectFacilities(facilityFilter);

        if (allFacilities.length === 0) {
            alert('Tidak ada fasilitas yang tersedia. Pastikan minimal satu layer fasilitas aktif atau pilih jenis fasilitas.');
            return;
        }

        // Tambah marker lokasi user
        const userIcon = L.divIcon({
            className: 'custom-div-icon',
            html: `<span style="background-color: #2563eb; width:30px; height:30px; display:flex; align-items:center; justify-content:center; color:white; font-size:14px; border-radius:50%; border:3px solid white; box-shadow:0 2px 8px rgba(0,0,0,0.4);"><i class="fa-solid fa-street-view"></i></span>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });
        window.routingOriginMarker = L.marker([userLat, userLng], { icon: userIcon, zIndexOffset: 2000 })
            .bindPopup('<b>Lokasi Anda</b>')
            .addTo(window.routingLayerGroup);

        // Step 1: Pre-filter — ambil 10 terdekat secara garis lurus menggunakan Turf.js
        const userPoint = turf.point([userLng, userLat]);
        const withDist = allFacilities.map(f => ({
            ...f,
            straightDist: turf.distance(userPoint, turf.point([f.lng, f.lat]), { units: 'kilometers' })
        }));
        withDist.sort((a, b) => a.straightDist - b.straightDist);
        const candidates = withDist.slice(0, 10);

        // Step 2: Coba OSRM Table API untuk mendapatkan jarak jalan aktual
        let bestIdx = 0;
        let routeDistance = candidates[0].straightDist;
        let routeDuration = (candidates[0].straightDist * window.DETOUR_INDEX / window.SPEED_KMH) * 60;
        let usedOSRM = false;

        const tableResult = await osrmTable(userLng, userLat, candidates.map(c => ({ lng: c.lng, lat: c.lat })));

        if (tableResult) {
            usedOSRM = true;
            let minDist = Infinity;
            tableResult.distances.forEach((d, i) => {
                if (d !== null && d < minDist) {
                    minDist = d;
                    bestIdx = i;
                }
            });
            routeDistance = tableResult.distances[bestIdx] / 1000; // meter → km
            routeDuration = tableResult.durations[bestIdx] / 60;   // detik → menit
        }

        const nearest = candidates[bestIdx];

        // Step 3: Dapatkan geometri rute dari OSRM Route API
        let routeGeometry = null;
        if (usedOSRM) {
            const routeResult = await osrmRoute(userLng, userLat, nearest.lng, nearest.lat);
            if (routeResult) {
                routeGeometry = routeResult.geometry;
                routeDistance = routeResult.distance_km;
                routeDuration = routeResult.duration_min;
            }
        }

        // Step 4: Tampilkan rute di peta
        displayRouteOnMap(userLat, userLng, nearest, routeGeometry, routeDistance, routeDuration, usedOSRM);

    } catch (e) {
        console.error('Routing error:', e);
        alert('Terjadi kesalahan saat mencari rute.');
    } finally {
        if (overlay) overlay.classList.add('hidden');
    }
}

// ─── Tampilkan Rute di Peta ─────────────────────────────────────────────────

function displayRouteOnMap(userLat, userLng, nearest, routeGeometry, distanceKm, durationMin, usedOSRM) {
    // Gambar rute
    if (routeGeometry) {
        // OSRM GeoJSON geometry → Leaflet polyline
        const routeLine = L.geoJSON(routeGeometry, {
            style: {
                color: '#2563eb',
                weight: 5,
                opacity: 0.8,
                lineCap: 'round',
                lineJoin: 'round'
            }
        }).addTo(window.routingLayerGroup);
    } else {
        // Fallback: garis lurus putus-putus
        L.polyline([[userLat, userLng], [nearest.lat, nearest.lng]], {
            color: '#2563eb',
            weight: 3,
            dashArray: '8, 8',
            opacity: 0.7
        }).addTo(window.routingLayerGroup);
    }

    // Marker fasilitas tujuan (highlight)
    const destIcon = L.divIcon({
        className: 'custom-div-icon',
        html: `<span style="background-color: #dc2626; width:30px; height:30px; display:flex; align-items:center; justify-content:center; color:white; font-size:14px; border-radius:50%; border:3px solid white; box-shadow:0 2px 8px rgba(0,0,0,0.4); animation: pulse-ring 1.5s infinite;"><i class="fa-solid fa-flag-checkered"></i></span>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
    });

    L.marker([nearest.lat, nearest.lng], { icon: destIcon, zIndexOffset: 2000 })
        .bindPopup(`
            <div class="p-2 min-w-[220px]">
                <h3 class="font-bold text-emerald-800 text-sm border-b pb-1 mb-2">${nearest.nama}</h3>
                <div class="text-xs space-y-1">
                    <div class="flex justify-between"><span class="text-gray-500">Kategori:</span><span class="font-medium">${nearest.kategori}</span></div>
                    <div class="flex justify-between"><span class="text-gray-500">Jenis:</span><span class="font-medium">${nearest.jenis}</span></div>
                </div>
            </div>
        `)
        .addTo(window.routingLayerGroup);

    // Zoom ke extent rute
    const bounds = L.latLngBounds([[userLat, userLng], [nearest.lat, nearest.lng]]);
    window.map.fitBounds(bounds, { padding: [60, 60] });

    // Update panel hasil
    updateRoutingResult(nearest, distanceKm, durationMin, usedOSRM);
}

// ─── Update Panel Hasil Routing ─────────────────────────────────────────────

function updateRoutingResult(nearest, distanceKm, durationMin, usedOSRM) {
    const panel = document.getElementById('routing-result-panel');
    const content = document.getElementById('routing-result-content');
    if (!panel || !content) return;

    const methodLabel = usedOSRM
        ? '<span class="text-emerald-600 font-medium">✓ Rute Jalan Aktual (OSRM)</span>'
        : '<span class="text-amber-600 font-medium">~ Estimasi Garis Lurus</span>';

    content.innerHTML = `
        <div class="space-y-2 text-xs">
            <div class="flex justify-between border-b pb-1">
                <span class="text-gray-500">Fasilitas Terdekat:</span>
                <span class="font-bold text-gray-800 text-right max-w-[150px] leading-tight">${nearest.nama}</span>
            </div>
            <div class="flex justify-between border-b pb-1">
                <span class="text-gray-500">Kategori:</span>
                <span class="font-semibold text-gray-700">${nearest.kategori}</span>
            </div>
            <div class="flex justify-between border-b pb-1">
                <span class="text-gray-500">Jarak Tempuh:</span>
                <span class="font-bold text-blue-700">${distanceKm.toFixed(2)} km</span>
            </div>
            <div class="flex justify-between border-b pb-1">
                <span class="text-gray-500">Waktu Tempuh:</span>
                <span class="font-bold text-amber-600">${Math.ceil(durationMin)} menit</span>
            </div>
            <div class="flex justify-between pt-1">
                <span class="text-gray-500">Metode:</span>
                ${methodLabel}
            </div>
        </div>
    `;
    panel.classList.remove('hidden');
}

// ─── Mode Klik Peta ─────────────────────────────────────────────────────────

function startRoutingMode() {
    window.isRoutingMode = true;
    window.map.getContainer().style.cursor = 'crosshair';

    // Tampilkan overlay instruksi routing
    const overlay = document.getElementById('routing-instruction-overlay');
    if (overlay) overlay.classList.remove('hidden');
}

function cancelRoutingMode() {
    window.isRoutingMode = false;
    window.map.getContainer().style.cursor = '';
    const overlay = document.getElementById('routing-instruction-overlay');
    if (overlay) overlay.classList.add('hidden');
}

// Handler klik peta untuk routing — dipasang sekali di initMap via map click listener
window.handleRoutingMapClick = function(e) {
    if (!window.isRoutingMode) return false;

    window.isRoutingMode = false;
    window.map.getContainer().style.cursor = '';
    const overlay = document.getElementById('routing-instruction-overlay');
    if (overlay) overlay.classList.add('hidden');

    const facilityFilter = document.getElementById('routing-facility-filter')?.value || '';
    findAndRouteNearestFacility(e.latlng.lat, e.latlng.lng, facilityFilter);
    return true; // handled
};

// ─── Gunakan GPS / Geolokasi ────────────────────────────────────────────────

function routeFromMyLocation() {
    if (!navigator.geolocation) {
        alert('Browser Anda tidak mendukung Geolocation.');
        return;
    }

    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.remove('hidden');

    navigator.geolocation.getCurrentPosition(
        (position) => {
            if (overlay) overlay.classList.add('hidden');
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            const facilityFilter = document.getElementById('routing-facility-filter')?.value || '';
            findAndRouteNearestFacility(lat, lng, facilityFilter);
        },
        (error) => {
            if (overlay) overlay.classList.add('hidden');
            let msg = 'Gagal mendapatkan lokasi.';
            if (error.code === 1) msg = 'Akses lokasi ditolak. Izinkan akses lokasi di browser Anda.';
            else if (error.code === 2) msg = 'Posisi tidak tersedia.';
            else if (error.code === 3) msg = 'Waktu permintaan lokasi habis.';
            alert(msg);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
}

// ─── Bersihkan Layer Routing ────────────────────────────────────────────────

function clearRoutingLayers() {
    window.routingLayerGroup.clearLayers();
    window.routingOriginMarker = null;
    const panel = document.getElementById('routing-result-panel');
    if (panel) panel.classList.add('hidden');
}

// ─── OSRM untuk Analisis Geoprocessing (digunakan oleh analysis.js) ─────────

/**
 * Mendapatkan rute jalan aktual dari centroid kecamatan ke fasilitas terdekat.
 * Digunakan oleh runGeoprocessing() di analysis.js untuk upgrade isokron.
 * @param {number} fromLng
 * @param {number} fromLat
 * @param {Array<object>} facilityPoints - Array GeoJSON feature points
 * @returns {Promise<{distance_km, duration_min, geometry, nearestFeature}|null>}
 */
async function osrmNearestRoute(fromLng, fromLat, facilityPoints) {
    if (facilityPoints.length === 0) return null;

    // Pre-filter: 5 terdekat secara garis lurus
    const fromPoint = turf.point([fromLng, fromLat]);
    const withDist = facilityPoints.map(f => ({
        feature: f,
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        straightDist: turf.distance(fromPoint, f, { units: 'kilometers' })
    }));
    withDist.sort((a, b) => a.straightDist - b.straightDist);
    const candidates = withDist.slice(0, 5);

    // Coba OSRM Table API
    const tableResult = await osrmTable(fromLng, fromLat, candidates.map(c => ({ lng: c.lng, lat: c.lat })));

    let bestIdx = 0;
    if (tableResult) {
        let minDist = Infinity;
        tableResult.distances.forEach((d, i) => {
            if (d !== null && d < minDist) {
                minDist = d;
                bestIdx = i;
            }
        });
    }

    const best = candidates[bestIdx];

    // Dapatkan geometri rute
    const routeResult = await osrmRoute(fromLng, fromLat, best.lng, best.lat);

    if (routeResult) {
        return {
            distance_km: routeResult.distance_km,
            duration_min: routeResult.duration_min,
            geometry: routeResult.geometry,
            nearestFeature: best.feature
        };
    }

    // Fallback: kembalikan data Turf.js
    return {
        distance_km: best.straightDist * window.DETOUR_INDEX,
        duration_min: (best.straightDist * window.DETOUR_INDEX / window.SPEED_KMH) * 60,
        geometry: null,
        nearestFeature: best.feature
    };
}
