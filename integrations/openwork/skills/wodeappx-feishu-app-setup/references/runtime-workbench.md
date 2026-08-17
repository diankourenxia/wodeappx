# 飞书电商经营 Runtime

## 目标

创建一个可发布的 WodeApp 应用，包含经营总览、商品数据表、异常表单、周报中心与自动化能力，并在飞书凭证可用时发送周报卡片。

## 复用项

- 官方模板 ID：`feishu-commerce-workbench`。
- Runtime Section：`FeishuCommerceWorkbench`。
- Runtime 实现：`runtime-server/src/routes/feishuCommerce.ts`。
- 接口基路径：以仓库根目录 `docs/API_BASE.md` 为准。

不要复制或维护第二份 API 路径表。工具可用时优先通过平台 MCP 创建项目与发布；HTTP 方式按 `docs/API_BASE.md` 和当前 agent-index 动态发现。

## 操作流

1. 确认 `server/src/routes/jsonSchema/templateRoutes.ts` 的隐藏列表仍包含 `feishu-commerce-workbench`。
2. 按模板 ID 创建项目，读取首页配置并确认 Section 类型。
3. 发布前向用户说明项目名、目标环境与本次版本影响，取得明确确认。
4. 发布后使用项目 slug 读取 runtime 配置，确认版本、模板 ID 与 Section。
5. 运行检查脚本：

   ```bash
   node scripts/check-feishu-commerce-runtime.mjs \
     --base http://127.0.0.1:4100/runtime-server/api \
     --project <project-slug>
   ```

6. 在页面层验证导航、数据表、表单提交与周报生成。没有目标群 Chat ID 时不要测试真实发送。

## 通过标准

- 健康检查成功并明确报告 `demo` 或 `connected`。
- 看板至少包含 4 个核心指标、7 天趋势、商品和异常数据。
- 异常表单可以校验并返回标准记录。
- 周报可以生成摘要、亮点、风险、行动与 Markdown。
- 带项目 slug 的 runtime 配置返回已发布版本，首页 Section 为 `FeishuCommerceWorkbench`。
- 未提供目标群时不产生任何真实飞书消息。

## 不可越界

- 不把平台环境变量描述为多租户连接。
- 不读取、打印或复制 App Secret、token、Cookie、授权码。
- 不在未确认时发布版本、扩权、扩大可用范围或发送群消息。
- 不把演示看板数字写进客户正式周报。
