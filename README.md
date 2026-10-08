<p align="center">
  <img src="src-tauri/icons/source/icon.png" width="128" alt="TrailTag" />
</p>

<h1 align="center">TrailTag</h1>

<p align="center">用手機記錄的 GPX 軌跡，為沒有 GPS 的相機照片補上地理資訊</p>

## 緣由

DJI Osmo Pocket 4P 這類裝置拍出來的畫質很好，但機身沒有 GPS，照片裡沒有任何位置資訊（其他沒有 GPS 的相機也一樣）。對照片來說，地理資訊其實很重要：相簿軟體可以用地圖瀏覽照片、依地點篩選，多年後也能回想「這張是在哪裡拍的」。少了這一塊非常可惜。

手機本身就有 GPS，只要在拍攝時用定位記錄 App（例如 Android 的 GPSLogger）錄下 GPX 軌跡，再依照拍攝時間對應到軌跡上的位置，就能把座標寫回照片的 EXIF，讓照片的資訊更完整。

TrailTag 就是把這個流程做成好用又安全的桌面工具：

- **視覺化編輯**：在地圖上預覽每張照片對到的位置，不對的可以手動放置或拖曳修正
- **時區調整**：相機時鐘的時區常常跟所在地不同（例如出國時 Pocket 仍是台灣時間），可逐資料夾設定，並以地圖比對不同時區下的位置
- **安全處理**：寫入前自動備份、只改 metadata 不動影像，每張都比對雜湊並讀回驗證

> 本專案為個人開發的開源工具，與 DJI（大疆創新）無任何關聯，也非其官方產品。

## 安裝

到 [Releases](../../releases) 下載對應平台的安裝檔：

- **macOS**：`TrailTag_x.y.z_universal.dmg`（Apple Silicon 與 Intel 皆可）
- **Windows**：`TrailTag_x.y.z_x64-setup.exe`

### macOS 首次開啟：顯示「已損毀」是正常的

安裝檔目前沒有經過 Apple 的付費簽章與公證，從網路下載後，macOS 會替 App 加上隔離標記，開啟時顯示 **「TrailTag 已損毀，無法打開」**。軟體並沒有壞掉，只要移除隔離標記即可：

1. 打開 dmg，把 **TrailTag** 拖進「應用程式」資料夾
2. 開啟「終端機」，執行：
   ```bash
   xattr -dr com.apple.quarantine /Applications/TrailTag.app
   ```
3. 再次開啟 TrailTag 即可正常使用（只需做一次，更新版本後需重新執行）

### Windows 首次開啟

安裝檔沒有程式碼簽章，SmartScreen 若顯示「Windows 已保護您的電腦」，點「其他資訊」→「仍要執行」。

## 使用方式

1. 拍攝時用手機定位 App 記錄 GPX 軌跡
2. 把照片資料夾與 GPX 檔一起拖進 TrailTag
3. 確認每個資料夾的「相機時鐘時區」，在地圖上檢查照片位置
4. 對不到軌跡的照片可手動放置，最後按「寫入」

## 功能

- 拖曳或選擇照片、資料夾（含子資料夾）與多個 GPX 檔，支援 JPG / HEIC / DNG / 常見 RAW
- 依拍攝時間在軌跡上內插位置，地圖即時顯示軌跡與照片點位（一般地圖／衛星影像）
- 每個資料夾可各自設定「相機時鐘時區」與秒數微調
- 時區提醒：目前設定明顯對不上軌跡時，提示建議的時區
- 候選時區比對：點選照片後，地圖以虛線標記顯示「若相機是 +7 / +9 …」時的位置，對照照片內容即可判斷
- 對不到軌跡的照片可在地圖上點選放置、拖曳修正，或搜尋地點（例如「台中國際機場」）
- 已有有效 GPS 的照片預設略過
- 外觀可選跟隨系統／淺色／深色（標題列按鈕或設定），原生視窗標題列一併切換

## 安全機制

1. 寫入前把原檔複製到同資料夾的 `_geotag_backup_日期時間/`（可關閉）
2. 只修改 metadata，以 `-P` 保留檔案修改時間，不重新壓縮影像
3. 寫入前後比對影像資料 SHA-256，並讀回座標驗證；任一不符就自動從備份還原
4. 不處理 `_geotag_backup_*` 與 `*_backup_original` 資料夾內的檔案（包含直接拖入這些資料夾），避免改到備份

