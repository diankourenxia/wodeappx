/**
 * AppX 商品视觉批量执行器。
 *
 * 优先调用 runtime 的 ProductVisual 批量入口；若线上环境暂未暴露该入口，
 * 继续按同一 ProductVisual 任务契约展开创意类型，并通过图片生成管线执行。
 */
import {
  WodeAppRuntimeRequestError,
  requestWodeAppRuntimeJson,
} from "@/app/lib/wodeapp-auth";

import type { PvsStoryboardProjectHints } from "./wodeapp-pvs-storyboard-url";
import { resolveStoryboardProjectHeader } from "./wodeapp-pvs-storyboard-url";
import type { VisualGenerationTaskPayload } from "./wodeapp-pv-visual-task-url";
import { PRODUCT_VISUAL_MAIN_IMAGE_CREATIVE_TYPES } from "./wodeapp-pv-batch-image-capability";

const DEFAULT_MODEL = "openai/gpt-image-2";
const PRODUCT_FIDELITY = ", photorealistic, sharp focus, accurate product shape and logo, detailed material texture";
const MAX_TOTAL_IMAGES = 24;
const PRODUCT_VISUAL_BATCH_LOG_PREFIX = "[WodeAppX][product-visual-batch]";
const PRODUCT_VISUAL_RUN_TIMEOUT_MS = 300000;
const IMAGE_GENERATE_TIMEOUT_MS = 300000;

type ProductVisualCreativeType = NonNullable<VisualGenerationTaskPayload["creativeTypes"]>[number];
type RuntimeImageGenerateResponse = {
  success?: boolean;
  data?: unknown;
  error?: string;
};

export type ProductVisualBatchRunImage = {
  id: string;
  creativeTypeId: string;
  label: string;
  prompt: string;
  size: string;
  url?: string;
  error?: string;
};

export type ProductVisualBatchRunResult = {
  capabilityId: "product_visual_batch_image";
  taskId: string;
  model: string;
  executionPath?: "product-visual-run" | "image-generate-pipeline";
  totalRequested: number;
  totalSucceeded: number;
  images: ProductVisualBatchRunImage[];
};

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  const value = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fallback;
  return Math.max(min, Math.min(max, value));
}

function productVisualRunRouteMissing(error: unknown): boolean {
  const status = error instanceof WodeAppRuntimeRequestError ? error.status : undefined;
  const bodySnippet = error instanceof WodeAppRuntimeRequestError ? error.bodySnippet : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  const haystack = `${message}\n${bodySnippet}`;
  return status === 404 || haystack.includes("接口不存在") || haystack.includes("NOT_FOUND");
}

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

function summarizeError(error: unknown): Record<string, unknown> {
  if (error instanceof WodeAppRuntimeRequestError) {
    return {
      name: error.name,
      message: error.message,
      status: error.status,
      bodySnippet: error.bodySnippet?.slice(0, 500),
    };
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error ?? "") };
}

function summarizePayload(payload: VisualGenerationTaskPayload): Record<string, unknown> {
  const taskPayload = payload as VisualGenerationTaskPayload & { targetTotalImages?: unknown };
  return {
    name: payload.name,
    productImages: payload.productImages?.length ?? 0,
    refImages: payload.refImages?.length ?? 0,
    selectedCreativeTypes: payload.selectedCreativeTypes,
    creativeTypes: payload.creativeTypes?.length ?? 0,
    iterCount: payload.iterCount,
    targetTotalImages: taskPayload.targetTotalImages,
    parallel: payload.parallel,
    model: payload.model,
    aspectRatio: payload.aspectRatio,
  };
}

