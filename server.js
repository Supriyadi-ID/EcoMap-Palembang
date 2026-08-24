require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '')));

// Vercel serverless environment menggunakan filesystem read-only, kecuali folder /tmp
const dataNewDir = process.env.VERCEL ? path.join('/tmp', 'APP', 'DATA_NEW') : path.join(__dirname, 'APP', 'DATA_NEW');
if (!fs.existsSync(dataNewDir)) {
    fs.mkdirSync(dataNewDir, { recursive: true });
}

// ─── Endpoint Konfigurasi Publik ─────────────────────────────────────────────
// Mengirimkan API key dari environment variable ke frontend secara aman.
// Key tidak pernah di-hard-code di source code frontend maupun backend.
app.get('/api/config', (req, res) => {
    const mapidKey = process.env.MAPID_API_KEY;
    const orsKey   = process.env.ORS_API_KEY;

    if (!mapidKey || !orsKey) {
        console.warn('[/api/config] Satu atau lebih API key tidak ditemukan di environment variable.');
    }

    res.json({
        mapidKey: mapidKey || '',
        orsKey:   orsKey   || ''
    });
});

// ─── Endpoint Simpan Edits ───────────────────────────────────────────────────
app.post('/api/save-edits', (req, res) => {
    try {
        const userEdits = req.body.edits || [];
        const filePath = path.join(dataNewDir, 'usulan_fasilitas_palembang.geojson');
        
        // Remove _marker before converting
        const cleanedEdits = userEdits.map(e => {
            const { _marker, ...rest } = e;
            return rest;
        });

        const geojson = {
            type: "FeatureCollection",
            features: cleanedEdits.map(e => {
                const f = JSON.parse(JSON.stringify(e.feature));
                f.properties._targetLayer = e.targetLayer;
                f.properties._isNew = e.isNew;
                f.properties._isDeleted = e.isDeleted;
                return f;
            })
        };

        fs.writeFileSync(filePath, JSON.stringify(geojson, null, 2));
        res.json({ success: true, message: 'Berhasil disimpan ke APP/DATA_NEW/usulan_fasilitas_palembang.geojson' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Gagal menyimpan file' });
    }
});

// Export app untuk Vercel Serverless Function
module.exports = app;

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server berjalan di http://localhost:${PORT}`);
        console.log(`Buka browser pada: http://localhost:${PORT}`);
    });
}
