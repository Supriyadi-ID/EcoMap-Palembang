window.userEdits = JSON.parse(localStorage.getItem('ecomap_user_edits')) || [];

window.openEditModal = function(layerName, featureId) {
    // Check if it's a user edit first
    let facility = window.userEdits.find(e => e.feature.properties._id === featureId)?.feature;
    // Fallback to base data
    if (!facility && window.facilitiesData[layerName]) {
        facility = window.facilitiesData[layerName].geojson.features.find(f => f.properties._id === featureId);
    }
    
    if (!facility) return;
    const p = facility.properties;
    const coords = facility.geometry.coordinates;

    document.getElementById('edit-modal-title').innerHTML = '<i class="fa-solid fa-pen-to-square mr-2"></i>Edit Fasilitas';
    document.getElementById('edit-id').value = p._id;
    document.getElementById('edit-original-layer').value = layerName;
    
    const select = document.getElementById('edit-layer');
    select.innerHTML = window.facilityConfig.map(c => `<option value="${c.name}" ${c.name === layerName ? 'selected' : ''}>${c.name}</option>`).join('');

    document.getElementById('edit-nama').value = p.nama || '';
    document.getElementById('edit-jenis').value = p.jenis || '';
    document.getElementById('edit-kecamatan').value = p.kecamatan || '';
    document.getElementById('edit-status').value = p.status || 'Beroperasi';
    document.getElementById('edit-lat').value = coords[1];
    document.getElementById('edit-lng').value = coords[0];

    window.toggleJenisVisibility();
    toggleModal('modal-edit-facility');
    window.map.closePopup();
};

window.toggleJenisVisibility = function() {
    const layer = document.getElementById('edit-layer').value;
    const container = document.getElementById('jenis-container');
    if (layer === 'Fasilitas Lain (Sektor Informal)') {
        container.style.display = 'block';
    } else {
        container.style.display = 'none';
        document.getElementById('edit-jenis').value = '';
    }
};

window.startAddFacility = function() {
    document.getElementById('edit-modal-title').innerHTML = '<i class="fa-solid fa-plus mr-2"></i>Tambah Fasilitas Baru';
    document.getElementById('edit-facility-form').reset();
    document.getElementById('edit-id').value = '';
    document.getElementById('edit-original-layer').value = '';

    const select = document.getElementById('edit-layer');
    select.innerHTML = window.facilityConfig.map(c => `<option value="${c.name}">${c.name}</option>`).join('');

    window.toggleJenisVisibility();
    toggleModal('modal-edit-facility');
};

window.deleteFacility = async function(layerName, featureId) {
    if(!confirm('Apakah Anda yakin ingin menghapus fasilitas ini? (Akan disimpan sebagai usulan penghapusan)')) return;
    
    // If it's purely a user addition, we can just remove it
    const editIndex = window.userEdits.findIndex(e => String(e.feature.properties._id) === String(featureId));
    if (editIndex > -1 && window.userEdits[editIndex].isNew) {
        const deletedEdit = window.userEdits[editIndex];
        if (deletedEdit._marker && window.facilitiesLayerGroup) {
            window.facilitiesLayerGroup.removeLayer(deletedEdit._marker);
        }
        window.userEdits.splice(editIndex, 1);
    } else {
        // It's a base feature, mark it as deleted in user edits
        let editRecord = window.userEdits.find(e => String(e.feature.properties._id) === String(featureId));
        if (!editRecord) {
            editRecord = { targetLayer: layerName, feature: { properties: { _id: featureId } }, isNew: false };
            window.userEdits.push(editRecord);
        }
        editRecord.isDeleted = true;
    }
    
    await syncToBackendAndReload();
    
    // Safely hide the edit modal if it happens to be open, instead of toggling it open!
    document.getElementById('modal-edit-facility').classList.add('hidden');
};

