import {
  Blocks,
  FileSpreadsheet,
  FileText,
  Presentation,
  type LucideIcon,
} from "lucide-react";

export type PluginCatalogItem = {
  id: string;
  title: string;
  provider: string;
  category: string;
  summary: string;
  description: string;
  Icon: LucideIcon;
  tone: "blue" | "red" | "green" | "orange" | "pink" | "purple";
  samplePrompt: string;
  tools: string[];
};

export const PLUGIN_CATALOG: PluginCatalogItem[] = [
  {
    id: "documents",
    title: "Documents",
    provider: "OpenAI",
    category: "效率工具",
    summary: "创建和编辑文档",
    description: "通过文档 MCP 工具起草、编辑、总结并导出文档产物。",
    Icon: FileText,
    tone: "blue",
    samplePrompt: "把这份产品说明整理成一页可分享的 Word 文档",
    tools: ["documents.create_docx", "documents.redline"],
  },
  {
    id: "spreadsheets",
    title: "Spreadsheets",
    provider: "OpenAI",
    category: "效率工具",
    summary: "创建和编辑表格",
    description: "创建、分析、格式化并重新计算电子表格。",
    Icon: FileSpreadsheet,
    tone: "green",
    samplePrompt: "把订单数据整理成 Excel，生成汇总表和图表",
    tools: ["spreadsheets.create_workbook", "spreadsheets.analyze_table"],
  },
  {
    id: "presentations",
    title: "Presentations",
    provider: "OpenAI",
    category: "效率工具",
    summary: "创建和编辑演示文稿",
    description: "根据大纲生成并修订 PPT 风格演示文稿。",
    Icon: Presentation,
    tone: "orange",
    samplePrompt: "把这份方案做成 8 页路演 PPT",
    tools: ["presentations.create_deck", "presentations.update_slide"],
  },
  {
    id: "template-creator",
    title: "Template Creator",
    provider: "OpenAI",
    category: "效率工具",
    summary: "创建可复用模板",
    description: "把办公文件沉淀为可复用的产物模板。",
    Icon: Blocks,
    tone: "pink",
    samplePrompt: "把这份合同整理成可复用模板",
    tools: ["templates.create", "templates.update"],
  },
];

export const PLUGIN_CATEGORIES = Array.from(new Set(PLUGIN_CATALOG.map((item) => item.category)));

