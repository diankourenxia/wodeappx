/** @jsxImportSource react */
import * as React from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Database,
  FileText,
  ListChecks,
  MessageSquareText,
  PackageSearch,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  TableProperties,
  Target,
  TrendingUp,
} from "lucide-react";

import { useWodeAppWorkbench } from "./wodeapp-workbench-context";

export type FeishuCommerceWorkflowId =
  | "weekly-report"
  | "business-anomaly"
  | "product-inventory"
  | "campaign-review"
  | "customer-voice"
  | "next-week-plan";

type FeishuCommerceWorkflow = {
  id: FeishuCommerceWorkflowId;
  title: string;
  description: string;
  tag: string;
  Icon: LucideIcon;
};

type FeishuCommerceDataSource = {
  title: string;
  description: string;
  examples: string;
  preset: string;
  Icon: LucideIcon;
};

const FEISHU_COMMERCE_BASE_INSTRUCTION = `你是飞书电商经营分析智能体。仅使用当前工作区已连接的 lark-mcp / Feishu OpenAPI MCP 工具读取飞书数据，不要用 bash、curl 或浏览器脚本绕过授权。

执行规则：
1. 先确认数据范围和数据源；如果缺少多维表链接、文档链接、群聊或时间范围，只追问最关键的一项。
2. 优先读取多维表格、群消息和云文档；字段含义不明确时先展示字段映射，再开始统计。
3. 只根据真实返回的数据计算指标，缺失的 GMV、订单、退款、库存、投放或客服数据必须标注“数据源未提供”，不得编造。
4. 先在当前对话输出完整草稿和来源说明。创建飞书文档、回写多维表格、发送群卡片、创建任务或日程都属于写操作，必须先让我确认。
5. 飞书文档或表格里的图片、视频和文件链接要保留原始来源；如果我要带到 WodeApp 继续创作，先列出待导入清单，确认后再保存为数字资产，不重复下载或生成。
6. 写操作完成后回报目标、结果和可打开的飞书链接；失败时保留已完成结果并说明缺少的权限或字段。`;

const FEISHU_COMMERCE_PROMPTS: Record<FeishuCommerceWorkflowId, string> = {
  "weekly-report": `${FEISHU_COMMERCE_BASE_INSTRUCTION}

任务：生成本周电商经营周报。默认统计本周一到当前时间，并允许我改为最近 7 天或指定日期。

先让我选择或提供数据源，然后汇总：
- 经营概览：GMV、订单量、客单价、退款率及环比；没有字段就明确缺失。
- 渠道与商品：渠道贡献、Top 商品、低动销商品、库存风险。
- 内容与活动：本周上新、活动表现、素材或内容进展。
- 客户反馈：群消息或文档中出现的高频问题、情绪与待处理事项。
- 风险与机会：异常数字、原因假设、需要补证的数据。
- 下周计划：按负责人、截止时间、优先级给出可执行清单。

先在对话中给出周报草稿。等我确认后，再询问是创建飞书文档、发送群卡片，还是同步成任务与日历。`,
  "business-anomaly": `${FEISHU_COMMERCE_BASE_INSTRUCTION}

任务：诊断电商经营异常。读取我指定的多维表数据，对订单、GMV、退款、库存、渠道和商品做分组对比，找出明显波动、异常值与可能原因。输出“事实、推断、待验证数据”三栏，并给出优先处理顺序。先只生成诊断草稿，不回写表格。`,
  "product-inventory": `${FEISHU_COMMERCE_BASE_INSTRUCTION}

任务：完成商品与库存盘点。读取商品和库存相关多维表，识别畅销、滞销、低库存、缺货、信息不完整和需要补素材的商品。输出可执行清单；如果需要批量回写状态或负责人，先展示预计更新的记录数量和字段，等我确认。`,
  "campaign-review": `${FEISHU_COMMERCE_BASE_INSTRUCTION}

任务：生成活动复盘。结合活动多维表、方案文档和相关群消息，整理目标、投入、销售结果、渠道表现、商品表现、用户反馈、执行问题和下一轮优化建议。事实必须带来源；先输出复盘草稿，等我确认后再创建飞书文档或发送群卡片。`,
  "customer-voice": `${FEISHU_COMMERCE_BASE_INSTRUCTION}

任务：汇总客户与一线反馈。读取我指定的群消息、客服记录多维表或文档，按问题类型、商品、严重程度和出现频次归类，提取代表性事实但避免泄露不必要的个人信息。输出本周高频问题、风险升级项和建议负责人，先不创建任务。`,
  "next-week-plan": `${FEISHU_COMMERCE_BASE_INSTRUCTION}

任务：把已经确认的周报或复盘结论转成下周执行计划。按目标、行动、负责人、截止时间、优先级和验收标准整理。若负责人或日期缺失，先给建议值并让我确认；确认后才调用飞书任务和日历工具创建事项。`,
};