window.saveFacility = async function() {
    const id = document.getElementById('edit-id').value;
    const targetLayer = document.getElementById('edit-layer').value;
    
    const nama = document.getElementById('edit-nama').value;
    const jenis = document.getElementById('edit-jenis').value;
    const kecamatan = document.getElementById('edit-kecamatan').value;
    const status = document.getElementById('edit-status').value;
    const lat = parseFloat(document.getElementById('edit-lat').value);
    const lng = parseFloat(document.getElementById('edit-lng').value);

    let editRecord = id ? window.userEdits.find(e => e.feature.properties._id === id) : null;
    
    if (!editRecord) {
        editRecord = {
            targetLayer: targetLayer,
            isNew: !id,
            isDeleted: false,
            feature: {
                type: "Feature",
                geometry: { type: "Point", coordinates: [] },
                properties: { _id: id || Math.random().toString(36).substr(2, 9) }
            }
        };
        window.userEdits.push(editRecord);
    }
    
    editRecord.targetLayer = targetLayer;
    editRecord.feature.properties.nama = nama;
    editRecord.feature.properties.jenis = jenis;
    editRecord.feature.properties.kecamatan = kecamatan;
    editRecord.feature.properties.status = status;
    editRecord.feature.properties.needsVerification = true;
    editRecord.feature.geometry.coordinates = [lng, lat];
    
    await syncToBackendAndReload();
    toggleModal('modal-edit-facility');
};

window.resetAllEdits = async function() {
    if(!confirm('Hapus semua usulan perubahan dan kembalikan data ke kondisi asli?')) return;
    localStorage.removeItem('ecomap_user_edits'); try { await fetch('http://localhost:3000/api/save-edits', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({edits: []}) }); } catch(e){}
    // Also clean up old layer data if they exist
    window.facilityConfig.forEach(c => localStorage.removeItem('ecomap_layer_' + c.name));
    location.reload();
};

    // Download feature removed

window.isAddingFacility = false;
window.pickLocationOnMap = function() {
    toggleModal('modal-edit-facility');
    document.getElementById('instruction-overlay').classList.remove('hidden');
    window.map.getContainer().style.cursor = 'crosshair';
    window.isAddingFacility = true;
};

window.cancelPickLocation = function() {
    document.getElementById('instruction-overlay').classList.add('hidden');
    window.map.getContainer().style.cursor = '';
    window.isAddingFacility = false;
    toggleModal('modal-edit-facility');
};

