/**
 * TPS13A SAXS Calculator - ASTRA .afe7 Parser
 * 解析 Wyatt ASTRA .afe7 檔案（gzip 壓縮的 SQLite 資料庫）
 *
 * 依賴：pako.js (gzip/zlib), sql.js (SQLite WASM)
 * 兩者皆為 lazy load，僅在使用者上傳 .afe7 時才載入。
 */

const BLOB_HEADER_SEARCH_LIMIT = 32;
const ZLIB_MARKERS = [[0x78, 0x9c], [0x78, 0x01], [0x78, 0xda]];

// 欄名來自檔案本身的 PRAGMA table_info，惡意 .afe7 可以把 SQL 片段當欄名帶進來。
// 與 Python 版 astra_parser.py 的 _SAFE_IDENTIFIER 對齊。
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

// 解壓上限（與 Python 版 astra_parser.py 的常數保持一致）：
//   MAX_DB_BYTES  — gzip 解開後的 SQLite 檔案
//   MAX_BLOB_BYTES — 單一 zlib 通道 blob
// 沒有上限時，一個幾 MB 的 .afe7 可以解出數 GB 資料把分頁記憶體吃光（zip bomb）。
const MAX_DB_BYTES = 256 * 1024 * 1024;
const MAX_BLOB_BYTES = 64 * 1024 * 1024;

let _SQL = null;
// 同時拖入多個 .afe7 時，每個檔案都會呼叫 _ensureLibraries()。用布林旗標的話
// 第一次載入還沒完成、旗標還是 false，於是重複注入 <script> 並重複 initSqlJs()。
// 快取 Promise 讓併發呼叫共用同一次載入；失敗時清掉，下次可以重試。
let _libsPromise = null;

/**
 * Lazy load sql.js 和 pako（併發安全）。
 *
 * @returns {Promise<void>} 兩個函式庫都就緒後 resolve
 */
function _ensureLibraries() {
    if (!_libsPromise) {
        _libsPromise = _loadLibraries().catch(err => {
            _libsPromise = null;
            throw err;
        });
    }
    return _libsPromise;
}

/**
 * 實際載入 pako 與 sql.js。只應由 _ensureLibraries() 呼叫。
 *
 * @returns {Promise<void>}
 */
