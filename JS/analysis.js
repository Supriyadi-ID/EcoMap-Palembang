async function runFacilityNeedAnalysis() {
    const analyzeBtn = document.getElementById('btn-analyze');
    if (analyzeBtn) {
        analyzeBtn.disabled = true;
        analyzeBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i> Memproses...`;
        analyzeBtn.classList.add('opacity-75', 'cursor-not-allowed');
    }

    const kecSelect = document.getElementById('kecamatan-select');
    
    const kecName = kecSelect ? kecSelect.value : "";
    if (!kecName) {
        alert("Silakan pilih kecamatan terlebih dahulu.");
        if (analyzeBtn) {
            analyzeBtn.disabled = false;
            analyzeBtn.innerHTML = `<i class="fa-solid fa-play mr-2"></i> Analisis`;
            analyzeBtn.classList.remove('opacity-75', 'cursor-not-allowed');
        }
        return;
    }

    // Ambil API key dari backend secara aman (di-cache di window._appConfig)
    if (!window._appConfig) {
        try {
            const cfgRes = await fetch('/api/config');
            window._appConfig = await cfgRes.json();
        } catch (e) {
            console.error('Gagal memuat konfigurasi dari server:', e);
            window._appConfig = { mapidKey: '', orsKey: '' };
        }
    }
    const provider = "mapid";
    const orsKey   = window._appConfig.orsKey;

    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.remove('hidden');

    try {
        if (typeof clearAnalysis === 'function') clearAnalysis();
        else {
            if (window.recommendedFacilitiesGroup) window.recommendedFacilitiesGroup.clearLayers();
            if (window.isochroneCoverageGroup) window.isochroneCoverageGroup.clearLayers();
            if (window.unservedAreaGroup) window.unservedAreaGroup.clearLayers();
        }

        let isAllKota = (kecName === "Kota Palembang");
        let kecData;
        let popData = { pop: 0 };
        
        if (isAllKota) {
            kecData = window.kecamatanData.features[0];
            for (let i = 1; i < window.kecamatanData.features.length; i++) {
                try { kecData = turf.union(kecData, window.kecamatanData.features[i]); } catch(e){}
            }
            for (let k in window.populationData) { popData.pop += window.populationData[k].pop; }
        } else {
            kecData = window.kecamatanData.features.find(f => (f.properties.NAMOBJ || "").toUpperCase() === kecName.toUpperCase());
            if (!kecData) throw new Error("Data kecamatan tidak ditemukan.");
            popData = window.populationData[kecName.toUpperCase()] || { pop: 0 };
        }

        const estWasteKg = popData.pop * 0.7;
        const facilitySelect = document.getElementById('analysis-facility-select');
        const selectedFacility = facilitySelect ? facilitySelect.value : "Bank Sampah";

        // 1. Fasilitas Eksisting
        let existingFacilities = [];
        let existingCapacity = 0;
        
        for (let key in window.facilitiesData) {
            let data = window.facilitiesData[key];
            if (!data.geojson) continue;
            
            // Filter by facility type
            if (selectedFacility === "Bank Sampah" && !key.includes("Bank Sampah")) continue;
            if (selectedFacility === "TPS3R" && !(key.includes("TPS3R") || key.includes("UPS"))) continue;
            if (selectedFacility === "Rumah Kompos" && !key.includes("Rumah Kompos")) continue;
            if (selectedFacility === "Komposting" && !(key.includes("Komposting") || key.includes("Biodigester"))) continue;
            if (selectedFacility === "TPA" && !(key.includes("Induk") || key.includes("TPA"))) continue;
            
            let cap = 0;
            let timeLimit = 120; // Default
            
            if (key.includes("Induk") || key.includes("TPA")) { cap = 5000; timeLimit = 1800; } // 15km -> 1800s
            else if (key.includes("Bank Sampah")) { cap = 500; timeLimit = 120; } // 1km -> 120s
            else if (key.includes("TPS3R") || key.includes("UPS")) { cap = 2000; timeLimit = 360; } // 3km -> 360s
            else if (key.includes("Rumah Kompos")) { cap = 500; timeLimit = 120; } // 1km -> 120s
            else if (key.includes("Komposting") || key.includes("Biodigester")) { cap = 200; timeLimit = 60; } // 500m -> 60s
            else if (key.includes("Lain")) { cap = 200; timeLimit = 60; }

            if (cap > 0) {
                data.geojson.features.forEach(f => {
                    if (f.geometry && (isAllKota || turf.booleanPointInPolygon(f, kecData))) {
                        existingFacilities.push({ feature: f, timeLimitSec: timeLimit });
                        existingCapacity += cap;
                    }
                });
            }
        }

        const kecPemukimanFeatures = isAllKota 
            ? window.pemukimanData.features 
            : window.pemukimanData.features.filter(f => (f.properties.NAMOBJ || "").toUpperCase() === kecName.toUpperCase());
        
        let totalPemukimanArea = 0;
        kecPemukimanFeatures.forEach(pf => { totalPemukimanArea += turf.area(pf); });

        const mapidKey = window._appConfig.mapidKey;

        const fetchIsochrone = async (lat, lng, specificTimeLimit) => {
            if (provider === 'mapid') {
                const url = `https://routing.mapid.io/isochrone?key=${mapidKey}&point=${lat},${lng}&profile=motorcycle&time_limit=${specificTimeLimit}`;
                try {
                    let r = await fetch(url);
                    if (!r.ok) throw new Error("MAPID non-200");
                    let res = await r.json();
                    if (res && res.polygons) {
                        return res.polygons[0];
                    }
                } catch(e) {
                    console.warn("MAPID failed, falling back to ORS POST API:", e);
                    const orsUrl = `https://api.openrouteservice.org/v2/isochrones/driving-car`;
                    try {
                        let r2 = await fetch(orsUrl, {
                            method: 'POST',
                            headers: {
                                'Authorization': orsKey,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                locations: [[lng, lat]],
                                range: [specificTimeLimit],
                                attributes: ["area"]
                            })
                        });
                        let res2 = await r2.json();
                        if (res2 && res2.features) return res2.features[0];
                    } catch(err) {
                        console.error("ORS fallback failed:", err);
                    }
                }
            } else if (provider === 'ors') {
                const orsUrl = `https://api.openrouteservice.org/v2/isochrones/driving-car`;
                try {
                    let r = await fetch(orsUrl, {
                        method: 'POST',
                        headers: {
                            'Authorization': orsKey,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            locations: [[lng, lat]],
                            range: [specificTimeLimit],
                            attributes: ["area"]
                        })
                    });
                    let res = await r.json();
                    if (res && res.features) return res.features[0];
                } catch (e) {
                    console.error("ORS failed:", e);
                }
            }
            return null; // No fallback buffer, just return null if APIs fail
        };

        // --- TAHAP 1: KETERJANGKAUAN FASILITAS EKSISTING ---
        // Fetch secara berurutan dengan sedikit jeda (delay) untuk menghindari Rate Limit / API Block (HTTP 429) dari server
        let existingIsochroneResults = [];
        for (let item of existingFacilities) {
            let res = await fetchIsochrone(item.feature.geometry.coordinates[1], item.feature.geometry.coordinates[0], item.timeLimitSec);
            existingIsochroneResults.push(res);
            // Jeda 300ms antar request
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        let validIsochrones = existingIsochroneResults.filter(g => g !== null);
        
        // Tentukan Area Pemukiman Belum Terjangkau (Zona Merah) & Terjangkau (Zona Hijau)
        let unservedFeatures = [];
        let servedFeatures = [];
        let totalUnservedArea = 0;

        kecPemukimanFeatures.forEach(pf => {
            if (validIsochrones.length > 0) {
                let currentPf = pf;
                let servedParts = [];
                
                for (let iso of validIsochrones) {
                    if (!currentPf) break;
                    try {
                        let intersect = turf.intersect(currentPf, iso);
                        if (intersect) {
                            servedParts.push(intersect);
                            currentPf = turf.difference(currentPf, iso);
                        }
                    } catch(e) {
                        // Abaikan jika terjadi error topologi pada irisan ini
                    }
                }
                
                if (currentPf) {
                    unservedFeatures.push(currentPf);
                    totalUnservedArea += turf.area(currentPf);
                }
                
                servedParts.forEach(sp => servedFeatures.push(sp));
            } else {
                unservedFeatures.push(pf);
                totalUnservedArea += turf.area(pf);
            }
        });

        // Tampilkan Zona Terlayani dan Belum Terlayani
        if (servedFeatures.length > 0) {
            let fc = turf.featureCollection(servedFeatures);
            L.geoJSON(fc, {
                style: { color: '#22c55e', weight: 0, fillColor: '#22c55e', fillOpacity: 1.0 }, // Green
                onEachFeature: (f, l) => l.bindTooltip("Area Pemukiman Terlayani (Eksisting)", {sticky: true})
            }).addTo(window.isochroneCoverageGroup);
        }

        if (unservedFeatures.length > 0) {
            let fc = turf.featureCollection(unservedFeatures);
            L.geoJSON(fc, {
                style: { color: '#ef4444', weight: 0, fillColor: '#ef4444', fillOpacity: 1.0 }, // Red
                onEachFeature: (f, l) => l.bindTooltip("Area Pemukiman Belum Terjangkau", {sticky: true})
            }).addTo(window.unservedAreaGroup);
        }

        // --- TAHAP 2: KALKULASI KEBUTUHAN DAN PENEMPATAN FASILITAS BARU ---
        
        let unservedPct = totalPemukimanArea > 0 ? (totalUnservedArea / totalPemukimanArea) : 0;
        let unservedPop = popData.pop * unservedPct;
        let estWasteKgSisa = unservedPop * 0.7; // Hanya untuk ditampilkan di UI
        
        // Jarak Range: Titik baru minimal berjarak X dari eksisting, dan 2xX dari titik baru lainnya
        let minDistToExisting = 1.0; 
        let minDistToNew = 2.0; 
        
        if (selectedFacility === "TPS3R") { minDistToExisting = 3.0; minDistToNew = 6.0; }
        else if (selectedFacility === "Bank Sampah") { minDistToExisting = 1.0; minDistToNew = 2.0; }
        else if (selectedFacility === "Rumah Kompos") { minDistToExisting = 1.0; minDistToNew = 2.0; }
        else if (selectedFacility === "Komposting") { minDistToExisting = 0.5; minDistToNew = 1.0; }

        let points = [];
        // Ambil sampel titik HANYA dari area merah (unservedFeatures)
        unservedFeatures.forEach(pf => {
            try {
                let exploded = turf.explode(pf);
                exploded.features.forEach(pt => points.push(pt));
            } catch(e) {}
        });

        // Urutkan titik secara deterministik (Bujur lalu Lintang) 
        // agar hasil packing spasial 100% konsisten setiap kali analisis dijalankan
        points = points.sort((a, b) => {
            let cA = a.geometry.coordinates;
            let cB = b.geometry.coordinates;
            if (cA[0] !== cB[0]) return cA[0] - cB[0];
            return cA[1] - cB[1];
        });
        
        let selectedPoints = [];

        // Packing Algorithm: Tempatkan sebanyak mungkin titik di area merah tanpa melanggar batas jarak minimum
        for (let i = 0; i < points.length; i++) {
            let candidate = points[i];
            let tooClose = false;

            // Jarak dengan fasilitas eksisting (harus > range 1x radius, misal 3km)
            for (let ef of existingFacilities) {
                let dist = turf.distance(candidate, ef.feature, {units: 'kilometers'});
                if (dist < minDistToExisting) { tooClose = true; break; }
            }
            if (tooClose) continue;

            // Jarak dengan titik baru yang sudah dipilih (harus > range 2x radius, misal 6km)
            for (let sp of selectedPoints) {
                let dist = turf.distance(candidate, sp, {units: 'kilometers'});
                if (dist < minDistToNew) { tooClose = true; break; }
            }

            if (!tooClose) {
                selectedPoints.push(candidate);
            }
        }

        let newCenters = selectedPoints;
        
        // Kebutuhan unit didapatkan langsung dari jumlah titik kluster area yang belum terjangkau
        let req = { bankSampah: 0, tps3r: 0, rumahKompos: 0, komposting: 0 };
        if (selectedFacility === "Bank Sampah") req.bankSampah = newCenters.length;
        else if (selectedFacility === "TPS3R") req.tps3r = newCenters.length;
        else if (selectedFacility === "Rumah Kompos") req.rumahKompos = newCenters.length;
        else if (selectedFacility === "Komposting") req.komposting = newCenters.length;

        const newLocationsCount = newCenters.length;

        // TPS3R diupayakan di luar area pemukiman (digeser)
        if (selectedFacility === "TPS3R") {
            newCenters = newCenters.map(pt => movePointOutside(pt, kecPemukimanFeatures, kecData));
        }

        newCenters.forEach((c, idx) => {
            const lng = c.geometry.coordinates[0];
            const lat = c.geometry.coordinates[1];
            L.marker([lat, lng], {
                icon: L.divIcon({
                    className: 'custom-div-icon',
                    html: `<div style="background-color: #3b82f6; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 4px rgba(0,0,0,0.5);"></div>`,
                    iconSize: [14, 14]
                })
            }).bindTooltip(`Rekomendasi Lokasi Baru #${idx+1}`, {sticky: true}).addTo(window.recommendedFacilitiesGroup);
        });

        // Update UI Summary
        window.latestFacilityNeeds = {
            name: kecName,
            pop: popData.pop,
            estWasteKg: estWasteKg,
            existingCapacity: existingCapacity,
            existingCount: existingFacilities.length,
            recommended: req,
            totalLocations: newLocationsCount,
            unservedPct: unservedPct * 100
        };

        if (typeof showFacilityNeedSummary === 'function') {
            showFacilityNeedSummary(window.latestFacilityNeeds);
        }

    } catch (error) {
        console.error("Analysis Error:", error);
        alert("Terjadi kesalahan saat menjalankan analisis: " + error.message);
    } finally {
        if (overlay) overlay.classList.add('hidden');
        if (analyzeBtn) {
            analyzeBtn.disabled = false;
            analyzeBtn.innerHTML = `<i class="fa-solid fa-play mr-2"></i> Analisis`;
            analyzeBtn.classList.remove('opacity-75', 'cursor-not-allowed');
        }
    }
}

// Helper untuk memindahkan titik ke luar area pemukiman (tapi tetap di dalam kecamatan)
function movePointOutside(pt, pemukimanFeatures, kecFeature) {
    let currentPt = pt;
    
    // Cek apakah pt di dalam pemukiman
    let isInside = false;
    for (let f of pemukimanFeatures) {
        if (turf.booleanPointInPolygon(currentPt, f)) {
            isInside = true;
            break;
        }
    }
    
    if (!isInside) return currentPt;

    // Cari titik terdekat di luar (batas jarak 2km)
    for (let d = 0.1; d <= 2.0; d += 0.1) {
        for (let a = 0; a < 360; a += 45) {
            let candidate = turf.destination(currentPt, d, a);
            // Harus di dalam kecamatan
            if (turf.booleanPointInPolygon(candidate, kecFeature)) {
                let stillInside = false;
                for (let f of pemukimanFeatures) {
                    if (turf.booleanPointInPolygon(candidate, f)) {
                        stillInside = true;
                        break;
                    }
                }
                if (!stillInside) return candidate; // ketemu posisi luar terdekat
            }
        }
    }
    
    return currentPt;
}
