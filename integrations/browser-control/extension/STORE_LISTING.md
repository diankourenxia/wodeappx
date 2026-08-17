# WodeAppX Browser Control — Chrome Web Store listing

Update the existing public item. Do not create a second store item.

- Chrome Web Store item ID: `mfnpfomihliahiheofiijbmmhfeanhpb`
- Canonical extension source: `wodeappx/integrations/browser-control/extension`
- Upload package: `dist/wodeappx-browser-control-1.4.0.zip`
- Privacy policy: `https://wodeapp.cn/privacy/ai-browser-recorder`
- Homepage and support URL: `https://wodeapp.cn/browser-tools`

## Store name

WodeAppX Browser Control

## Summary

在 Chrome 侧栏中与 WodeAppX 对话，让 AI 读取、点击、输入并自动完成当前网页任务。

## Detailed description

WodeAppX Browser Control 把 WodeAppX 对话直接放进 Chrome 侧栏。点击扩展图标即可新建或继续对话，不必在浏览器与桌面端之间反复切换。

你可以直接描述目标，例如总结当前页面、填写表单、检查异常、筛选订单或导出结果。WodeAppX 会在任务需要时读取当前标签页，并通过明确的浏览器操作完成点击、输入、键盘操作、页面读取与截图。

主要能力：

- 点击扩展图标，在 Chrome 侧栏打开 WodeAppX 对话
- 读取当前标签页的标题、网址和可见页面信息
- 根据对话完成点击、输入、键盘操作和页面导航
- 在提交或高影响操作前按对话要求等待确认
- 在侧栏中新建对话，查看当前操作页面并管理本机连接
- 通过本机 WodeAppX 桌面端复用当前模型、会话和浏览器工具

使用前请安装并打开 WodeAppX 桌面端。扩展优先通过 Chrome Native
Messaging 与 WodeAppX 安装包内的本机宿主通信；旧版桌面端仍可使用本机
回环地址兼容连接。扩展本身不出售用户数据，也不用于广告或跨站跟踪。

## Single purpose

让用户在 Chrome 侧栏中与 WodeAppX 对话，并由 WodeAppX 自动操作用户当前选择的网页。

## Permission justifications

- `sidePanel`: 在 Chrome 原生侧栏中显示 WodeAppX 对话，这是扩展的主要界面。
- `activeTab`: 在用户发起任务后识别并操作当前标签页。
- `tabs`: 获取当前标签页标题、网址与标签页状态，并按用户要求打开或切换页面。
- `scripting`: 在任务需要时读取页面可见内容、定位元素并执行点击或输入。
- `debugger`: 通过 Chrome DevTools Protocol 完成截图、键盘输入和需要浏览器级能力的自动化操作；仅在任务执行期间临时附加。
- `nativeMessaging`: 与 WodeAppX 桌面安装包内的本机宿主通信，把用户请求的浏览器命令和结果保留在本机控制链路中；不会连接任意第三方本机程序。
- `storage`: 在本机保存桥接地址、连接令牌、会话 ID 和最近的侧栏消息。
- `alarms`: 在后台以低频率检查本机 WodeAppX 是否有待执行的浏览器命令。
- `<all_urls>`: 用户可能要求 WodeAppX 在任意普通网页上执行任务。访问仅在用户发起任务或 WodeAppX 执行该任务时发生。

### Paste-ready Privacy practices text

Paste each paragraph into the matching permission field in **Privacy practices → Permissions justification**.

**alarms**

The alarms permission is used to wake the Manifest V3 service worker at a low frequency and check the local WodeAppX bridge for a browser command requested by the user. The alarm does not collect browsing history, transmit data for advertising, or run unrelated background tasks.

**debugger**

The debugger permission is used only while WodeAppX is executing a browser task explicitly requested by the user. The extension temporarily attaches to the active target tab so Chrome displays its native browser-control indicator during automation, and detaches shortly after the command completes. It is not used for persistent monitoring, advertising, or collecting browsing history.

**nativeMessaging**

The nativeMessaging permission connects only to the cooperating
`com.wodeappx.browser_control` host installed with the WodeAppX desktop app.
The host carries user-requested browser commands and results over a local
stdin/stdout channel and accepts only a fixed set of WodeAppX browser
operations. It is not used to launch arbitrary programs, access unrelated
native applications, advertise, or track users across websites.

**sidePanel**

The sidePanel permission provides the extension's primary user interface: a WodeAppX conversation displayed beside the current webpage. It lets the user open the assistant from the toolbar, enter browser tasks, review responses, confirm actions, and manage the local WodeAppX connection without leaving the active tab.

## Privacy disclosure

扩展会在用户发起浏览器任务后处理当前页面的网址、标题、可见文本、元素描述、截图及操作结果。数据优先通过 Chrome Native Messaging 本机通道传给 WodeAppX；旧版桌面端可能使用本机回环兼容连接。当任务需要 AI 推理时，相关提示词和必要的页面上下文可能由 WodeAppX 发送到用户当前选择的模型服务商。

扩展不会出售用户数据，不会将数据用于广告、信用评估或跨站跟踪，也不会在没有用户任务的情况下批量收集浏览历史。连接设置和最近的侧栏消息保存在 `chrome.storage.local`，卸载扩展或清除扩展数据即可删除。

## Store assets

- Store icon: `store-assets/store-icon-128.png` — 128×128
- Small promo tile: `store-assets/promo-small-440x280.png` — 440×280
- Marquee promo tile: `store-assets/promo-marquee-1400x560.png` — 1400×560
- Screenshots: `store-assets/screenshots/*.png` — 1280×800

## Package

```bash
pnpm pack:browser-control
```

Upload the resulting ZIP to the existing item, save the draft, then submit the update for review.