async function _loadLibraries() {
    // Load pako if not present
    if (typeof pako === 'undefined') {
        await _loadScript(
            'https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js',
            'sha384-rNlaE5fs9dGIjmxWDALQh/RBAaGRYT5ChrzHo6tRfgrZ36iRFAiquP5g41Jsv+0j'
        );
    }

    // Load sql.js if not present
    if (typeof initSqlJs === 'undefined') {
        await _loadScript(
            'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-wasm.js',
            'sha384-8D3Rsfo535FqoC1pHCCQMrNf75UgzyoG/HQm9zOzITRrz3QKzecc2E7JXKGCXoWu'
        );
    }

    // sql-wasm.wasm 由 sql.js 內部用 fetch + WebAssembly.instantiate 取得，
    // 不是 <script>／<link>，沒有 integrity 屬性可掛 → 無法加 SRI（review #106）。
    // 能做的防護是把版本鎖死（1.10.3，與上面的 sql-wasm.js 同版）並限制
    // CSP 的 connect-src 只允許 cdn.jsdelivr.net。
    _SQL = await initSqlJs({
        locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/${file}`
    });
}

function _loadScript(src, integrity) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        if (integrity) {
            script.integrity = integrity;
            script.crossOrigin = 'anonymous';
        }
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });
}

/**
 * 解碼 ASTRA blob：16-byte header 區域內找 zlib 標記，解壓為 float64 陣列
 * @param {Uint8Array} blob
 * @returns {Float64Array}
 */
function _decodeBlob(blob) {
    if (!blob || blob.length < 18) {
        throw new Error('Blob 太短或為空');
    }

    const searchRegion = blob.slice(0, BLOB_HEADER_SEARCH_LIMIT);
    let zlibPos = -1;

    for (const marker of ZLIB_MARKERS) {
        for (let i = 0; i <= searchRegion.length - 2; i++) {
            if (searchRegion[i] === marker[0] && searchRegion[i + 1] === marker[1]) {
                zlibPos = i;
                break;
            }
        }
        if (zlibPos >= 0) break;
    }

    if (zlibPos < 0) {
        throw new Error('找不到 zlib 壓縮標記');
    }

    const compressed = blob.slice(zlibPos);
    const raw = pako.inflate(compressed);

    // zlib 沒有可信的原始大小欄位，只能解完再檢查
    if (raw.length > MAX_BLOB_BYTES) {
        throw new Error(
            `解壓後資料超過上限（${raw.length} bytes > ${MAX_BLOB_BYTES} bytes），` +
            '此通道疑似損毀或惡意壓縮');
    }

    if (raw.length % 8 !== 0) {
        throw new Error(`解壓後大小 ${raw.length} 不是 float64 (8 bytes) 的倍數`);
    }

    return new Float64Array(raw.buffer, raw.byteOffset, raw.length / 8);
}

function _safeDecodeBlob(blob) {
    if (!blob) return null;
    try {
        return _decodeBlob(new Uint8Array(blob));
    } catch (e) {
        return null;
    }
}

/**
 * 查詢輔助函數
 */
function _tableExists(db, tableName) {
    const result = db.exec(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", [tableName]
    );
    return result.length > 0 && result[0].values.length > 0;
}

/**
 * 依 SQLite 識別字規則加雙引號（內部的 " 要重複成 ""）。
 * 呼叫端必須先用 SAFE_IDENTIFIER 驗過；這裡是第二道防線。
 *
 * @param {string} name - 欄位／資料表名稱
 * @returns {string} 已引用的識別字
 */
function _quoteIdent(name) {
    return `"${String(name).replace(/"/g, '""')}"`;
}

function _queryOne(db, sql, params) {
    const result = db.exec(sql, params);
    if (result.length === 0 || result[0].values.length === 0) return null;
    const columns = result[0].columns;
    const values = result[0].values[0];
    const row = {};
    columns.forEach((col, i) => { row[col] = values[i]; });
    return row;
}

function _queryAll(db, sql, params) {
    const result = db.exec(sql, params);
    if (result.length === 0) return [];
    const columns = result[0].columns;
    return result[0].values.map(values => {
        const row = {};
        columns.forEach((col, i) => { row[col] = values[i]; });
        return row;
    });
}

/**
 * 讀取樣品資訊
 */
function _readSampleInfo(db) {
    const defaults = { name: 'Unknown', dnDc: null, concentrationGml: 0, uvExtinction: null, refTempC: 25 };
    if (!_tableExists(db, 'WInjectedSampleProfile')) return defaults;

    const row = _queryOne(db,
        'SELECT m_sName, m_dDNDC, m_dConcentration, m_dUVExtinctionCoefficient, m_dReferenceTemperature FROM WInjectedSampleProfile LIMIT 1'
    );
    if (!row) return defaults;

    return {
        name: row.m_sName || 'Unknown',
        dnDc: (row.m_dDNDC && row.m_dDNDC !== 0) ? row.m_dDNDC : null,
        concentrationGml: row.m_dConcentration || 0,
        uvExtinction: (row.m_dUVExtinctionCoefficient && row.m_dUVExtinctionCoefficient !== 0) ? row.m_dUVExtinctionCoefficient : null,
        refTempC: row.m_dReferenceTemperature || 25
    };
}

/**
 * 讀取 RI 偵測器資訊（含 K_cal）
 */
function _readRiDetector(db) {
    if (!_tableExists(db, 'WNGOInstrumentProfile')) return null;

    const row = _queryOne(db,
        'SELECT m_sName, m_dWavelength, m_dCalibrationConstant, m_dTemperature FROM WNGOInstrumentProfile LIMIT 1'
    );
    if (!row) return null;

    return {
        name: row.m_sName || 'Unknown',
        wavelengthNm: row.m_dWavelength || 0,
        calibrationConstant: (row.m_dCalibrationConstant && row.m_dCalibrationConstant !== 0) ? row.m_dCalibrationConstant : null,
        temperatureC: row.m_dTemperature
    };
}

