# WodeApp 开源客户端与私有平台边界

> **2026-08-14 冻结（负责人确认）**
>
> 开源主体 = 独立仓 `diankourenxia/wodeappx`（桌面客户端，Apache-2.0）。
>
> 云端账号 / 积分 / 支付 / 模型网关 / 生产部署 = 现有私有 monorepo `wodeapp`，不进 OSS 导出。
>
> 不在开源仓放 `/ee`。企业 SSO、集中凭证、审计导出以后做私有平台或商业服务，不靠改开源默认行为制造云依赖。
>
> 现在不新开 `wodeapp-platform` / `wodeapp-deploy` 仓。

WodeAppX 采用“开源客户端 + 私有平台服务”模式。公开客户端必须可以在不登录 WodeApp 的情况下使用本地工作区和 BYOK；登录入口、协议类型和客户端 SDK 可以公开，安全性必须由服务端鉴权、短期令牌、吊销和限额保证，不能依赖隐藏接口。

## 仓库边界

| 仓库 / 范围 | 可见性 | 内容 |
|---|---|---|
| `diankourenxia/wodeappx` | 开源目标仓（当前仍 private，准备好再 public） | 桌面 UI、工作区、本地/BYOK、登录客户端、IPC、协议类型、扩展接口 |
| 私有 monorepo `wodeapp` | 私有 | 账号、计费、积分、权益、模型网关、反滥用、管理后台、生产配置 |

企业功能如果只是限制竞争性商业使用，可以放入单独的 Fair Source 仓库；任何“不允许源码可见”的实现必须留在私有仓库或服务端，不能仅放到公开仓库的 `/ee` 目录。

## 当前客户端安全状态

当前验证码接口仍由私有平台返回兼容 API Key。客户端已执行以下约束：

- 快捷模式只连接 `https://wodeapp.cn`，不接受任意远端回退；
- 登录、凭证迁移和加解密只在受信任 Electron 主进程执行；
- macOS 使用 Keychain 支持的 Electron `safeStorage`，Windows 使用 DPAPI，Linux 要求可用的 Secret Service/KWallet；检测到 `basic_text` 时拒绝持久化；
- `~/.wodeapp/account.json`、`service.json` 和旧 `config.json` 只保留非敏感元数据；旧 `apiKey` 经“加密写入 → 解密校验 → 删除明文”流程迁移；
- 密文保存在权限为 `0600` 的 `~/.wodeapp/credentials.v1.json`，其中不包含可直接使用的 Key；
- 生成的 OpenCode 配置使用 `{env:WODEAPP_API_KEY}`，不复制真实凭证；
- 启动时扫描应用自有的历史 runtime 配置目录，把旧版本写入 `config.json/opencode.json` 的真实 Key 替换为环境变量占位符；
- 注销会删除本机快捷登录密文和账号元数据。当前私有服务尚未提供吊销契约，因此客户端会明确把它视为“本地注销”，不能声称远端会话已吊销。
- 浏览器构建不再把兼容 Key 写入 `localStorage`，只允许当前页面内存会话；正式 Web 平台应改用服务端会话和 `HttpOnly`/`Secure`/`SameSite` Cookie。

`0600` 和本地加密只降低静态文件泄漏风险，不能替代短期、可吊销令牌。当前兼容 Key 在主进程、渲染器受限 IPC 和模型运行时之间仍会被使用；在平台完成新协议前，这属于已知的过渡风险。

## 目标登录协议

下一版私有平台应提供 versioned desktop handoff/PKCE 契约，客户端流程如下：

```text
WodeAppX main process
  -> generate state + PKCE verifier/challenge
  -> open system browser on wodeapp.cn
  -> user signs in / registers / approves device
  -> wodeappx://auth/callback?grant=...&state=...
  -> main process verifies state and exchanges grant + verifier over HTTPS
  -> short access token + rotating refresh token
  -> short, scoped model delegation token for OpenCode
```

服务端必须满足：

1. deep-link 只携带随机 grant 和 state，绝不携带 access token、refresh token、API Key 或个人信息；
2. grant 约 5 分钟过期、只能原子消费一次，并绑定客户端、PKCE challenge 和登录事务；
3. access token 短期有效；refresh token 每次使用都轮换，旧 token 重用会吊销整个 token family；
4. 登录 token 与模型调用 token 分离；模型 token 应短期、限用户、限设备、限模型/能力、限额并可即时吊销；
5. 提供设备会话列表、单设备退出、全端退出、服务端吊销、验证码限频和重放审计；
6. deep-link 回调由主进程校验 scheme、host、参数白名单、state 和时间窗，渲染器只接收脱敏后的登录状态；
7. 日志、遥测、错误上报和崩溃报告不得记录 grant、verifier、验证码或任何令牌。

在这些服务端能力上线前，不应在公开客户端中伪造一个只有参数名像 PKCE、但没有一次性消费和服务端绑定的流程。

## 永不进入公开仓库

- JWT/会话签名私钥、数据库密码、KMS 主密钥；
- 短信、邮件、支付 webhook 和模型供应商主 Key；
- Apple/Windows 签名证书、签名密码和自动发布令牌；
- 生产 `.env`、用户数据、日志、客户配置；
- 专有模型路由、反滥用规则、计费策略、私有 Prompt、数据集和客户连接器。

公开客户端中的接口路径、API 类型、前端校验和标准加密算法不属于秘密；任何发布到用户机器的代码都应按可反编译、可观察流量的条件设计。

## 发布迁移顺序

1. 已完成：本地系统加密存储、旧明文迁移、OpenCode 配置去明文副本；
2. 私有平台：实现一次性 handoff/PKCE、短 access token、轮换 refresh token和吊销；
3. 私有模型网关：签发短期 delegation token，停止向桌面端返回长期平台 API Key；
4. 公开客户端：默认切换浏览器登录，保留旧验证码流程一个有期限的迁移窗口；
5. 删除兼容流程，并对旧 Key 执行服务端吊销和轮换。
