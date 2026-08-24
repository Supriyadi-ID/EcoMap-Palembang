async function loadPopulationData() {
    try {
        const response = await fetch(window.API_PATH + 'Data_Jumlah_Penduduk_Per_Kecamatan_Palembang_2025.csv');
        const csvText = await response.text();
        const lines = csvText.split('\n');
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            const cols = lines[i].split(',');
            if (cols.length >= 2) {
                window.populationData[cols[0].trim().toUpperCase()] = { pop: parseInt(cols[1]), growth: parseFloat(cols[2] || 0) };
            }
        }
    } catch (e) { console.error("Pop data error", e); }
}

window.highlightedKecamatan = null;

async function loadKecamatanData() {
    try {
        const response = await fetch(window.API_PATH + 'BASE_Adm_Kec_Palembang.geojson');
        window.kecamatanData = await response.json();
        
        const container = document.getElementById('kecamatan-control-container');
        if(container) {
            container.innerHTML = `
                <div class="mb-2 group relative">
                    <label class="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                        <input type="checkbox" id="chk-kecamatan" checked class="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4 shrink-0" onchange="toggleKecamatan(this.checked)">
                        <span class="w-4 h-4 border border-gray-400 bg-black inline-block opacity-70 shrink-0"></span>
                        
                        <!-- Container for text and slider -->
                        <div class="relative flex-1 h-full" style="min-height: 20px;">
                            <span class="text-gray-700 font-medium text-sm absolute inset-0 flex items-center group-hover:opacity-0 transition-opacity">Batas Kecamatan</span>
                            <input type="range" min="0" max="100" value="25" class="w-full accent-emerald-600 absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity z-10 cursor-ew-resize" oninput="window.updateKecamatanOpacity(this.value)">
                        </div>
                    </label>
                </div>
            `;
        }

        window.updateKecamatanOpacity = function(val) {
            if (window.kecamatanLayer) {
                const newOpacity = val / 100;
                window.kecamatanLayer.options.style = Object.assign(
                    {}, 
                    window.kecamatanLayer.options.style, 
                    { fillOpacity: newOpacity }
                );
                window.kecamatanLayer.setStyle({ fillOpacity: newOpacity });
            }
        };

        window.kecamatanLayer = L.geoJSON(window.kecamatanData, {
            pane: 'kecamatanPane',
            style: {
                color: '#ffffff',
                weight: 2,
                opacity: 1,
                fillColor: '#000000',
                fillOpacity: 0.25
            },
            onEachFeature: (feature, layer) => {
                const name = feature.properties.NAMOBJ;
                const area = turf.area(feature) / 1000000; 
                const popInfo = window.populationData[(name || "").toUpperCase()] || { pop: 0, growth: 0 };
                
                const pemukimanArea = window.pemukimanAreaKec[(name || "").toUpperCase()] || 0;
                
                const estWastePerCapita = 0.7; 
                const dailyWasteKg = popInfo.pop * estWastePerCapita;
                
                const popupContent = `
                    <div class="p-2 min-w-[200px]">
                        <h3 class="font-bold text-emerald-800 text-lg border-b pb-1 mb-2 capitalize">${(name || "").toLowerCase()}</h3>
                        <div class="text-sm space-y-2">
                            <div class="flex justify-between"><span class="text-gray-500">Luas Wilayah:</span><span class="font-medium">${area.toFixed(2)} km²</span></div>
                            <div class="flex justify-between"><span class="text-gray-500">Area Pemukiman:</span><span class="font-medium text-emerald-600">${pemukimanArea.toFixed(2)} km²</span></div>
                            <div class="flex justify-between"><span class="text-gray-500">Penduduk 2025:</span><span class="font-bold">${popInfo.pop.toLocaleString('id-ID')} jiwa</span></div>
                            <div class="flex justify-between bg-orange-50 p-1 rounded border border-orange-100"><span class="text-orange-700">Est. Sampah Harian:</span><span class="font-bold text-orange-600">${Math.round(dailyWasteKg).toLocaleString('id-ID')} kg</span></div>
                        </div>
                    </div>
                `;
                layer.bindPopup(popupContent);

                layer.on({
                    click: (e) => {
                        if (window.isAddingFacility) {
                            document.getElementById('edit-lat').value = e.latlng.lat.toFixed(6);
                            document.getElementById('edit-lng').value = e.latlng.lng.toFixed(6);
                            document.getElementById('instruction-overlay').classList.add('hidden');
                            window.map.getContainer().style.cursor = '';
                            window.isAddingFacility = false;
                            toggleModal('modal-edit-facility');
                            layer.closePopup(); // Prevent popup if we are adding facility
                        }
                    },
                    popupopen: (e) => {
                        window.highlightedKecamatan = layer;
                        layer.setStyle({ weight: 4, color: '#ffff00', fillOpacity: 0.7 });
                    },
                    popupclose: (e) => {
                        if (window.highlightedKecamatan === layer) {
                            window.kecamatanLayer.resetStyle(layer);
                            window.highlightedKecamatan = null;
                        }
                    }
                });
            }
        });
        
        window.kecamatanLayer.addTo(window.map);
    } catch (e) { console.error("Kecamatan data error", e); }
}