/**
 * 讀取實驗參數
 */
function _readExperimentInfo(db) {
    let injectionNumber = 0;
    let collectionTime = null;
    let flowRate = 0.5;

    if (_tableExists(db, 'WExperimentData')) {
        const row = _queryOne(db, 'SELECT m_nInjectionNumber, m_CollectionTime FROM WExperimentData LIMIT 1');
        if (row) {
            injectionNumber = row.m_nInjectionNumber || 0;
            collectionTime = row.m_CollectionTime;
        }
    }

    if (_tableExists(db, 'WGenericPumpProfile')) {
        const row = _queryOne(db, 'SELECT m_dFlowRate FROM WGenericPumpProfile LIMIT 1');
        if (row && row.m_dFlowRate) {
            flowRate = row.m_dFlowRate;
        }
    }

    return { injectionNumber, collectionTime, flowRateMlMin: flowRate };
}

/**
 * ASTRA 專案裡有沒有設定 Generic UV 儀器。
 *
 * 「有設定儀器」與「有 UV 時間序列」是兩件事：使用者的 BSA 檔兩者分家
 * （設定在、資料不在），只看其中一個會給出誤導的訊息。
 *
 * @param {object} db - sql.js Database
 * @returns {boolean} 有設定為 true
 */
function _readUvConfigured(db) {
    if (!_tableExists(db, 'WGenericUVInstrumentProfile')) return false;
    try {
        // 資料表名稱是程式內的字面常數，不是來自檔案內容
        const row = _queryOne(db, 'SELECT count(*) AS n FROM WGenericUVInstrumentProfile');
        return Boolean(row && Number(row.n) > 0);
    } catch (e) {
        // UV 只是附註資訊；資料表壞掉不該讓整個檔案解析失敗（RI 才是主資料）
        console.warn('[ASTRA] 讀取 UV 儀器設定失敗，視為未設定:', e.message);
        return false;
    }
}

/**
 * 通道清單裡有沒有 UV 儀器的時間序列。
 *
 * @param {Array<{instrument: string}>} allChannels - _readAllChannels 的結果
 * @returns {boolean} 有 UV 通道為 true
 */
function _hasUvChannel(allChannels) {
    return (allChannels || []).some(ch => /uv/i.test(String((ch && ch.instrument) || '')));
}

/**
 * 讀取所有可用通道的摘要資訊（不解碼 blob，僅列出）
 */
function _readAllChannels(db) {
    if (!_tableExists(db, 'WVectorData')) return [];

    const rows = _queryAll(db,
        "SELECT objectID, m_nDataName, m_sInstrumentClassName, length(m_vValue) as valLen, length(m_vIndex) as idxLen " +
        "FROM WVectorData WHERE length(m_vValue) > 100 AND length(m_vIndex) > 100"
    );

    const DN_LABELS = {
        12021: 'dRI (raw)',
        12025: 'RI_Aux',
        12489: 'Solvent_RI',
        12190: 'Temperature',
        12305: 'LS_90',
        12018: 'LS_Norm',
        12303: 'LS_Calib',
        12395: 'LS_Dark',
        12191: 'QELS'
    };

    return rows.map(r => ({
        objectID: r.objectID,
        dnCode: r.m_nDataName,
        label: DN_LABELS[r.m_nDataName] || `DN_${r.m_nDataName}`,
        instrument: r.m_sInstrumentClassName || '',
        dataSize: r.valLen
    }));
}

/**
 * 讀取指定 DN code 的通道數據
 */
