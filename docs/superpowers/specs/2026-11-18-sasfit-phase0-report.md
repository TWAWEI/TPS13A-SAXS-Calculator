# SASfit Phase 0 報告：WebAssembly 可行性關卡

日期：2026-11-18　分支：`feat/sasfit`

## 結論

13 個 sasmodels 1.0.12 C 模型皆成功編譯為獨立 wasm；原始 kernel 重放與 sasmodels 輸出一致（最大相對誤差 1.3e-10，全數通過容差 |Δ| ≤ 1e-9·|ref| + 1e-12·max|ref|）；wasm 速度約為原生 DLL 的 1.4–1.5 倍時間（多參數多分散情境）。工作負載（2 參數多分散 1225 次評估）本身就重，並非 wasm 特別慢。

## 工具鏈

- emsdk / emcc：6.0.13（`manifest.json` 記錄）
- 編譯旗標：`-std=c99 -O2`；連結：`--no-entry -sSTANDALONE_WASM=1 -sALLOW_MEMORY_GROWTH=1`；精度 double
- sasmodels 1.0.12、bumps 1.0.4、Python 3.14

## 各模型 wasm 大小（來自 manifest.json）

| 模型 | bytes |
|---|---|
| core_shell_cylinder | 17612 |
| core_shell_sphere | 14707 |
| cylinder | 17314 |
| ellipsoid | 22109 |
| flexible_cylinder | 27064 |
| gaussian_peak | 10124 |
| guinier | 10268 |
| hardsphere | 14527 |
| hayter_msa | 27304 |
| lamellar | 14008 |
| mono_gauss_coil | 8477 |
| sphere | 14336 |
| vesicle | 14722 |

## Imports / Exports

- import：僅 `env.emscripten_notify_memory_growth`
- export：`memory`、`<model>_Iq`、`_initialize`、`malloc`、`free`

## 一致性（probe.mjs，與 sasmodels 重放比對）

「kernel」＝原始 kernel buffer 重放；「I(q)」＝依 I = scale/⟨V_shell⟩·⟨F²⟩ + background 還原後對 DirectModel（background 為 model 預設 0.001 或 case 的 pars 值，於 kernel 外加）。全部 PASS，exit 0。

| case | 比對 | evals | 最大相對誤差 |
|---|---|---|---|
| sphere_default | kernel | 1 | 2.53e-15 |
| sphere_default | I(q) | 1 | 2.53e-15 |
| sphere_schulz_0.2_ns3 | kernel | 80 | 4.67e-12 |
| sphere_schulz_0.2_ns3 | I(q) | 80 | 7.03e-16 |
| sphere_schulz_0.4_ns8 | kernel | 52 | 1.31e-10 |
| sphere_schulz_0.4_ns8 | I(q) | 52 | 1.45e-15 |
| cylinder_default | kernel | 1 | 3.95e-14 |
| cylinder_default | I(q) | 1 | 8.25e-15 |
| cylinder_2pd | kernel | 1225 | 1.12e-13 |
| cylinder_2pd | I(q) | 1225 | 6.93e-15 |
| sphere@hayter_msa（sphere kernel） | kernel | 1 | 2.53e-15 |
| sphere@hayter_msa（hayter_msa kernel） | kernel | 1 | 1.81e-11 |
| sphere@hayter_msa_beta_pd（sphere kernel） | kernel | 80 | 4.67e-12 |
| sphere@hayter_msa_beta_pd（hayter_msa kernel） | kernel | 1 | 2.67e-11 |
| core_shell_cylinder_2pd | kernel | 1225 | 3.68e-14 |
| core_shell_cylinder_2pd | I(q) | 1225 | 6.07e-15 |
| core_shell_cylinder_2pd_n15 | kernel | 225 | 1.96e-14 |
| core_shell_cylinder_2pd_n15 | I(q) | 225 | 5.95e-15 |
| core_shell_cylinder_1pd_n35 | kernel | 35 | 3.88e-14 |
| core_shell_cylinder_1pd_n35 | I(q) | 35 | 5.98e-15 |

## 效能（median of 20，5 次暖機；wasm 為 Node 內，原生為 `SAS_OPENCL=none`、`platform="dll"`、`DirectModel(cutoff=1e-5)`）

| case | q 點數 | evals | 原生 (ms) | wasm (ms) | wasm/原生 |
|---|---|---|---|---|---|
| sphere 預設 | 400 | 1 | 0.029 | 0.015 | 0.52 |
| sphere schulz 80 點 | 400 | 80 | 0.179 | 0.268 | 1.50 |
| cylinder 2-pd（35×35） | 400 | 1225 | 511.6 | 790.2 | 1.54 |
| core_shell_cylinder 2-pd（35×35） | 400 | 1225 | 935.1 | 1281.1 | 1.37 |
| core_shell_cylinder 2-pd（35×35） | 100 | 1225 | 235.4 | 324.1 | 1.38 |
| core_shell_cylinder 2-pd（15×15） | 400 | 225 | 184.6 | 250.6 | 1.36 |
| core_shell_cylinder 1-pd（n=35） | 400 | 35 | 29.4 | 40.2 | 1.37 |

觀察：
- 時間約與 q 點數成正比（400→100 點：wasm 1281→324 ms、原生 935→235 ms）。
- 時間隨評估次數縮減：2-pd n=35→15（1225→225 evals）wasm 1281→251 ms；單一多分散參數 n=35 為 40 ms。
- 原生也要 935 ms，故 core_shell_cylinder 2-pd 的耗時主要來自工作負載，wasm 額外成本約 1.4–1.5 倍。
- 本次僅測單執行緒；以多個 Web Worker 切分 q 的效果未實測。瀏覽器（非 Node）內的速度未實測。

## 對後續計畫的影響

- 實例化需提供 `{ env: { emscripten_notify_memory_growth() {} } }`，且實例化後必須呼叫一次 `_initialize()`。
- background 不在 kernel 內：sasmodels 的 `values` buffer 中 background 為 0，I = scale/⟨V_shell⟩·⟨F²⟩ + background 的 background 於 kernel 外相加。
  - 更正（2026-11-18，M1 Task 4）：`values` 中 background 為 0 只發生在經由 `DirectModel` 呼叫時（`direct_model.py:330-336` 先歸零、`:351` 再加回）；`call_kernel`／`Kernel.Iq` 送出的是實際的 background（`kernel.py:82-98`），C kernel 本身不讀這一格。
- 記憶體透過匯出的 `malloc`/`free` 管理；`malloc` 後必須重新讀取 `memory.buffer`（記憶體可能成長，舊的 ArrayBuffer 會失效）。
- kernel 以每批最多 100 個 eval 的區間呼叫（`start`、`stop`）；結果 buffer 長度為 nq·(have_Fq ? 2 : 1) + 4。
- 2 參數多分散的實測成本：core_shell_cylinder 35×35（1225 evals）、400 q 點需約 1.28 s（wasm）；100 q 點約 0.32 s；15×15 約 0.25 s；單參數 n=35 約 40 ms。