// --- Render User Edits Overlay ---
window.loadUserEdits = function() {
    window.userEdits.forEach(edit => {
        if (edit.isDeleted) {
            // Find base marker in clusters and remove it or style it?
            // Actually, for simplicity, we just leave it or don't do complex deletion rendering yet.
            // But we can remove it from window.facilitiesLayerGroup!
            window.facilitiesLayerGroup.eachLayer(layer => {
                if (layer.feature && layer.feature.properties._id === edit.feature.properties._id) {
                    window.facilitiesLayerGroup.removeLayer(layer);
                }
            });
            return;
        }

        const config = window.facilityConfig.find(c => c.name === edit.targetLayer);
        if (!config) return;

        // Ensure visible if toggle is on
        const isLayerVisible = document.getElementById('chk-' + config.name.replace(/\s+/g, '-'))?.checked;
        
        const p = edit.feature.properties;
        let displayNama = p.nama || "";
        let jenis = p.jenis || "";
        if (config.name === 'Fasilitas Lain (Sektor Informal)') {
            if (jenis && displayNama) {
                if (!(displayNama || "").toLowerCase().startsWith((jenis || "").toLowerCase())) displayNama = jenis + " " + displayNama;
            } else displayNama = displayNama || jenis || config.name;
        } else displayNama = displayNama || config.name;

        // Custom icon with VERIFICATION BADGE and pulse
        const iconHtml = `<span style="position:relative; background-color: ${config.color}; width:24px; height:24px; display:flex; align-items:center; justify-content:center; color:white; font-size:10px; border-radius:50%; border:2px solid white; box-shadow:0 0 10px rgba(234, 179, 8, 0.8);">
            <i class="fa-solid ${config.icon}"></i>
            <span class="absolute -top-1 -right-1 flex h-3 w-3">
              <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75"></span>
              <span class="relative inline-flex rounded-full h-3 w-3 bg-yellow-500 border border-white"></span>
            </span>
        </span>`;
        
        const icon = L.divIcon({ className: 'custom-div-icon user-edit-icon', html: iconHtml, iconSize: [24, 24], iconAnchor: [12, 12] });
        
        // HIGHER zIndexOffset to overlap base data!
        const marker = L.marker([edit.feature.geometry.coordinates[1], edit.feature.geometry.coordinates[0]], { 
            icon: icon, 
            zIndexOffset: 2000 
        });

        marker.bindTooltip(displayNama, { permanent: true, direction: 'center', className: 'facility-label', offset: [0, 0] });
        marker.feature = edit.feature;

        const statusHtml = p.status === 'Tidak Beroperasi' ? '<span class="text-red-600 font-bold">Tidak Beroperasi</span>' : '<span class="text-emerald-600 font-bold">Beroperasi</span>';
        const verifyBadge = '<div class="mt-2 bg-yellow-100 border border-yellow-400 text-yellow-800 text-xs px-2 py-1 rounded shadow-sm font-semibold flex items-center justify-center"><i class="fa-solid fa-clock-rotate-left mr-1"></i> Membutuhkan Verifikasi</div>';

        marker.bindPopup(`
            <div class="p-1 min-w-[240px]">
                <h3 class="font-bold text-emerald-800 text-sm border-b pb-1 mb-2">${displayNama}</h3>
                <table class="w-full text-xs text-gray-700">
                    <tr>
                        <td class="text-gray-500 py-0.5 pr-2 w-20 align-top">Jenis</td>
                        <td class="text-gray-500 py-0.5 pr-1 align-top w-2">:</td>
                        <td class="align-top"></td>
                    </tr>
                    <tr>
                        <td class="text-gray-500 py-0.5 pr-2 align-top">Kecamatan</td>
                        <td class="text-gray-500 py-0.5 pr-1 align-top">:</td>
                        <td class="align-top capitalize"></td>
                    </tr>
                    <tr>
                        <td class="text-gray-500 py-0.5 pr-2 align-top">Status</td>
                        <td class="text-gray-500 py-0.5 pr-1 align-top">:</td>
                        <td class="align-top"></td>
                    </tr>
                </table>
                ${verifyBadge}
                <div class="mt-3 flex justify-between gap-2">
                    <button onclick="openEditModal('${config.name}', '${p._id}')" class="flex-1 bg-emerald-600 text-white py-1 px-2 rounded text-xs hover:bg-emerald-700 transition font-medium"><i class="fa-solid fa-pen-to-square mr-1"></i> Edit</button>
                    <button onclick="deleteFacility('${config.name}', '${p._id}')" class="flex-1 bg-red-600 text-white py-1 px-2 rounded text-xs hover:bg-red-700 transition font-medium"><i class="fa-solid fa-trash mr-1"></i> Hapus</button>
                </div>
            </div>
        `);

        // If the edit is a modification of a base point, remove the old base point so they don't double-cluster or double-label!
        // But the prompt says: "Simbol fasilitas yang diubah user, tampilkan diatas (overlap) simbol data dasar."
        // So we SHOULD NOT remove the base point! We just add this on top!
        // But if they are exactly on the same coordinate, MarkerCluster might spiral them.
        // Let's add it to the same layer group so they cluster together.
        
        if (isLayerVisible) {
            marker.addTo(window.facilitiesLayerGroup);
        }
        
        // Save reference to marker in the edit record so we can toggle it later
        edit._marker = marker;
    });
};

// Intercept toggleFacility in api.js to also toggle user edits
const originalToggleFacility = window.toggleFacility;
window.toggleFacility = function(name, isVisible) {
    if (originalToggleFacility) originalToggleFacility(name, isVisible);
    
    window.userEdits.forEach(edit => {
        if (edit.targetLayer === name && edit._marker && !edit.isDeleted) {
            if (isVisible) {
                edit._marker.addTo(window.facilitiesLayerGroup);
            } else {
                window.facilitiesLayerGroup.removeLayer(edit._marker);
            }
        }
    });
};
async function syncToBackendAndReload() {
    window.userEdits.forEach(e => {
        if (e._marker) {
            window.facilitiesLayerGroup.removeLayer(e._marker);
            e._marker = null;
        }
    });

    window.facilitiesLayerGroup.eachLayer(layer => {
        if (layer.feature && layer.feature.properties && layer.feature.properties._id) {
            const isDeleted = window.userEdits.some(e => e.isDeleted && e.feature.properties._id === layer.feature.properties._id);
            if (isDeleted) {
                window.facilitiesLayerGroup.removeLayer(layer);
            }
        }
    });

    loadUserEdits();

    const dataToSave = window.userEdits.map(e => { const { _marker, ...rest } = e; return rest; });
    localStorage.setItem('ecomap_user_edits', JSON.stringify(dataToSave));
    
    fetch('http://localhost:3000/api/save-edits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edits: dataToSave })
    }).catch(e => console.log('Backend offline, changes saved locally'));
}