function _readChannelByDnCode(db, dnCode) {
    if (!_tableExists(db, 'WVectorData')) return null;

    const rows = _queryAll(db,
        "SELECT objectID, m_nDataName, m_sInstrumentClassName, m_vIndex, m_vValue " +
        "FROM WVectorData WHERE m_nDataName = ? AND length(m_vValue) > 100 AND length(m_vIndex) > 100",
        [dnCode]
    );

    if (rows.length === 0) return null;

    const r = rows[0];
    const time = _safeDecodeBlob(r.m_vIndex);
    const values = _safeDecodeBlob(r.m_vValue);
    if (!time || !values) return null;

    const n = Math.min(time.length, values.length);
    return { time: Array.from(time.slice(0, n)), values: Array.from(values.slice(0, n)) };
}

/**
 * 讀取 RI 通道數據
 */
function _readRiChannel(db) {
    if (!_tableExists(db, 'WVectorData')) return null;

    // DN code 12025 = RI_Aux (校正後的 RI 訊號), fallback 12021 = dRI raw
    const rows = _queryAll(db,
        "SELECT objectID, m_nDataName, m_sInstrumentClassName, m_vIndex, m_vValue " +
        "FROM WVectorData WHERE m_nDataName = 12025 AND length(m_vValue) > 100 AND length(m_vIndex) > 100"
    );

    if (rows.length === 0) {
        // Fallback: try dRI raw signal (12021)
        const fallbackRows = _queryAll(db,
            "SELECT objectID, m_nDataName, m_sInstrumentClassName, m_vIndex, m_vValue " +
            "FROM WVectorData WHERE m_nDataName = 12021 AND length(m_vValue) > 100 AND length(m_vIndex) > 100"
        );
        if (fallbackRows.length === 0) return null;
        const r = fallbackRows[0];
        const time = _safeDecodeBlob(r.m_vIndex);
        const values = _safeDecodeBlob(r.m_vValue);
        if (!time || !values) return null;
        const n = Math.min(time.length, values.length);
        return { time: Array.from(time.slice(0, n)), values: Array.from(values.slice(0, n)) };
    }

    const r = rows[0];
    const time = _safeDecodeBlob(r.m_vIndex);
    const values = _safeDecodeBlob(r.m_vValue);
    if (!time || !values) return null;

    const n = Math.min(time.length, values.length);
    return { time: Array.from(time.slice(0, n)), values: Array.from(values.slice(0, n)) };
}

/**
 * 讀取峰範圍
 */
function _readPeaks(db) {
    if (!_tableExists(db, 'WPeakRange')) return [];

    try {
        const pragma = db.exec('PRAGMA table_info(WPeakRange)');
        if (pragma.length === 0) return [];

        const cols = pragma[0].values.map(row => row[1]);
        let startCol = null, endCol = null;

        for (const c of cols) {
            const cl = c.toLowerCase();
            if (cl.includes('start') && cl.includes('volume')) startCol = c;
            else if (cl.includes('end') && cl.includes('volume')) endCol = c;
            else if (cl.includes('start') && !startCol) startCol = c;
            else if (cl.includes('end') && !endCol) endCol = c;
        }

        if (!startCol || !endCol) return [];

        // 欄名不是識別字就整段放棄，不要把它拼進 SQL
        if (!SAFE_IDENTIFIER.test(startCol) || !SAFE_IDENTIFIER.test(endCol)) {
            console.warn('[ASTRA] WPeakRange 欄名不安全，略過峰範圍:', startCol, endCol);
            return [];
        }

        const rows = _queryAll(db,
            `SELECT ${_quoteIdent(startCol)}, ${_quoteIdent(endCol)} FROM WPeakRange`);
        return rows
            .filter(r => r[startCol] != null && r[endCol] != null)
            .map(r => ({ startVolume: r[startCol], endVolume: r[endCol] }));
    } catch (e) {
        return [];
    }
}

/**
 * 讀 gzip 尾端 4 bytes 的 ISIZE（原始大小 mod 2³²，little-endian）。
 *
 * 只是預檢，不能當保證：ISIZE 可以被偽造，>4 GiB 的內容也會 wrap around。
 * 真正的把關是解壓後對 .length 的檢查。
 *
 * @param {Uint8Array} raw - 完整 gzip 位元組
 * @returns {number|null} 宣告的原始大小，位元組不足時為 null
 */