window.toggleKecamatan = function(isVisible) {
    if (window.kecamatanLayer) {
        if (isVisible) window.map.addLayer(window.kecamatanLayer);
        else window.map.removeLayer(window.kecamatanLayer);
    }
}

async function loadPemukimanData() {
    try {
        const response = await fetch(window.API_PATH + 'BASE_Area_Pemukiman_(Google_Building_Footprint_v3).geojson');
        window.pemukimanData = await response.json();
        
        // Map Google Building Footprint names to Official Names
        window.pemukimanAreaKec = {};
        if(window.pemukimanData && window.pemukimanData.features) {
            window.pemukimanData.features.forEach(f => {
                const areaKm2 = turf.area(f) / 1000000;
                let rawName = f.properties.NAMOBJ || "";
                rawName = rawName.toUpperCase();
                if(!window.pemukimanAreaKec[rawName]) window.pemukimanAreaKec[rawName] = 0;
                window.pemukimanAreaKec[rawName] += areaKm2;
            });
        }

        window.pemukimanLayer = L.geoJSON(window.pemukimanData, {
            pane: 'pemukimanPane',
            interactive: true,
            style: {
                color: '#f97316',
                  weight: 1,
                  opacity: 0.25,
                  fillColor: '#fdba74',
                  fillOpacity: 0.25
            },
            onEachFeature: (feature, layer) => {
                layer.on('click', (e) => {
                    if (window.isAddingFacility) {
                        document.getElementById('edit-lat').value = e.latlng.lat.toFixed(6);
                        document.getElementById('edit-lng').value = e.latlng.lng.toFixed(6);
                        document.getElementById('instruction-overlay').classList.add('hidden');
                        window.map.getContainer().style.cursor = '';
                        window.isAddingFacility = false;
                        toggleModal('modal-edit-facility');
                    }
                });
            }
        });
        window.pemukimanLayer.addTo(window.map);

        const container = document.getElementById('pemukiman-control-container');
        if(container) {
            container.innerHTML = `
                  <div class="mb-2 group relative">
                      <label class="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                          <input type="checkbox" id="chk-pemukiman" checked class="rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4 shrink-0" onchange="togglePemukiman(this.checked)">
                          <span class="w-4 h-4 border border-orange-500 bg-orange-300 inline-block opacity-70 shrink-0"></span>
                          <div class="relative flex-1 h-full" style="min-height: 20px;">
                              <span class="text-gray-700 font-medium text-sm absolute inset-0 flex items-center group-hover:opacity-0 transition-opacity">Area Pemukiman</span>
                              <input type="range" min="0" max="100" value="25" class="w-full accent-orange-500 absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity z-10 cursor-ew-resize" oninput="window.updatePemukimanOpacity(this.value)">
                          </div>
                      </label>
                  </div>
              `;
        }
    } catch (e) { console.error("Pemukiman data error", e); }
window.updatePemukimanOpacity = function(val) {
    if (window.pemukimanLayer) {
        const newOpacity = val / 100;
        window.pemukimanLayer.options.style = Object.assign({}, window.pemukimanLayer.options.style, { fillOpacity: newOpacity, opacity: newOpacity });
        window.pemukimanLayer.setStyle({ fillOpacity: newOpacity, opacity: newOpacity });
    }
}
}

window.togglePemukiman = function(isVisible) {
    if (window.pemukimanLayer) {
        if (isVisible) window.map.addLayer(window.pemukimanLayer);
        else window.map.removeLayer(window.pemukimanLayer);
    }
}

