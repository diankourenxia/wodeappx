# wodeappx-dsh

WodeAppX 给 DeepSeek Harness 的薄适配。不是第二套桌面。密钥不进插件。

## 安装

```bash
dsh plugin --profile web add wodeappx-dsh
# 从本仓根目录：
dsh plugin --profile web add ./wodeappx-dsh
# 然后重启
dsh web
```

`github:owner/repo` 装的是仓根。仓根的 Electron `package.json` **没有** `dsh.bundle`。要从 git 装，用：

```bash
dsh plugin --profile web add github:diankourenxia/wodeappx#path:wodeappx-dsh
```

## 能力

- 手册智能体（图片 / 视频）+ 现网工作台
- 一条 OpenAI 兼容模型行；Key 只在本机 `~/.wodeapp/keys.json`
- 浏览器桥 `127.0.0.1:17654`：活着才给工具，挂了给 Releases，不启动 Electron
- CDP 与自进化都必须 `userConfirmed`

## 皮肤

复用现网 `wodeapp-skins.ts`，不另做一套换肤。

- `wodeappx_list_skins` / `wodeappx_get_skin`：只读，不用确认
- `wodeappx_set_skin`：必须 `userConfirmed===true`，只写 `~/.wodeapp/skin.json` 的 `{"id":"..."}`
- 目录快照由 `scripts/generate-dsh-skin-catalog.mjs` 从 `wodeapp-skins.ts` 生成，禁止手抄 id
- 桌面挂了也只写文件，下次启动再生效；不启动 Electron，不写 CSS