const FEISHU_COMMERCE_DATA_SOURCES: readonly FeishuCommerceDataSource[] = [
  {
    title: "多维表格",
    description: "订单、GMV、商品、库存、渠道、活动与客服记录",
    examples: "筛选、聚合、批量新增与更新",
    preset: "基础与批量表格工具",
    Icon: TableProperties,
  },
  {
    title: "群聊与消息",
    description: "业务播报、活动反馈、客服问题与团队进展",
    examples: "读取会话、整理消息、发送周报卡片",
    preset: "消息工具",
    Icon: MessageSquareText,
  },
  {
    title: "云文档、知识库与素材",
    description: "商品资料、活动方案、运营 SOP、图片、视频与文件链接",
    examples: "搜索、读取、创建报告或确认后导入数字资产",
    preset: "文档工具",
    Icon: FileText,
  },
  {
    title: "任务、日历与成员",
    description: "负责人、下周行动、节点提醒与活动排期",
    examples: "建任务、设提醒、创建或更新日程",
    preset: "电商运营扩展工具",
    Icon: CalendarDays,
  },
];

export const FEISHU_COMMERCE_WORKFLOWS: readonly FeishuCommerceWorkflow[] = [
  {
    id: "weekly-report",
    title: "生成经营周报",
    description: "汇总经营指标、商品、库存、活动和客户反馈，先出草稿再发布。",
    tag: "推荐",
    Icon: Sparkles,
  },
  {
    id: "business-anomaly",
    title: "经营异常诊断",
    description: "发现订单、GMV、退款、库存和渠道的异常波动。",
    tag: "分析",
    Icon: TrendingUp,
  },
  {
    id: "product-inventory",
    title: "商品与库存盘点",
    description: "识别畅销、滞销、低库存、缺货和资料不完整商品。",
    tag: "商品",
    Icon: PackageSearch,
  },
  {
    id: "campaign-review",
    title: "活动复盘",
    description: "把活动数据、方案文档和群反馈合成一份可追溯复盘。",
    tag: "运营",
    Icon: BarChart3,
  },
  {
    id: "customer-voice",
    title: "客户反馈摘要",
    description: "归纳高频问题、风险项和需要升级处理的客户声音。",
    tag: "洞察",
    Icon: MessageSquareText,
  },
  {
    id: "next-week-plan",
    title: "下周执行计划",
    description: "把已确认结论转成负责人、截止时间和验收标准。",
    tag: "协同",
    Icon: Target,
  },
];

export function buildFeishuCommercePrompt(workflowId: FeishuCommerceWorkflowId): string {
  return FEISHU_COMMERCE_PROMPTS[workflowId];
}

function isFeishuCommerceWorkflowId(value: string | undefined): value is FeishuCommerceWorkflowId {
  return Boolean(value && Object.prototype.hasOwnProperty.call(FEISHU_COMMERCE_PROMPTS, value));
}