async function loadFacilitiesData() {
    const controlsContainer = document.getElementById('facility-controls');
    const defaultOn = ['Bank Sampah Induk', 'Bank Sampah'];
    const savedStateJson = sessionStorage.getItem('ecomap_view_state');
    const savedState = savedStateJson ? JSON.parse(savedStateJson) : null;

    for (const config of window.facilityConfig) {
        try {
            let data;
            const savedData = localStorage.getItem('ecomap_layer_' + config.name);
            if (savedData) {
                data = JSON.parse(savedData);
            } else {
                const response = await fetch(window.API_PATH + config.file);
                data = await response.json();
            }

            if(data.features) {
                data.features.forEach(f => {
                    if (!f.properties._id) f.properties._id = Math.random().toString(36).substr(2, 9);
                    if (!f.properties.status) f.properties.status = 'Beroperasi';
                });
            }

            const count = data.features ? data.features.length : 0;
            const iconHtml = `<span style="background-color: ${config.color}; width:24px; height:24px; display:flex; align-items:center; justify-content:center; color:white; font-size:10px; border-radius:50%; border:2px solid white; box-shadow:0 2px 4px rgba(0,0,0,0.3);"><i class="fa-solid ${config.icon}"></i></span>`;
            const icon = L.divIcon({ className: 'custom-div-icon', html: iconHtml, iconSize: [24, 24], iconAnchor: [12, 12] });
            const isInduk = config.name === 'Bank Sampah Induk';

            const layer = L.geoJSON(data, {
                pointToLayer: (feature, latlng) => {
                    const marker = L.marker(latlng, { icon: icon, zIndexOffset: isInduk ? 1000 : 0 });
                    const p = feature.properties;
                    let displayNama = p.nama || "";
                    let jenis = p.jenis || "";

                    if (config.name === 'Fasilitas Lain (Sektor Informal)') {
                        if (jenis && displayNama) {
                            if (!displayNama.toLowerCase().startsWith(jenis.toLowerCase())) displayNama = jenis + " " + displayNama;
                        } else displayNama = displayNama || jenis || config.name;
                    } else displayNama = displayNama || config.name;

                    marker.bindTooltip(displayNama, { permanent: true, direction: 'center', className: 'facility-label', offset: [0, 0] });
                    return marker;
                },
                onEachFeature: (feature, layer) => {
                    const p = feature.properties;
                    let displayNama = p.nama || "";
                    let jenis = p.jenis || "";

                    if (config.name === 'Fasilitas Lain (Sektor Informal)') {
                        if (jenis && displayNama) {
                            if (!displayNama.toLowerCase().startsWith(jenis.toLowerCase())) displayNama = jenis + " " + displayNama;
                        } else displayNama = displayNama || jenis || config.name;
                    } else displayNama = displayNama || config.name;

                    const statusHtml = p.status === 'Tidak Beroperasi' ? '<span class="text-red-600 font-bold">Tidak Beroperasi</span>' : '<span class="text-emerald-600 font-bold">Beroperasi</span>';

                    layer.bindPopup(`
                        <div class="p-1 min-w-[240px]">
                            <h3 class="font-bold text-emerald-800 text-sm border-b pb-1 mb-2">${displayNama}</h3>
                            <table class="w-full text-xs text-gray-700">
                                <tr>
                                    <td class="text-gray-500 py-0.5 pr-2 w-20 align-top">Jenis</td>
                                    <td class="text-gray-500 py-0.5 pr-1 align-top w-2">:</td>
                                    <td class="align-top">${p.jenis || config.name}</td>
                                </tr>
                                <tr>
                                    <td class="text-gray-500 py-0.5 pr-2 align-top">Kecamatan</td>
                                    <td class="text-gray-500 py-0.5 pr-1 align-top">:</td>
                                    <td class="align-top capitalize">${(p.kecamatan || '-').toLowerCase()}</td>
                                </tr>
                                <tr>
                                    <td class="text-gray-500 py-0.5 pr-2 align-top">Status</td>
                                    <td class="text-gray-500 py-0.5 pr-1 align-top">:</td>
                                    <td class="align-top">${statusHtml}</td>
                                </tr>
                            </table>
                            <div class="mt-3 flex space-x-2 border-t pt-2">
                                <button onclick="openEditModal('${config.name}', '${p._id}')" class="flex-1 bg-blue-50 text-blue-700 py-1 rounded border border-blue-200 hover:bg-blue-100 font-medium transition">Edit</button>
                                <button onclick="deleteFacility('${config.name}', '${p._id}')" class="flex-1 bg-red-50 text-red-700 py-1 rounded border border-red-200 hover:bg-red-100 font-medium transition">Hapus</button>
                            </div>
                        </div>
                    `);
                }
            });

            let isVisible = defaultOn.includes(config.name);
            if (savedState) { const savedLayer = savedState.layers.find(l => l.name === config.name); if (savedLayer) isVisible = savedLayer.checked; }
            if (isVisible) layer.addTo(facilitiesLayerGroup);

            window.facilitiesData[config.name] = { layer, geojson: data, config, visible: isVisible };

            const id = 'chk-' + config.name.replace(/\s+/g, '-');
            controlsContainer.innerHTML += `
                <label class="flex items-center space-x-2 cursor-pointer hover:bg-gray-100 p-1 rounded">
                    <input type="checkbox" id="${id}" ${isVisible ? 'checked' : ''} class="rounded text-emerald-600 h-4 w-4 shrink-0" onchange="toggleFacility('${config.name}', this.checked)">
                    <div class="scale-75 origin-left shrink-0">${iconHtml}</div>
                    <span class="text-gray-700 flex-1 text-sm">${config.name} <span class="text-gray-400 text-[10px]">(${count})</span></span>
                </label>
            `;
        } catch (e) { console.error("Facility data error", e); }
    }
    
    
    if (typeof loadUserEdits === 'function') { loadUserEdits(); }
    if (savedState && window.map) {
        window.map.setView([savedState.lat, savedState.lng], savedState.zoom, {animate: false});
        sessionStorage.removeItem('ecomap_view_state');
    }
}

window.toggleFacility = function(name, isVisible) {
    if (window.facilitiesData[name]) {
        window.facilitiesData[name].visible = isVisible;
        if (isVisible) facilitiesLayerGroup.addLayer(window.facilitiesData[name].layer);
        else facilitiesLayerGroup.removeLayer(window.facilitiesData[name].layer);
    }
}

