function setupEvents() {
    // We already use onclick directly in HTML for btn-analyze and btn-clear
    // So we just need to handle the dropdown if needed, but it's handled in runFacilityNeedAnalysis
}

function clearAnalysis() {
    window.recommendedFacilitiesGroup.clearLayers();
    window.isochroneCoverageGroup.clearLayers();
    window.unservedAreaGroup.clearLayers();
    // Bersihkan juga routing jika ada
    if (typeof clearRoutingLayers === 'function') clearRoutingLayers();
    
    document.getElementById('summary-panel').classList.add('hidden');
    document.getElementById('btn-clear').classList.add('hidden');
    window.latestFacilityNeeds = null;
}

function showFacilityNeedSummary(s) {
    const content = document.getElementById('summary-content');
    
    let selectedOptionText = document.getElementById('analysis-facility-select').options[document.getElementById('analysis-facility-select').selectedIndex].text;
    
    let totalRecommended = 0;
    if (s.recommended.bankSampah > 0) totalRecommended += s.recommended.bankSampah;
    if (s.recommended.tps3r > 0) totalRecommended += s.recommended.tps3r;
    if (s.recommended.rumahKompos > 0) totalRecommended += s.recommended.rumahKompos;
    if (s.recommended.komposting > 0) totalRecommended += s.recommended.komposting;

    let coveredPct = (100 - s.unservedPct).toFixed(1);
    let unservedPct = s.unservedPct.toFixed(1);

    content.innerHTML = `
        <div class="flex justify-between items-center mb-1">
            <span class="text-xs text-gray-600">Area :</span>
            <span class="text-xs font-bold text-gray-800 capitalize" id="ui-kecamatan">${s.name.toLowerCase()}</span>
        </div>
        <div class="flex justify-between items-center mb-1">
            <span class="text-xs text-gray-600">Populasi (2025) :</span>
            <span class="text-xs font-bold text-gray-800" id="ui-population">${s.pop.toLocaleString('id-ID')} jiwa</span>
        </div>
        <div class="flex justify-between items-center mb-4">
            <span class="text-xs text-gray-600">Fasilitas Eksisting :</span>
            <span class="text-xs font-bold text-gray-800" id="ui-existing-count">${s.existingCount} titik ${selectedOptionText.split(' (')[0]}</span>
        </div>

        <div class="mb-4 pt-4 border-t border-gray-200">
            <h5 class="text-xs font-bold text-green-700 mb-2 uppercase">REKOMENDASI TAMBAHAN FASILITAS</h5>
            <div class="flex justify-between items-center mb-1">
                <span class="text-xs text-gray-600" id="ui-recom-type">${selectedOptionText.split(' (')[0]} :</span>
                <span class="text-xs font-bold text-gray-800" id="ui-new-locations-count">${totalRecommended} unit</span>
            </div>
        </div>

        <div class="mb-4 pt-4 border-t border-gray-200">
            <div class="flex justify-between items-center mb-1">
                <span class="text-xs text-gray-600">Area Pemukiman Tercover :</span>
                <span class="text-xs font-bold text-green-600" id="ui-covered-pct">${coveredPct}%</span>
            </div>
            <div class="flex justify-between items-center">
                <span class="text-xs text-gray-600">Area Pemukiman Belum Tercover :</span>
                <span class="text-xs font-bold text-red-600" id="ui-unserved-pct">${unservedPct}%</span>
            </div>
        </div>
    `;
    
    document.getElementById('summary-panel').classList.remove('hidden');
    document.getElementById('btn-clear').classList.remove('hidden');
}
