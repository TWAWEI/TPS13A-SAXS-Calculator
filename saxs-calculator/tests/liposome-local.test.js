'use strict';
/**
 * 用本地 Excel 匯出的真實 SAXS 曲線驗證稀釋因子（規格 §9.2）。
 *
 * fixture 在 tests/fixtures-local/liposome/（.gitignore 擋住，論文資料不進公開 repo）。
 * 不存在就 skip，公開 CI 仍然綠。
 *
 * Excel dilution 頁（逐列硬配對）得 0.4386；本模組內插法 2026-09-05 預算得 0.4394（+0.19%）。
 * PRIMUS 截圖的 0.454 用這兩條曲線重現不了（各種視窗／權重都在 0.436–0.442），不斷言 lsqScale。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Liposome, LiposomeParsers } = require('./load.js');

const DIR = path.join(__dirname, 'fixtures-local', 'liposome');
const SOLUTION = path.join(DIR, 'solution.dat');
const BYPASS = path.join(DIR, 'bypass.dat');
const available = fs.existsSync(SOLUTION) && fs.existsSync(BYPASS);

test('[lipo-local] Excel dilution 頁兩條曲線：內插法平均在 0.4386 ± 1%', { skip: !available && '本地 fixture 不存在' }, () => {
    const solution = LiposomeParsers.parseSaxsDat(fs.readFileSync(SOLUTION, 'utf8'));
    const bypass = LiposomeParsers.parseSaxsDat(fs.readFileSync(BYPASS, 'utf8'));
    assert.equal(bypass.sorted, true, 'bypass 檔開頭有一列亂序的 q = 0，解析器要排序');
    assert.equal(solution.q.length, 373);
    assert.equal(bypass.q.length, 815);

    const r = Liposome.computeDilutionFactor(solution, bypass);
    assert.equal(r.n, 40, 'q 0.1–0.15 內 40 點，與 Excel FILTER 一致');
    assert.ok(Math.abs(r.factor / 0.4386 - 1) < 0.01, `factor ${r.factor} 偏離 0.4386 超過 1%`);
    assert.ok(r.sd / r.factor < 0.05, `相對離散 ${r.sd / r.factor} 應約 3%`);
});