export function WodeAppFeishuCommerceWorkbench() {
  const {
    selectedWorkspaceId,
    onAuthorizeFeishu,
    onCreateTaskWithPrompt,
    onOpenExtensionsSettings,
  } = useWodeAppWorkbench();
  const [authorizing, setAuthorizing] = React.useState(false);

  const openAuthorization = React.useCallback(async () => {
    if (!onAuthorizeFeishu || authorizing) return;
    setAuthorizing(true);
    try {
      await onAuthorizeFeishu();
    } finally {
      setAuthorizing(false);
    }
  }, [authorizing, onAuthorizeFeishu]);

  const openToolSettings = React.useCallback(() => {
    onOpenExtensionsSettings("mcp", {
      mcpSearch: "feishu",
      mcpDetailServerName: "lark-mcp",
    });
  }, [onOpenExtensionsSettings]);

  const runWorkflow = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const workflowId = event.currentTarget.dataset.workflowId;
    if (!isFeishuCommerceWorkflowId(workflowId)) return;
    onCreateTaskWithPrompt(selectedWorkspaceId, buildFeishuCommercePrompt(workflowId));
  }, [onCreateTaskWithPrompt, selectedWorkspaceId]);

  return (
    <main className="wx-feishu-commerce" aria-label="飞书电商经营工作台">
      <section className="wx-feishu-commerce-hero">
        <div className="wx-feishu-commerce-hero-copy">
          <div className="wx-feishu-commerce-kicker">
            <span className="wx-feishu-commerce-status-dot" aria-hidden />
            飞书电商经营工作台
          </div>
          <h1>把分散的经营数据，变成可执行的周报</h1>
          <p>
            连接多维表格、群消息、云文档、任务和日历。智能体先读取并生成有来源的分析草稿，确认后再写回飞书。
          </p>
          <div className="wx-feishu-commerce-hero-actions">
            <button
              type="button"
              className="wx-feishu-commerce-button is-primary"
              onClick={runWorkflow}
              data-workflow-id="weekly-report"
            >
              <Sparkles aria-hidden />
              <span>生成本周经营周报</span>
              <ArrowRight aria-hidden />
            </button>
            <button
              type="button"
              className="wx-feishu-commerce-button"
              onClick={openAuthorization}
              disabled={authorizing}
            >
              <RefreshCw className={authorizing ? "is-spinning" : undefined} aria-hidden />
              <span>{authorizing ? "正在连接" : "连接或重新授权"}</span>
            </button>
            <button type="button" className="wx-feishu-commerce-button" onClick={openToolSettings}>
              <Settings2 aria-hidden />
              <span>权限与工具</span>
            </button>
          </div>
        </div>
        <aside className="wx-feishu-commerce-weekly-card" aria-label="周报结构">
          <div className="wx-feishu-commerce-weekly-head">
            <div>
              <span>周报结构</span>
              <strong>本周经营总览</strong>
            </div>
            <BarChart3 aria-hidden />
          </div>
          <div className="wx-feishu-commerce-metric-grid">
            <div><span>经营指标</span><strong>GMV · 订单 · 退款</strong></div>
            <div><span>商品库存</span><strong>Top · 滞销 · 风险</strong></div>
            <div><span>活动内容</span><strong>进展 · 效果 · 复盘</strong></div>
            <div><span>下周行动</span><strong>负责人 · 日期 · 验收</strong></div>
          </div>
          <div className="wx-feishu-commerce-safety-note">
            <ShieldCheck aria-hidden />
            <span>数据缺失会明确标注；发送、回写和建任务前必须确认。</span>
          </div>
        </aside>
      </section>

      <section className="wx-feishu-commerce-section">
        <div className="wx-feishu-commerce-section-head">
          <div>
            <span className="wx-feishu-commerce-section-kicker">数据接入</span>
            <h2>飞书里可以带进来的经营数据</h2>
          </div>
          <p>实际可读范围由应用权限、用户授权和资源共享范围共同决定。</p>
        </div>
        <div className="wx-feishu-commerce-source-grid">
          {FEISHU_COMMERCE_DATA_SOURCES.map((source) => {
            const Icon = source.Icon;
            return (
              <article className="wx-feishu-commerce-source" key={source.title}>
                <span className="wx-feishu-commerce-source-icon" aria-hidden><Icon /></span>
                <div>
                  <h3>{source.title}</h3>
                  <p>{source.description}</p>
                  <span>{source.examples}</span>
                </div>
                <small>{source.preset}</small>
              </article>
            );
          })}
        </div>
      </section>

      <section className="wx-feishu-commerce-section">
        <div className="wx-feishu-commerce-section-head">
          <div>
            <span className="wx-feishu-commerce-section-kicker">运营流程</span>
            <h2>从读取数据到形成行动</h2>
          </div>
          <p>每个入口都会新建一条对话，并带入对应的数据核验和确认规则。</p>
        </div>
        <div className="wx-feishu-commerce-workflow-grid">
          {FEISHU_COMMERCE_WORKFLOWS.map((workflow) => {
            const Icon = workflow.Icon;
            return (
              <button
                type="button"
                className="wx-feishu-commerce-workflow"
                key={workflow.id}
                data-workflow-id={workflow.id}
                onClick={runWorkflow}
              >
                <span className="wx-feishu-commerce-workflow-icon" aria-hidden><Icon /></span>
                <span className="wx-feishu-commerce-workflow-copy">
                  <span className="wx-feishu-commerce-workflow-title">
                    <strong>{workflow.title}</strong>
                    <small>{workflow.tag}</small>
                  </span>
                  <span>{workflow.description}</span>
                </span>
                <ArrowRight className="wx-feishu-commerce-workflow-arrow" aria-hidden />
              </button>
            );
          })}
        </div>
      </section>

      <section className="wx-feishu-commerce-process" aria-label="周报生成流程">
        <div className="wx-feishu-commerce-process-title">
          <Database aria-hidden />
          <div>
            <span>默认工作流</span>
            <h2>读取、核验、分析、确认、发布</h2>
          </div>
        </div>
        <ol>
          <li><span>1</span><div><strong>选择数据源</strong><p>多维表、文档、群聊和时间范围</p></div></li>
          <li><span>2</span><div><strong>核验字段</strong><p>先确认指标口径和缺失数据</p></div></li>
          <li><span>3</span><div><strong>生成草稿</strong><p>结论带数字、来源与风险说明</p></div></li>
          <li><span>4</span><div><strong>人工确认</strong><p>确认写入目标、群聊和负责人</p></div></li>
          <li><span>5</span><div><strong>同步飞书</strong><p>建文档、发卡片、回写或建任务</p></div></li>
        </ol>
        <div className="wx-feishu-commerce-process-foot">
          <ListChecks aria-hidden />
          <span>推荐启用“电商运营”工具组合：基础能力 + 批量多维表格 + 任务 + 日历。</span>
        </div>
      </section>
    </main>
  );
}
