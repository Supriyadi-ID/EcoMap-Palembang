// Global Map Variables
window.map = null;
window.kecamatanLayer = null;
window.pemukimanLayer = null;
window.facilitiesLayerGroup = L.markerClusterGroup({
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true,
    maxClusterRadius: 50
});
window.recommendedFacilitiesGroup = L.layerGroup();
window.isochroneCoverageGroup = L.layerGroup();
window.unservedAreaGroup = L.layerGroup();
window.routingLayerGroup = L.layerGroup();

// Data Storage
window.kecamatanData = null;
window.pemukimanData = null;
window.facilitiesData = {}; // key: name, value: { layer, geojson, config, visible }
window.populationData = {};
window.pemukimanAreaKec = {};

window.API_PATH = 'APP/DATA/';
window.SPEED_KMH = 30; 
window.DETOUR_INDEX = 1.3; 

window.facilityConfig = [
    { file: '00_Bank_Sampah_Induk.geojson', name: 'Bank Sampah Induk', color: '#16a34a', icon: 'fa-building' },
    { file: '01_Bank_Sampah.geojson', name: 'Bank Sampah', color: '#22c55e', icon: 'fa-recycle' },
    { file: '02_TPS3R_atau_UPS.geojson', name: 'TPS3R / UPS', color: '#eab308', icon: 'fa-truck-fast' },
    { file: '03_TPA_atau_TPST.geojson', name: 'TPA / TPST', color: '#ef4444', icon: 'fa-dumpster' },
    { file: '04_Komposting_Skala_RTRW.geojson', name: 'Unit Komposting Skala RT/RW', color: '#84cc16', icon: 'fa-leaf' },
    { file: '05_Rumah_Kompos.geojson', name: 'Rumah Kompos', color: '#a3e635', icon: 'fa-house' },
    { file: '06_Biodigester.geojson', name: 'Biodigester', color: '#06b6d4', icon: 'fa-flask' },
    { file: '07_Pengelolaan_Sampah_Sektor_Informal_2022.geojson', name: 'Fasilitas Lain (Sektor Informal)', color: '#8b5cf6', icon: 'fa-users' }
];

document.addEventListener("DOMContentLoaded", initMap);