window.showUserEditsTable = function() {
    const tbody = document.getElementById('user-edits-tbody');
    tbody.innerHTML = '';
    
    const addedEdits = window.userEdits.filter(e => e.isNew && !e.isDeleted);
    
    // Reset bulk UI
    const chkAll = document.getElementById('chk-all-edits');
    if (chkAll) chkAll.checked = false;
    const btnDelSel = document.getElementById('btn-delete-selected');
    if (btnDelSel) btnDelSel.classList.add('hidden');
    const selCount = document.getElementById('selected-count');
    if (selCount) selCount.innerText = '0';

    
    if (addedEdits.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-4 text-center text-gray-500">Belum ada data yang ditambahkan.</td></tr>';
    } else {
        addedEdits.forEach(edit => {
            const p = edit.feature.properties;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="px-4 py-2 text-center"><input type="checkbox" class="chk-edit-row rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer h-4 w-4" value="${p._id}" onchange="window.updateSelectedCount()"></td>
                <td class="px-4 py-2 font-medium">${p.nama || '-'}</td>
                <td class="px-4 py-2">${edit.targetLayer}</td>
                <td class="px-4 py-2">${p.jenis || '-'}</td>
                <td class="px-4 py-2 text-center">
                    <div class="flex justify-center space-x-2">
                        <button onclick="toggleModal('modal-user-edits'); openEditModal('${edit.targetLayer}', '${p._id}')" class="text-blue-600 hover:text-blue-800" title="Edit"><i class="fa-solid fa-pen"></i></button>
                        <button onclick="deleteFacility('${edit.targetLayer}', '${p._id}'); window.showUserEditsTable();" class="text-red-600 hover:text-red-800" title="Hapus"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }
    
    toggleModal('modal-user-edits');
};

window.toggleAllEdits = function(isChecked) {
    const checkboxes = document.querySelectorAll('.chk-edit-row');
    checkboxes.forEach(chk => {
        chk.checked = isChecked;
    });
    window.updateSelectedCount();
};

window.updateSelectedCount = function() {
    const checkboxes = document.querySelectorAll('.chk-edit-row:checked');
    const count = checkboxes.length;
    const btnDelSel = document.getElementById('btn-delete-selected');
    const selCount = document.getElementById('selected-count');
    
    if (selCount) selCount.innerText = count;
    
    if (count > 0) {
        btnDelSel.classList.remove('hidden');
    } else {
        btnDelSel.classList.add('hidden');
    }
    
    // Update master checkbox state
    const allCheckboxes = document.querySelectorAll('.chk-edit-row');
    const chkAll = document.getElementById('chk-all-edits');
    if (chkAll && allCheckboxes.length > 0) {
        chkAll.checked = (count === allCheckboxes.length);
    }
};

window.deleteSelectedFacilities = async function() {
    const checkboxes = document.querySelectorAll('.chk-edit-row:checked');
    if (checkboxes.length === 0) return;
    
    if(!confirm(`Apakah Anda yakin ingin menghapus ${checkboxes.length} fasilitas yang dipilih?`)) return;
    
    // Process each checked ID
    checkboxes.forEach(chk => {
        const featureId = chk.value;
        const editIndex = window.userEdits.findIndex(e => String(e.feature.properties._id) === String(featureId));
        
        if (editIndex > -1 && window.userEdits[editIndex].isNew) {
            const deletedEdit = window.userEdits[editIndex];
            if (deletedEdit._marker && window.facilitiesLayerGroup) {
                window.facilitiesLayerGroup.removeLayer(deletedEdit._marker);
            }
            window.userEdits.splice(editIndex, 1);
        }
    });
    
    await syncToBackendAndReload();
    window.showUserEditsTable(); // Refresh table
};
