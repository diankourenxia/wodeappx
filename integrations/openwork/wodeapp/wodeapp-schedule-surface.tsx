/** @jsxImportSource react */
import * as React from "react";
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  MessageCircle,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";

import type { WodeAppAutomationJob, WodeAppAutomationLogs } from "./wodeapp-automation-client";
import { useWodeAppWorkbench } from "./wodeapp-workbench-context";
import { WodeAppSurfaceFrame } from "./wodeapp-surface-frame";

const AUTOMATION_STARTERS = [
  "每天早上汇总昨天的客户线索，生成日报并发到飞书",
  "每周一整理内容选题、脚本和素材清单，提醒我确认排期",
  "持续检查新抓取的竞品素材，发现有价值的图片和视频就整理成素材包",
  "每天下班前统计表单提交和异常数据，先让我确认再推送给团队",
];

function buildAutomationAgentMessage(
  request: string,
  context: { workdir?: string; timezone: string },
) {
  return [
    "用户正在创建一个定时任务。请优先使用内置 scheduler 工具，不要另写系统调度器。",
    "如果 scheduler 工具可用：用 schedule_job 创建定时任务；需要查看、运行、日志、更新或删除时，分别使用 list_jobs、run_job、job_logs、update_job、delete_job。所有调用都使用 format=json。",
    "如果 scheduler 工具不可用：明确说明内置自动任务服务暂未加载，请用户刷新或重启WodeAppX后重试，不要假装任务已经保存。",
    `系统时区：${context.timezone}。必须在保存前向用户复述具体执行时间和时区。`,
    context.workdir
      ? `当前工作区目录：${context.workdir}。创建任务时必须显式传 workdir 为这个绝对路径，除非用户明确指定其他目录。`
      : "当前工作区目录未知。涉及本地文件或代码时必须先追问工作目录，不能使用模糊默认目录。",
    "先确认任务目标、触发时间、数据来源、执行步骤、需要用户确认的节点、交付方式和通知渠道。信息足够时直接创建，不要重复追问已经明确的内容。",
    "代码任务必须在提示中要求先检查 git status，保留无关改动，禁止 force push；提交、推送、删除文件或对外发送等动作必须来自用户在创建任务时的明确授权。",
    "不得暂存或提交工作区的所有改动。文档删除必须有用户确认的具体目录和期限，或明确文件清单；用户只说‘过时文档’‘无用文档’时必须先追问，不能自行猜测。调度工具会拒绝不满足这些规则的任务，遇到拒绝必须向用户追问，不能改写后绕过。",
    "WodeAppX自动任务必须把完整执行说明写入 schedule_job.prompt。不要把 bash、sh、node、python 或其他可执行程序填进 command；command 只用于用户明确点名的高级命令。",
    "创建时设置 runFormat=json，让任务中心能够提取最终结果摘要。任务名要短且具体；同一工作区已有同名任务时先列出并请用户确认，不得自动删除或覆盖。",
    "创建成功后只用 list_jobs({ allScopes: true, format: \"json\" }) 验证，并同时匹配任务名和 workdir。schedule_job 已返回成功时，绝不能因为一次验证未匹配就删除或重建任务；应保留任务并说明需要刷新任务中心。",
    "回复中给出任务名、计划、时区和工作目录。",
    "当前调度器只支持周期 cron；若用户明确要求一次性执行，不要伪装成已支持，应说明限制并请用户改用周期任务或手动执行。",
    "",
    `用户需求：${request}`,
  ].join("\n");
}

function buildAutomationUpdateMessage(job: WodeAppAutomationJob) {
  return [
    "用户要修改一个已存在的自动任务。必须使用 update_job，不要创建重名任务。",
    `任务名称：${job.name}`,
    `当前计划：${job.schedule}`,
    `时区：${job.timezone}`,
    `工作目录：${job.workdir || "未设置"}`,
    `当前任务内容：${job.prompt}`,
    `调用 update_job 和 get_job 时必须传 scopeRoot=${JSON.stringify(job.workdir || "")} 以及 format=json，确保定位到这个工作区，不能按服务进程目录查找。`,
    "先询问用户要修改的关键字段；信息足够后调用 update_job，并用带 scopeRoot 的 get_job 验证结果。",
  ].join("\n");
}

