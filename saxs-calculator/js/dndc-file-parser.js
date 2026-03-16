/**
 * TPS13A SAXS Calculator - dn/dc File Parser Module
 * CSV/TSV parsing and column detection for dn/dc calculator
 */

// Delimiter candidates for auto-detection
const DELIMITER_CANDIDATES = [',', '\t', ';'];

// Header patterns for auto-detection (case-insensitive)
const TIME_PATTERNS = ['time', 'min', 'minutes', 'time (min)', 'retention time', 'elution time', 'rt'];
const UV_PATTERNS = ['uv', 'uv280', 'abs', 'absorbance', 'a280', 'uv signal', 'uv (au)'];
const RI_PATTERNS = ['dri', 'ri', 'refractive', 'dri (riu)', 'ri signal', 'ri (riu)', 'refractive index'];

/**
 * Detect the most likely delimiter in the text by counting occurrences
 * in non-comment, non-empty lines.
 * @param {string} text - Raw file text
 * @returns {string} The detected delimiter character
 */
function detectDelimiter(text) {
    const lines = text.split(/\r?\n/).filter(
        line => line.trim() !== '' && !line.trim().startsWith('#')
    );

    const sampleLines = lines.slice(0, Math.min(10, lines.length));

    let bestDelimiter = ',';
    let bestScore = -1;

    for (const delimiter of DELIMITER_CANDIDATES) {
        const counts = sampleLines.map(line => countDelimiterInLine(line, delimiter));
        // A good delimiter appears consistently across lines
        const minCount = Math.min(...counts);
        const maxCount = Math.max(...counts);
        const isConsistent = maxCount > 0 && (maxCount - minCount) <= 1;
        const score = isConsistent ? minCount : 0;

        if (score > bestScore) {
            bestScore = score;
            bestDelimiter = delimiter;
        }
    }

    return bestDelimiter;
}

/**
 * Count delimiter occurrences in a single line, respecting quoted fields.
 * @param {string} line - A single line of text
 * @param {string} delimiter - The delimiter character to count
 * @returns {number} Number of delimiters found outside quotes
 */
function countDelimiterInLine(line, delimiter) {
    let count = 0;
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            inQuotes = !inQuotes;
        } else if (ch === delimiter && !inQuotes) {
            count++;
        }
    }

    return count;
}

/**
 * Split a single line by delimiter, respecting quoted fields.
 * Strips surrounding quotes from fields.
 * @param {string} line - A single line of text
 * @param {string} delimiter - The delimiter character
 * @returns {string[]} Array of field values
 */
function splitLine(line, delimiter) {
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];

        if (ch === '"') {
            if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                // Escaped quote inside quoted field
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === delimiter && !inQuotes) {
            fields.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }

    fields.push(current.trim());
    return fields;
}

/**
 * Parse CSV/TSV text into structured data.
 * @param {string} text - Raw CSV/TSV text content
 * @param {string} [delimiter] - Delimiter character. Auto-detected if omitted.
 * @returns {{ headers: string[], data: number[][] }} Parsed headers and numeric data rows
 */
function parseCSV(text, delimiter) {
    if (!text || typeof text !== 'string') {
        return { headers: [], data: [] };
    }

    const resolvedDelimiter = delimiter || detectDelimiter(text);

    const lines = text.split(/\r?\n/).filter(
        line => line.trim() !== '' && !line.trim().startsWith('#')
    );

    if (lines.length === 0) {
        return { headers: [], data: [] };
    }

    // First non-comment line is treated as headers
    const headers = splitLine(lines[0], resolvedDelimiter);

    // Remaining lines are data rows
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const fields = splitLine(lines[i], resolvedDelimiter);
        const row = fields.map(field => {
            const trimmed = field.trim();
            if (trimmed === '') {
                return NaN;
            }
            const num = Number(trimmed);
            return num;
        });
        data.push(row);
    }

    return { headers, data };
}

/**
 * Match a header string against a list of patterns (case-insensitive).
 * Returns true if the header matches any pattern exactly or contains it.
 * @param {string} header - The header string to test
 * @param {string[]} patterns - Array of pattern strings (lowercase)
 * @returns {boolean} Whether the header matches
 */
function matchesPattern(header, patterns) {
    const lower = header.toLowerCase().trim();
    return patterns.some(
        pattern => lower === pattern || lower.includes(pattern)
    );
}

/**
 * Auto-detect which columns correspond to time, UV, and RI signals
 * based on header names.
 * @param {string[]} headers - Array of column header strings
 * @returns {{ timeCol: number, uvCol: number, riCol: number }} Column indices (-1 if not found)
 */
function autoDetectColumns(headers) {
    let timeCol = -1;
    let uvCol = -1;
    let riCol = -1;

    for (let i = 0; i < headers.length; i++) {
        const header = headers[i];

        if (timeCol === -1 && matchesPattern(header, TIME_PATTERNS)) {
            timeCol = i;
        } else if (uvCol === -1 && matchesPattern(header, UV_PATTERNS)) {
            uvCol = i;
        } else if (riCol === -1 && matchesPattern(header, RI_PATTERNS)) {
            riCol = i;
        }
    }

    return { timeCol, uvCol, riCol };
}

/**
 * Read a File object and return its text content as a Promise.
 * @param {File} file - A File object from an <input type="file"> element
 * @returns {Promise<string>} Resolves with the file text content
 */
function readFile(file) {
    return new Promise((resolve, reject) => {
        if (!file) {
            reject(new Error('No file provided'));
            return;
        }

        const reader = new FileReader();

        reader.onload = function onLoad(event) {
            resolve(event.target.result);
        };

        reader.onerror = function onError() {
            reject(new Error('Failed to read file: ' + (reader.error?.message || 'unknown error')));
        };

        reader.readAsText(file);
    });
}

/**
 * Parse FASTA format text into header and sequence.
 * Handles multi-line sequences and the > header line.
 * @param {string} text - Raw FASTA text
 * @returns {{ header: string, sequence: string }} Parsed header and concatenated sequence
 */
function parseFASTA(text) {
    if (!text || typeof text !== 'string') {
        return { header: '', sequence: '' };
    }

    const lines = text.split(/\r?\n/);

    let header = '';
    const sequenceParts = [];

    for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed === '') {
            continue;
        }

        if (trimmed.startsWith('>')) {
            // Only capture the first header; if we already have sequence data,
            // this would be a second entry — stop here.
            if (header !== '' && sequenceParts.length > 0) {
                break;
            }
            header = trimmed.substring(1).trim();
        } else {
            // Sequence line: strip whitespace and digits (position numbers)
            sequenceParts.push(trimmed.replace(/[\s\d]/g, ''));
        }
    }

    return {
        header,
        sequence: sequenceParts.join('').toUpperCase()
    };
}

/**
 * Extract a single column from parsed data as a number array.
 * @param {{ headers: string[], data: number[][] }} parsedData - Output from parseCSV
 * @param {number} colIndex - Zero-based column index to extract
 * @returns {number[]} Array of numeric values for the column
 */
function getColumnData(parsedData, colIndex) {
    if (!parsedData || !Array.isArray(parsedData.data) || colIndex < 0) {
        return [];
    }

    return parsedData.data.map(row => {
        if (colIndex < row.length) {
            return row[colIndex];
        }
        return NaN;
    });
}

// Export on window.DndcFileParser
window.DndcFileParser = Object.freeze({
    parseCSV,
    autoDetectColumns,
    readFile,
    parseFASTA,
    getColumnData
});