function initMap() {
    window.map = L.map('map', { zoomControl: false }).setView([-2.976, 104.775], 12);
    
    // Controls
    L.control.zoom({ position: 'topright' }).addTo(window.map);

    const googleSat = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { maxZoom: 20, attribution: ' Google' });
    const googleHybrid = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 20, attribution: ' Google' });
    
    const esriWorldImagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { 
        maxZoom: 20, 
        maxNativeZoom: 19,
        attribution: 'Tiles &copy; Esri' 
    });
    
    const openStreetMap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 20,
        maxNativeZoom: 19,
        attribution: '&copy; OpenStreetMap'
    });
    
    googleSat.addTo(window.map); 

    const baseMaps = {
        "Google Satellite": googleSat, 
        "Google Hybrid": googleHybrid, 
        "Esri World Imagery": esriWorldImagery,
        "OpenStreetMap": openStreetMap
    };

    L.control.layers(baseMaps, {}, { position: 'topright' }).addTo(window.map);

    // --- Geocoding (Pencarian Lokasi) & Geolocation (GPS) ---
    try {
        if (typeof L.Control.Geocoder !== 'undefined') {
            L.Control.geocoder({
                defaultMarkGeocode: false,
                placeholder: "Cari alamat/lokasi..."
            })
            .on('markgeocode', function(e) {
                const bbox = e.geocode.bbox;
                const poly = L.polygon([
                    bbox.getSouthEast(),
                    bbox.getNorthEast(),
                    bbox.getNorthWest(),
                    bbox.getSouthWest()
                ]).addTo(window.map);
                window.map.fitBounds(poly.getBounds());
                
                L.marker(e.geocode.center).addTo(window.map)
                    .bindPopup(e.geocode.name)
                    .openPopup();
                
                // Hapus bounding box setelah 3 detik untuk tampilan yang bersih
                setTimeout(() => window.map.removeLayer(poly), 3000);
            })
            .addTo(window.map);
        }

        if (typeof L.control.locate !== 'undefined') {
            L.control.locate({
                position: 'topleft',
                strings: {
                    title: "Temukan lokasi saya",
                    popup: "Anda berada di sekitar {distance} {unit} dari titik ini"
                },
                locateOptions: {
                    enableHighAccuracy: true,
                    maxZoom: 16
                }
            }).addTo(window.map);
        }
    } catch (error) {
        console.error("Gagal memuat kontrol Geocoding/Geolocation:", error);
    }
    // --------------------------------------------------------

    facilitiesLayerGroup.addTo(window.map);
    recommendedFacilitiesGroup.addTo(window.map);
    isochroneCoverageGroup.addTo(window.map);
    unservedAreaGroup.addTo(window.map);
    routingLayerGroup.addTo(window.map);

    let collisionTimer;
    function triggerCollisionCheck() {
        if (window.map.getZoom() >= 14) {
            document.getElementById('map').classList.add('show-facility-labels'); 
            clearTimeout(collisionTimer);
            collisionTimer = setTimeout(resolveTooltipCollisions, 150);
        } else {
            document.getElementById('map').classList.remove('show-facility-labels');
            const labels = document.querySelectorAll('.facility-label');
            labels.forEach(l => {
                l.style.visibility = 'hidden';
                l.style.opacity = '0';
            });
        }
    }

    window.map.on('zoomend moveend', triggerCollisionCheck);
    
    // Also trigger on MarkerCluster spiderfy animations
    if (window.facilitiesLayerGroup) {
        window.facilitiesLayerGroup.on('spiderfied unspiderfied animationend', function() {
            setTimeout(triggerCollisionCheck, 50);
        });
    }

    function resolveTooltipCollisions() {
        if (window.map.getZoom() < 14) return;
        const labels = Array.from(document.querySelectorAll('.facility-label')).filter(l => l.offsetWidth > 0);
        
        // Reset all labels to visible and clear custom margins without transition
        labels.forEach(l => { 
            l.style.transition = 'none'; // Disable transition so reset is instant
            l.style.visibility = 'visible'; 
            l.style.opacity = '1'; 
            l.style.marginLeft = '0px';
            l.style.marginTop = '0px';
        });

        // Force browser layout recalculation so getBoundingClientRect reads the exact 0,0 center
        void document.body.offsetHeight;
        
        // Re-enable transition for smooth movement to their new candidate spots
        labels.forEach(l => { 
            l.style.transition = 'opacity 0.2s ease-in-out, margin 0.2s ease'; 
        });
        
        labels.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
        
        // Collect all icons to prevent labels from covering ANY facility or cluster symbols
        const icons = Array.from(document.querySelectorAll('.custom-div-icon, .marker-cluster')).filter(icon => icon.offsetWidth > 0);
        const rects = icons.map(icon => {
            const r = icon.getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        });

        for (let i = 0; i < labels.length; i++) {
            const label = labels[i]; 
            const centerRect = label.getBoundingClientRect();
            const W = centerRect.width;
            const H = centerRect.height;
            const GAP = 14; // 12px radius + 2px breathing room
            const diag = 13; // Safely clears the 12px AABB corner of its own icon
            
            // 8-way candidate positions [Right, Left, Bottom, Top, Bottom-Right, Bottom-Left, Top-Right, Top-Left]
            // Prioritize horizontal, then vertical, then diagonal for cleanest readability
            const candidates = [
                { mx: (W/2 + GAP), my: 0 },
                { mx: -(W/2 + GAP), my: 0 },
                { mx: 0, my: (H/2 + GAP) },
                { mx: 0, my: -(H/2 + GAP) },
                { mx: (W/2 + diag), my: (H/2 + diag) },
                { mx: -(W/2 + diag), my: (H/2 + diag) },
                { mx: (W/2 + diag), my: -(H/2 + diag) },
                { mx: -(W/2 + diag), my: -(H/2 + diag) }
            ];
            
            let bestCandidate = null;
            let bestRect = null;
            
            for (let c = 0; c < candidates.length; c++) {
                const shiftX = candidates[c].mx;
                const shiftY = candidates[c].my;
                
                const testRect = {
                    left: centerRect.left + shiftX,
                    right: centerRect.right + shiftX,
                    top: centerRect.top + shiftY,
                    bottom: centerRect.bottom + shiftY
                };

                let overlap = false;
                for (let j = 0; j < rects.length; j++) {
                    const other = rects[j];
                    if (testRect.left + 1 < other.right && testRect.right - 1 > other.left && testRect.top + 1 < other.bottom && testRect.bottom - 1 > other.top) { 
                        overlap = true; break; 
                    }
                }
                
                if (!overlap) {
                    bestCandidate = candidates[c];
                    bestRect = testRect;
                    break;
                }
            }

            if (bestCandidate) {
                label.style.marginLeft = bestCandidate.mx + 'px';
                label.style.marginTop = bestCandidate.my + 'px';
                rects.push(bestRect);
            } else {
                label.style.visibility = 'hidden';
                label.style.opacity = '0';
            }
        }
    }

    window.map.on('click', function(e) {
        // Routing mode: cari rute ke fasilitas terdekat
        if (window.isRoutingMode && typeof window.handleRoutingMapClick === 'function') {
            if (window.handleRoutingMapClick(e)) return;
        }

        if (window.isAddingFacility) {
            document.getElementById('edit-lat').value = e.latlng.lat.toFixed(6);
            document.getElementById('edit-lng').value = e.latlng.lng.toFixed(6);
            document.getElementById('instruction-overlay').classList.add('hidden');
            window.map.getContainer().style.cursor = '';
            window.isAddingFacility = false;
            toggleModal('modal-edit-facility');
            return;
        }

        if (window.highlightedKecamatan) {
            window.kecamatanLayer.resetStyle(window.highlightedKecamatan);
            window.highlightedKecamatan = null;
        }
    });

    window.map.createPane('kecamatanPane');
    window.map.getPane('kecamatanPane').style.zIndex = 405; 
    window.map.createPane('pemukimanPane');
    window.map.getPane('pemukimanPane').style.zIndex = 400; 

    loadPopulationData().then(async () => {
        await loadPemukimanData(); 
        await loadKecamatanData();
        await loadFacilitiesData();

        // Populate routing facility filter dropdown
        const routingFilter = document.getElementById('routing-facility-filter');
        if (routingFilter) {
            window.facilityConfig.forEach(cfg => {
                const opt = document.createElement('option');
                opt.value = cfg.name;
                opt.textContent = cfg.name;
                routingFilter.appendChild(opt);
            });
        }
        
        // Populate kecamatan dropdown for analysis
        const kecSelect = document.getElementById('kecamatan-select');
        if (kecSelect && window.kecamatanData) {
            // Option for Kota Palembang
            const optAll = document.createElement('option');
            optAll.value = "Kota Palembang";
            optAll.textContent = "Kota Palembang";
            kecSelect.appendChild(optAll);

            let names = window.kecamatanData.features.map(f => f.properties.NAMOBJ).filter(n => n).sort();
            names.forEach(n => {
                const opt = document.createElement('option');
                opt.value = n;
                opt.textContent = n;
                kecSelect.appendChild(opt);
            });

            // Auto zoom to selected kecamatan
            kecSelect.addEventListener('change', (e) => {
                const selected = e.target.value;
                if (!selected) return;
                
                if (selected === "Kota Palembang") {
                    const layer = L.geoJSON(window.kecamatanData);
                    window.map.fitBounds(layer.getBounds(), { padding: [20, 20], animate: true });
                } else {
                    const kecFeature = window.kecamatanData.features.find(f => (f.properties.NAMOBJ || "").toUpperCase() === selected.toUpperCase());
                    if (kecFeature) {
                        const layer = L.geoJSON(kecFeature);
                        window.map.fitBounds(layer.getBounds(), { padding: [50, 50], animate: true });
                    }
                }
            });
        }
    });

    setupEvents();
}