function pickImageUrl(data: unknown): string | undefined {
  if (!data) return undefined;
  if (typeof data === "string") {
    return data.startsWith("http") || data.startsWith("/runtime-server/api/image-proxy/") ? data : undefined;
  }
  if (typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  if (typeof record.url === "string") return record.url;
  if (typeof record.imageUrl === "string") return record.imageUrl;
  if (Array.isArray(record.urls) && typeof record.urls[0] === "string") return record.urls[0];

  for (const key of ["images", "data"] as const) {
    const value = record[key];
    if (!Array.isArray(value) || !value.length) continue;
    const first = value[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && typeof (first as Record<string, unknown>).url === "string") {
      return (first as Record<string, unknown>).url as string;
    }
  }
  return undefined;
}

function collectReferenceImages(payload: VisualGenerationTaskPayload): string[] {
  const out: string[] = [];
  for (const source of [payload.productImages, payload.refImages]) {
    if (!Array.isArray(source)) continue;
    for (const url of source) {
      const trimmed = typeof url === "string" ? url.trim() : "";
      if (trimmed && !out.includes(trimmed)) out.push(trimmed);
    }
  }
  return out;
}

function buildPrompt(payload: VisualGenerationTaskPayload, creativeType: ProductVisualCreativeType): string {
  const parts = [payload.name, payload.productInfo, payload.supplement, creativeType.promptSuffix]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
  return `${parts.join("\n")}${PRODUCT_FIDELITY}`;
}

async function runProductVisualBatchImageWithImagePipeline(
  payload: VisualGenerationTaskPayload,
  projectHeader: string,
): Promise<ProductVisualBatchRunResult> {
  const creativeTypes = payload.creativeTypes?.length
    ? payload.creativeTypes
    : PRODUCT_VISUAL_MAIN_IMAGE_CREATIVE_TYPES;
  const byId = new Map(creativeTypes.map((type) => [type.id, type]));
  const selected = payload.selectedCreativeTypes?.length
    ? payload.selectedCreativeTypes
    : creativeTypes.map((type) => type.id);
  const iterCount = clamp(payload.iterCount, 1, 8, 1);
  const parallel = clamp(payload.parallel, 1, 4, 2);
  const model = typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : DEFAULT_MODEL;
  const globalRatio = typeof payload.aspectRatio === "string" && payload.aspectRatio.trim()
    ? payload.aspectRatio.trim()
    : "1:1";
  const references = collectReferenceImages(payload);
  const taskId = `pvb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const pipelineStartedAt = Date.now();

  const jobs: Array<{ creativeType: ProductVisualCreativeType; size: string; itemId: string }> = [];
  for (const id of selected) {
    const creativeType = byId.get(id);
    if (!creativeType) continue;
    const size = creativeType.aspectRatios?.[0]?.trim() || globalRatio;
    for (let index = 0; index < iterCount; index += 1) {
      if (jobs.length >= MAX_TOTAL_IMAGES) break;
      jobs.push({ creativeType, size, itemId: `${taskId}_${id}_${index}` });
    }
  }

  if (!jobs.length) {
    throw new Error("No resolvable creativeTypes to generate. Provide selectedCreativeTypes that match creativeTypes ids.");
  }

  console.info(`${PRODUCT_VISUAL_BATCH_LOG_PREFIX} image-pipeline:start`, {
    taskId,
    projectHeader,
    jobs: jobs.length,
    parallel: Math.min(parallel, jobs.length),
    references: references.length,
    timeoutMs: IMAGE_GENERATE_TIMEOUT_MS,
    payload: summarizePayload(payload),
  });

  const images: ProductVisualBatchRunImage[] = new Array(jobs.length);
  const runOne = async (index: number): Promise<void> => {
    const job = jobs[index];
    const prompt = buildPrompt(payload, job.creativeType);
    const image: ProductVisualBatchRunImage = {
      id: job.itemId,
      creativeTypeId: job.creativeType.id,
      label: job.creativeType.label,
      prompt,
      size: job.size,
    };
    const jobStartedAt = Date.now();
    console.info(`${PRODUCT_VISUAL_BATCH_LOG_PREFIX} image-generate:start`, {
      taskId,
      itemId: job.itemId,
      index: index + 1,
      total: jobs.length,
      creativeTypeId: job.creativeType.id,
      label: job.creativeType.label,
      size: job.size,
      model,
      references: references.length,
    });
    try {
      const body: Record<string, unknown> = {
        prompt,
        model,
        size: job.size,
        n: 1,
        sync: true,
      };
      if (references.length) body.imageUrl = references;

      const response = await requestWodeAppRuntimeJson<RuntimeImageGenerateResponse>(
        "/ai/image/generate",
        {
          method: "POST",
          headers: {
            "x-subdomain-project": projectHeader,
          },
          body: JSON.stringify(body),
        },
        IMAGE_GENERATE_TIMEOUT_MS,
      );
      const url = pickImageUrl(response?.data);
      if (!response?.success || !url) {
        image.error = response?.error || "image generate returned no image url";
        console.warn(`${PRODUCT_VISUAL_BATCH_LOG_PREFIX} image-generate:no-url`, {
          taskId,
          itemId: job.itemId,
          elapsedMs: elapsedMs(jobStartedAt),
          error: image.error,
        });
      } else {
        image.url = url;
        console.info(`${PRODUCT_VISUAL_BATCH_LOG_PREFIX} image-generate:done`, {
          taskId,
          itemId: job.itemId,
          elapsedMs: elapsedMs(jobStartedAt),
          hasUrl: true,
        });
      }
    } catch (error) {
      image.error = error instanceof Error ? error.message : "image generate failed";
      console.warn(`${PRODUCT_VISUAL_BATCH_LOG_PREFIX} image-generate:error`, {
        taskId,
        itemId: job.itemId,
        elapsedMs: elapsedMs(jobStartedAt),
        error: summarizeError(error),
      });
    }
    images[index] = image;
  };

  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= jobs.length) return;
      await runOne(index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, () => worker()));

  const totalSucceeded = images.filter((image) => image?.url).length;
  console.info(`${PRODUCT_VISUAL_BATCH_LOG_PREFIX} image-pipeline:done`, {
    taskId,
    elapsedMs: elapsedMs(pipelineStartedAt),
    totalRequested: jobs.length,
    totalSucceeded,
    failed: jobs.length - totalSucceeded,
  });

  return {
    capabilityId: "product_visual_batch_image",
    taskId,
    model,
    executionPath: "image-generate-pipeline",
    totalRequested: jobs.length,
    totalSucceeded,
    images,
  };
}

export async function runProductVisualBatchImageRemote(
  payload: VisualGenerationTaskPayload,
  options: {
    launchUrl: string;
    projectHints?: PvsStoryboardProjectHints;
    async?: boolean;
    /** Billing boundary: callers must prove the user explicitly requested generation. */
    confirmRun: true;
  },
): Promise<ProductVisualBatchRunResult> {
  if (options.confirmRun !== true) {
    throw new Error("confirmRun=true is required before creating a billable batch image task");
  }
  const projectHeader = resolveStoryboardProjectHeader(
    options.launchUrl || "https://wodeapp.cn/",
    options.projectHints,
  ).header;
  if (!projectHeader) {
    throw new Error("无法解析图片项目的 x-subdomain-project");
  }

  const startedAt = Date.now();
  console.info(`${PRODUCT_VISUAL_BATCH_LOG_PREFIX} product-visual-run:start`, {
    projectHeader,
    async: options.async === true,
    timeoutMs: PRODUCT_VISUAL_RUN_TIMEOUT_MS,
    payload: summarizePayload(payload),
  });

  let response: {
    success?: boolean;
    data?: ProductVisualBatchRunResult;
    error?: string;
  };
  try {
    response = await requestWodeAppRuntimeJson<{
      success?: boolean;
      data?: ProductVisualBatchRunResult;
      error?: string;
    }>(
      "/v1/product-visual/run",
      {
        method: "POST",
        headers: {
          "x-subdomain-project": projectHeader,
        },
        body: JSON.stringify({
          ...payload,
          async: options.async === true,
        }),
      },
      PRODUCT_VISUAL_RUN_TIMEOUT_MS,
    );
    console.info(`${PRODUCT_VISUAL_BATCH_LOG_PREFIX} product-visual-run:response`, {
      elapsedMs: elapsedMs(startedAt),
      success: response?.success === true,
      hasData: Boolean(response?.data),
      taskId: response?.data?.taskId,
      totalRequested: response?.data?.totalRequested,
      totalSucceeded: response?.data?.totalSucceeded,
      executionPath: response?.data?.executionPath,
      error: response?.error,
    });
  } catch (error) {
    if (productVisualRunRouteMissing(error)) {
      console.warn("[WodeAppX][product-visual] /v1/product-visual/run missing, executing ProductVisual task contract via /ai/image/generate", {
        projectHeader,
        elapsedMs: elapsedMs(startedAt),
        error: summarizeError(error),
      });
      return runProductVisualBatchImageWithImagePipeline(payload, projectHeader);
    }
    console.error(`${PRODUCT_VISUAL_BATCH_LOG_PREFIX} product-visual-run:error`, {
      projectHeader,
      elapsedMs: elapsedMs(startedAt),
      error: summarizeError(error),
    });
    throw error;
  }

  if (!response?.success || !response.data) {
    const error = new Error(response?.error || "product-visual batch run failed");
    if (productVisualRunRouteMissing(error)) {
      console.warn(`${PRODUCT_VISUAL_BATCH_LOG_PREFIX} product-visual-run:missing-data-fallback`, {
        projectHeader,
        elapsedMs: elapsedMs(startedAt),
        error: response?.error,
      });
      return runProductVisualBatchImageWithImagePipeline(payload, projectHeader);
    }
    console.warn(`${PRODUCT_VISUAL_BATCH_LOG_PREFIX} product-visual-run:failed-response`, {
      projectHeader,
      elapsedMs: elapsedMs(startedAt),
      error: response?.error,
    });
    throw error;
  }
  const result = { ...response.data, executionPath: response.data.executionPath ?? "product-visual-run" };
  console.info(`${PRODUCT_VISUAL_BATCH_LOG_PREFIX} product-visual-run:done`, {
    projectHeader,
    elapsedMs: elapsedMs(startedAt),
    taskId: result.taskId,
    executionPath: result.executionPath,
    totalRequested: result.totalRequested,
    totalSucceeded: result.totalSucceeded,
  });
  return result;
}

export function formatBatchImageMarkdownSummary(result: ProductVisualBatchRunResult): string {
  const lines = result.images
    .filter((item) => item.url)
    .map((item) => `![${item.label}](${item.url})`);
  if (!lines.length) {
    if (result.totalRequested === 0 && result.totalSucceeded === 0) {
      return `批量出图任务已提交（taskId: ${result.taskId}），正在生成中，请在视觉工作室查看实时进度。`;
    }
    return `批量出图完成 0/${result.totalRequested} 张，请检查积分或模型配置。`;
  }
  return [
    `批量出图完成 ${result.totalSucceeded}/${result.totalRequested} 张（taskId: ${result.taskId}）`,
    ...lines,
  ].join("\n\n");
}
