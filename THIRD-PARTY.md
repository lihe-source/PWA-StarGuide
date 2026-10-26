# 第三方來源及資料授權

此版本將必要執行資源放在本機，不在使用時呼叫 CDN、遠端辨識 API 或上傳照片。

## Astronomy Engine

- 作者：Don Cross。
- 官方專案：https://github.com/cosinekitty/astronomy
- 本版檔案：`astronomy.browser.min.js`，自官方 `source/js/astronomy.browser.min.js` 取得，未修改。採 MIT 授權，完整文字在 ASTRONOMY-LICENSE.txt。
- SHA-256：`d1b3ab4b86aa409f78c0f0d95162a847496cba7e938eb6f4712cf9c1c45f4a2e`。
- 用於日期座標旋轉、地平座標、月球及行星位置；恆星由 HYG J2000 座標與自行修正後轉換。這不是高精度天體測量或導航系統。

## HYG Database v4.0

- 作者／維護者：David Nash，Astronexus。
- 官方專案：https://github.com/astronexus/HYG-Database
- 原始資料：`hyg/CURRENT/hygdata_v40.csv.gz`。
- 本版修改：篩選視星等 ≤ 6 的 5,070 顆恆星；轉成精簡 JSON；保留 HIP、英文專名、J2000 赤經赤緯、自行、星等、色指數與星座代碼；加入前版已收錄的部分中文星名。不是完整中文星名資料庫。
- 衍生資料 `stars.json` 依 CC BY-SA 4.0 散布。授權連結與原始說明見 HYG-LICENSE.txt：https://creativecommons.org/licenses/by-sa/4.0/ 。此分享相同方式要求針對此衍生星表，不代表第三方 MIT／BSD 程式被重新授權。
- SHA-256：`ec76126fb8043fecb84a48df22f7b4790663975d7b2b3c904f1f545bc3d7bbbc`。

## d3-celestial 星座連線

- 作者：Olaf Frohn。
- 官方專案：https://github.com/ofrohn/d3-celestial
- 本版檔案：`constellations.json`，自官方 `data/constellations.lines.json` 取得；包含 89 個幾何項目，巨蛇座分段，代表 88 星座。資料未修改；中文顯示名在本程式內對應。
- BSD 3-Clause，保留完整授權 CELESTIAL-LICENSE.txt。
- SHA-256：`294f66bef5d5cf50b1e17f16d2efa1d97a15131612c68dd935adef6e7373e13c`。

圖示沿用既有 V1.0.0 專案。本版不含外部字型或追蹤分析程式。

## 瀏覽器／部署參考

- GitHub Pages：https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- W3C 裝置方向規範：https://www.w3.org/TR/orientation-event/
- WebKit 方向權限說明：https://bugs.webkit.org/show_bug.cgi?id=201676

上述連結供維護參考；網站離線執行不需連線至這些來源。