寫入的欄位：`GPSLatitude/Longitude(+Ref)`、`GPSAltitude(+Ref)`（軌跡有高度時）、`GPSStatus=A`、`GPSMapDatum`、`GPSDateStamp/TimeStamp`；DJI 照片另外同步 `XMP-drone-dji:GPSLatitude/Longitude`，並清除 DJI 預留的 `GPSAltitude=0` 佔位值。不會寫入方向與速度，因為手機的行進方向不等於鏡頭朝向。

## 關於時區

相機的 EXIF 拍攝時間通常不含時區，GPX 則一律是 UTC，所以必須知道「相機時鐘當時設定的時區」才能對上軌跡。

- DJI Pocket 的時鐘停在最後一次與手機同步時的時區，出國沒重新同步就仍是台灣時間（UTC+8）
- 預設時區在「設定」中調整，第一次使用時為電腦目前的時區；平常在台灣使用不需更動
- 照片若本身帶有 `OffsetTimeOriginal`（例如手機拍的照片），會優先使用照片內的時區
- 手機若整天持續記錄軌跡，多個時區都可能「對得上」，此時程式不會擅自改動，請用候選時區標記比對照片內容

## 開發

技術架構：Tauri 2 + Vue 3 + Tailwind CSS v4 + Leaflet，EXIF 讀寫交給內建的 [ExifTool](https://exiftool.org/)。

需要 Node.js、pnpm、Rust 與 Tauri 的平台依賴（macOS 需 Xcode Command Line Tools；Windows 需 WebView2 與 MSVC）。

```bash
pnpm install
pnpm fetch:exiftool
pnpm tauri dev
```

`pnpm fetch:exiftool` 會下載固定版本的 ExifTool 並以 SHA-256 驗證，macOS 取 Perl 版（使用系統內建 `/usr/bin/perl`），Windows 取官方 64 位元 exe 版，放在 `src-tauri/resources/exiftool/`（不進版控）。

在瀏覽器直接開 `http://localhost:1420` 時會改用 `dev-fixture/scan.json`、`dev-fixture/thumbs.json` 的模擬資料（僅開發模式，不會進入正式建置，也不進版控，需自行準備），方便調整 UI。

### 測試

```bash
pnpm test
pnpm test:rust
GEOTAG_FIXTURE=/path/to/DJI_photo.JPG pnpm test:rust
```

指定 `GEOTAG_FIXTURE` 時會對該照片的副本實際執行掃描、寫入、備份與驗證流程。

### 建置

```bash
pnpm tauri build
```

`beforeBuildCommand` 會自動下載當前平台的 ExifTool。Windows 版請在 Windows 上建置。

### 發佈

推送 `v` 開頭的 tag 會觸發 GitHub Actions，自動建置 macOS（universal `.dmg`）與 Windows（`.exe` 安裝檔），並建立 Release 草稿：

```bash
git tag v0.1.0
git push origin v0.1.0
```

確認 Release 草稿內容後再手動發佈。版本號請同步更新 `package.json`、`src-tauri/tauri.conf.json` 與 `src-tauri/Cargo.toml`。

App 圖示的原始檔在 `src-tauri/icons/source/icon.svg`，修改後輸出 1024px PNG，再執行 `pnpm tauri icon src-tauri/icons/source/icon.png` 產生各平台格式。

## 授權

內建的 ExifTool 由 Phil Harvey 開發，依 Perl Artistic License／GPL 授權散布。

## 專案結構

```
src/
  core/          時間換算、軌跡內插、時區偵測、照片狀態判定（純函式＋單元測試）
  stores/        全域狀態與寫入流程
  services/      Tauri 指令封裝與開發用模擬資料
  composables/   偏好設定、主題、縮圖快取
  components/    地圖、資料夾卡片、照片詳情、寫入與設定對話框
scripts/         下載並驗證 ExifTool
.github/         CI 與自動發佈
src-tauri/src/
  exiftool.rs    定位並執行內建 ExifTool（參數檔、UTF-8 路徑）
  scan.rs        掃描檔案與讀取 EXIF
  gpx.rs         GPX 解析
  thumb.rs       擷取內嵌縮圖
  write.rs       備份、寫入、雜湊驗證與自動還原
```
