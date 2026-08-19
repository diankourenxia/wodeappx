# DSH 薄适配

包名 `wodeappx-dsh`，在仓根目录，Apache-2.0，只交预构建 JS。

```bash
dsh plugin --profile web add wodeappx-dsh
# 重启 dsh web
```

Electron 根 `package.json` 不写 `dsh.bundle`。`github:owner/repo` 装的是仓根，要用 `#path:wodeappx-dsh`。

浏览器桥只打 `127.0.0.1:17654`。挂了给 [Releases](https://github.com/diankourenxia/wodeappx/releases)，不启动 Electron。密钥只在本机 `keys.json`。