function _readGzipIsize(raw) {
    if (!raw || raw.length < 4) return null;
    const n = raw.length;
    return (raw[n - 4] | (raw[n - 3] << 8) | (raw[n - 2] << 16) | (raw[n - 1] << 24)) >>> 0;
}

/**
 * 解析 .afe7 檔案
 * @param {ArrayBuffer} arrayBuffer - 檔案的 ArrayBuffer
 * @returns {Promise<object>} 解析結果
 */
async function parseAfe7(arrayBuffer) {
    await _ensureLibraries();

    const raw = new Uint8Array(arrayBuffer);

    // 驗證 gzip 格式
    if (raw[0] !== 0x1f || raw[1] !== 0x8b) {
        throw new Error('不是 gzip 格式（缺少 1f 8b 標記）');
    }

    // 預檢：gzip 尾端 4 bytes 是 ISIZE（原始大小 mod 2³²，little-endian）。
    // 可以被偽造，所以解壓後還要再檢查一次；這裡只是為了在配置記憶體「之前」
    // 就擋掉明顯的 zip bomb。
    const declaredSize = _readGzipIsize(raw);
    if (declaredSize !== null && declaredSize > MAX_DB_BYTES) {
        throw new Error(
            `解壓後資料超過上限（宣告 ${declaredSize} bytes > ${MAX_DB_BYTES} bytes），` +
            '請確認這是有效的 ASTRA .afe7 檔案');
    }

    // gzip 解壓
    let dbBytes;
    try {
        dbBytes = pako.ungzip(raw);
    } catch (e) {
        throw new Error(`gzip 解壓失敗: ${e.message}`);
    }

    if (dbBytes.length > MAX_DB_BYTES) {
        throw new Error(
            `解壓後資料超過上限（${dbBytes.length} bytes > ${MAX_DB_BYTES} bytes），` +
            '請確認這是有效的 ASTRA .afe7 檔案');
    }

    // 驗證 SQLite
    const header = new TextDecoder().decode(dbBytes.slice(0, 15));
    if (!header.startsWith('SQLite format 3')) {
        throw new Error('解壓後不是 SQLite 資料庫格式');
    }

    // 開啟 SQLite
    const db = new _SQL.Database(dbBytes);

    try {
        const sample = _readSampleInfo(db);
        const riDetector = _readRiDetector(db);
        const experiment = _readExperimentInfo(db);
        const allChannels = _readAllChannels(db);
        const riChannel = _readRiChannel(db);
        const peaks = _readPeaks(db);

        // 解碼所有通道的實際數據
        const channelData = {};
        for (const ch of allChannels) {
            const data = _readChannelByDnCode(db, ch.dnCode);
            if (data) {
                channelData[ch.dnCode] = { label: ch.label, instrument: ch.instrument, ...data };
            }
        }

        return {
            sample,
            riDetector,
            experiment,
            allChannels,
            channelData,
            riChannel,
            peaks,
            // UV 現況：設定與資料分開回報，UI 才能說清楚「為什麼沒有 UV」
            uvConfigured: _readUvConfigured(db),
            hasUvChannel: _hasUvChannel(allChannels)
        };
    } finally {
        db.close();
    }
}

/**
 * 從 File 物件讀取並解析 .afe7
 * @param {File} file
 * @returns {Promise<object>}
 */
async function parseAfe7File(file) {
    const arrayBuffer = await file.arrayBuffer();
    return parseAfe7(arrayBuffer);
}

window.DndcAstraParser = Object.freeze({
    parseAfe7,
    parseAfe7File,
    // 僅供 tests/ 鎖定安全邏輯，不是公開 API
    _internal: Object.freeze({ SAFE_IDENTIFIER, _quoteIdent, _readGzipIsize, MAX_DB_BYTES, MAX_BLOB_BYTES })
});
