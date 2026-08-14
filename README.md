# Clash Party

基於 [Mihomo](https://github.com/MetaCubeX/mihomo) 的 GUI 代理客戶端。本專案為上游 [mihomo-party-org/clash-party](https://github.com/mihomo-party-org/clash-party) 的分支（fork），由 [LangYa466](https://github.com/LangYa466) 維護。

## 下載

請至 [Releases](https://github.com/LangYa466/clashparty-fork/releases) 下載對應平台安裝包。

## Windows 安裝方式

### Scoop（建議）

```powershell
scoop install https://raw.githubusercontent.com/LangYa466/clashparty-fork/main/scoop/clash-party.json
```

安裝後會自動：

- 建立 `clash-party` 命令與開始選單捷徑
- 註冊 `clash://`、`mihomo://` 協定
- 設定檔存放在 `%SCOOP%\persist\clash-party\data`，更新與重裝不會遺失設定

更新方式（或直接在 App 內點更新按鈕，會自動呼叫）：

```powershell
scoop update clash-party
```

### 安裝檔 / 便攜版

直接從 [Releases](https://github.com/LangYa466/clashparty-fork/releases) 下載 `-setup.exe`（安裝版）或 `-portable.7z`（便攜版）。

## 其他平台

macOS 與 Linux 的安裝方式請見 [Releases](https://github.com/LangYa466/clashparty-fork/releases) 說明。
