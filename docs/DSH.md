# DSH 薄适配

包名 `wodeappx-dsh`，在仓根目录，Apache-2.0，只交预构建 JS。

```bash
dsh plugin --profile web add wodeappx-dsh
# 重启 dsh web
```

Electron 根 `package.json` 不写 `dsh.bundle`。`github:owner/repo` 装的是仓根，要用 `#path:wodeappx-dsh`。

浏览器桥只打 `127.0.0.1:17654`。挂了给 [Releases](https://github.com/diankourenxia/wodeappx/releases)，不启动 Electron。密钥只在本机 `keys.json`。

皮肤三个工具：`wodeappx_list_skins`、`wodeappx_get_skin`、`wodeappx_set_skin`。目录来自 `wodeapp-skins.ts` 打包快照。SSOT 是 `~/.wodeapp/skin.json`。set 必须确认。不写 CSS，不启动 Electron。
