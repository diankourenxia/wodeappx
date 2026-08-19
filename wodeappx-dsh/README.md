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