function formatDate(value: string | null) {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function statusLabel(job: WodeAppAutomationJob) {
  if (job.status === "paused") return "已暂停";
  if (job.status === "running") return "运行中";
  if (job.status === "failed") return "上次失败";
  return "已启用";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "自动任务操作失败";
}

export function WodeAppScheduleSurface() {
  const {
    selectedWorkspaceId,
    selectedWorkspaceRoot,
    automations,
    onCreateTaskWithPrompt,
    onOpenSession,
  } = useWodeAppWorkbench();
  const timezone = React.useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
    [],
  );
  const [input, setInput] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [jobs, setJobs] = React.useState<WodeAppAutomationJob[]>([]);
  const [loading, setLoading] = React.useState(Boolean(automations));
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<Record<string, string>>({});
  const [logsById, setLogsById] = React.useState<Record<string, WodeAppAutomationLogs | undefined>>({});

  const loadJobs = React.useCallback(async (silent = false) => {
    if (!automations) {
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const result = await automations.list();
      setJobs(result.jobs);
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [automations]);

  const hasRunningJobs = jobs.some((job) => job.status === "running");

  React.useEffect(() => {
    void loadJobs();
    if (!automations) return;
    const timer = window.setInterval(() => void loadJobs(true), hasRunningJobs ? 2_000 : 8_000);
    return () => window.clearInterval(timer);
  }, [automations, hasRunningJobs, loadJobs]);

  const submit = React.useCallback(async (requestText?: string) => {
    const request = (requestText || input).trim();
    if (!request || submitting) return;
    setSubmitting(true);
    setInput("");
    try {
      onCreateTaskWithPrompt(selectedWorkspaceId, {
        displayText: request,
        agentMessage: buildAutomationAgentMessage(request, {
          workdir: selectedWorkspaceRoot,
          timezone,
        }),
      });
    } finally {
      setSubmitting(false);
    }
  }, [input, onCreateTaskWithPrompt, selectedWorkspaceId, selectedWorkspaceRoot, submitting, timezone]);

  const runAction = React.useCallback(async (
    job: WodeAppAutomationJob,
    action: "run" | "pause" | "resume" | "delete" | "logs",
  ) => {
    if (!automations || busy[job.id]) return;
    if (action === "delete" && !window.confirm(`确认删除自动任务“${job.name}”及其运行记录？`)) return;
    setBusy((current) => ({ ...current, [job.id]: action }));
    try {
      let refreshNow = true;
      if (action === "logs") {
        if (logsById[job.id] !== undefined) {
          setLogsById((current) => {
            const next = { ...current };
            delete next[job.id];
            return next;
          });
        } else {
          const result = await automations.logs(job.id, 240);
          setLogsById((current) => ({ ...current, [job.id]: result }));
        }
      } else if (action === "delete") {
        await automations.delete(job.id, true);
      } else if (action === "run") {
        const result = await automations.run(job.id);
        setJobs((current) => current.map((item) => item.id === job.id ? result.job : item));
        refreshNow = false;
      } else {
        await automations[action](job.id);
      }
      setError(null);
      if (refreshNow) await loadJobs(true);
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setBusy((current) => {
        const next = { ...current };
        delete next[job.id];
        return next;
      });
    }
  }, [automations, busy, loadJobs, logsById]);

  const editJob = React.useCallback((job: WodeAppAutomationJob) => {
    onCreateTaskWithPrompt(selectedWorkspaceId, {
      displayText: `修改自动任务：${job.name}`,
      agentMessage: buildAutomationUpdateMessage(job),
    });
  }, [onCreateTaskWithPrompt, selectedWorkspaceId]);

  return (
    <WodeAppSurfaceFrame
      title="定时任务"
      subtitle="创建、查看和管理周期任务；运行结果与日志统一保留在任务中心。"
      Icon={CalendarClock}
    >
      <div className="wx-task-chat-builder">
        <section className="wx-automation-center" aria-label="已保存的自动任务">
          <div className="wx-automation-toolbar">
            <div>
              <h3>任务中心</h3>
              <p>系统时区 {timezone}，共 {jobs.length} 个任务</p>
            </div>
            <button type="button" onClick={() => void loadJobs()} disabled={loading}>
              <RefreshCw className={loading ? "is-spinning" : ""} aria-hidden />
              <span>刷新</span>
            </button>
          </div>

          {error ? (
            <div className="wx-automation-error" role="alert">
              <AlertCircle aria-hidden />
              <span>{error}</span>
            </div>
          ) : null}

          {loading && jobs.length === 0 ? (
            <div className="wx-automation-loading" role="status">
              <Loader2 className="is-spinning" aria-hidden />
              <span>正在读取任务</span>
            </div>
          ) : jobs.length === 0 ? (
            <div className="wx-task-chat-empty">
              <MessageCircle aria-hidden />
              <h3>直接说你想自动完成什么</h3>
              <p>创建后可以在这里查看下次运行、暂停任务、立即运行或检查日志。</p>
              <div className="wx-task-chat-status" role="status">
                <CheckCircle2 aria-hidden />
                <span>{automations ? "内置定时任务已启用" : "任务服务正在连接"}</span>
              </div>
            </div>
          ) : (
            <div className="wx-automation-list">
              {jobs.map((job) => {
                const action = busy[job.id];
                const currentWorkspace = Boolean(job.workspaceId && job.workspaceId === selectedWorkspaceId);
                const conversationSessionId = logsById[job.id]?.sessionId || job.lastRunSessionId;
                return (
                  <article className="wx-automation-card" key={job.id}>
                    <div className="wx-automation-card-head">
                      <div className="wx-automation-title-wrap">
                        <div className={`wx-automation-status is-${job.status}`}>
                          {job.status === "failed" ? <AlertCircle aria-hidden /> : job.status === "running" ? <Loader2 className="is-spinning" aria-hidden /> : job.paused ? <Pause aria-hidden /> : <CheckCircle2 aria-hidden />}
                          <span>{statusLabel(job)}</span>
                        </div>
                        <h4 title={job.name}>{job.name}</h4>
                      </div>
                      <span className={currentWorkspace ? "wx-automation-workspace is-current" : "wx-automation-workspace"} title={job.workdir}>
                        {currentWorkspace ? "当前工作区" : job.workspaceName}
                      </span>
                    </div>

                    <p className="wx-automation-prompt" title={job.prompt}>{job.prompt}</p>

                    <div className="wx-automation-meta">
                      <span><CalendarClock aria-hidden />{job.schedule}</span>
                      <span><Clock3 aria-hidden />下次 {formatDate(job.nextRunAt)}</span>
                      <span><RotateCcw aria-hidden />上次 {formatDate(job.lastRunAt)}</span>
                    </div>

                    <div className="wx-automation-details">
                      <span title={job.workdir}>目录：{job.workdir || "未设置"}</span>
                      <span>时区：{job.timezone}</span>
                      <span>{job.runtimeConfigManaged ? "已绑定WodeAppX运行配置" : "使用高级默认配置"}</span>
                    </div>

                    {job.lastRunError ? <div className="wx-automation-run-error">{job.lastRunError}</div> : null}
                    {logsById[job.id] !== undefined ? (
                      <div className="wx-automation-result">
                        <div className="wx-automation-result-summary">
                          <strong>运行结果</strong>
                          <p>{logsById[job.id]?.summary || (job.lastRunStatus ? "本次运行没有返回文字摘要，可展开原始日志查看。" : "任务尚未运行。")}</p>
                        </div>
                        <details>
                          <summary>原始日志</summary>
                          <pre className="wx-automation-logs">{logsById[job.id]?.logs || "暂无运行日志"}</pre>
                        </details>
                      </div>
                    ) : null}

                    <div className="wx-automation-actions">
                      <button type="button" onClick={() => void runAction(job, "run")} disabled={Boolean(action)}>
                        {action === "run" ? <Loader2 className="is-spinning" aria-hidden /> : <Play aria-hidden />}
                        <span>立即运行</span>
                      </button>
                      {conversationSessionId && job.workspaceId ? (
                        <button
                          type="button"
                          onClick={() => onOpenSession(job.workspaceId!, conversationSessionId)}
                          disabled={Boolean(action)}
                        >
                          <MessageCircle aria-hidden />
                          <span>查看对话</span>
                        </button>
                      ) : job.status === "running" ? (
                        <button type="button" disabled title="正在建立自动任务对话">
                          <Loader2 className="is-spinning" aria-hidden />
                          <span>对话准备中</span>
                        </button>
                      ) : null}
                      <button type="button" onClick={() => void runAction(job, job.paused ? "resume" : "pause")} disabled={Boolean(action)}>
                        {action === "pause" || action === "resume" ? <Loader2 className="is-spinning" aria-hidden /> : job.paused ? <Play aria-hidden /> : <Pause aria-hidden />}
                        <span>{job.paused ? "恢复" : "暂停"}</span>
                      </button>
                      <button type="button" onClick={() => editJob(job)} disabled={Boolean(action)}>
                        <Pencil aria-hidden />
                        <span>编辑</span>
                      </button>
                      <button type="button" onClick={() => void runAction(job, "logs")} disabled={Boolean(action)}>
                        {action === "logs" ? <Loader2 className="is-spinning" aria-hidden /> : <FileText aria-hidden />}
                        <span>{logsById[job.id] === undefined ? "结果与日志" : "收起结果"}</span>
                      </button>
                      <button className="is-danger" type="button" onClick={() => void runAction(job, "delete")} disabled={Boolean(action)}>
                        {action === "delete" ? <Loader2 className="is-spinning" aria-hidden /> : <Trash2 aria-hidden />}
                        <span>删除</span>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="wx-task-chat-starters" aria-label="自动任务示例">
          {AUTOMATION_STARTERS.map((starter) => (
            <button
              key={starter}
              type="button"
              disabled={submitting}
              onClick={() => void submit(starter)}
            >
              {starter}
            </button>
          ))}
        </section>

        <form
          className="wx-task-chat-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <textarea
            value={input}
            rows={4}
            placeholder="例如：每天晚上 11 点总结今天修改的代码，更新相关文档，验证后提交并推送。"
            disabled={submitting}
            aria-describedby="wodeapp-scheduler-plugin-hint"
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <div>
            <span id="wodeapp-scheduler-plugin-hint">将使用 {timezone} 和当前工作区保存任务</span>
            <button type="submit" disabled={submitting || !input.trim()}>
              {submitting ? <Loader2 className="is-spinning" aria-hidden /> : <CalendarClock aria-hidden />}
              <span>{submitting ? "创建中..." : "开始创建任务"}</span>
            </button>
          </div>
        </form>
      </div>
    </WodeAppSurfaceFrame>
  );
}
