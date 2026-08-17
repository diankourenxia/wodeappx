# PERF-06 步骤 4 设计：事务式 event compaction（写线上库）

> 状态：**4a+4b CLI 已实现并硬化（2026-08-03）**；默认关，写库需三保险。  
> **定位**：人工维护 CLI，不是 Server 自动维护闭环（无定时任务、无 RunRegistry lease、无后台 apply）。Server 路由（4c）仍后置。  
> 日期：2026-07-31 / 更新 2026-08-03  
> 前置：步骤 1 审计、步骤 3 dry-run + 引擎冒烟（6/6）已完成  
> 非目标：步骤 5（checkpoint/VACUUM）本设计只定义接口边界，默认不在 apply 内执行

## 1. 结论（一句话）

步骤 4 = **确认门控下的「已验证 SQL」执行器**：复用 dry-run 的同一删除规则，先备份、再证空闲、再双确认，最后才对线上 `opencode.db` 做事务删除；OpenWork Server 只做编排/状态，删除 SQL 不得在 Server 内另写一份。

## 2. 目标与非目标

### 目标

- 在本机线上库上安全执行与 dry-run 相同的 compaction，回收重复 `message.updated.*` / `message.part.updated.*` 中间快照。
- 失败可回滚（事务）或从备份恢复；全程可审计。
- 默认关闭；误触不会写库。

### 非目标（本步不做）

- 不在 apply 默认路径执行 `VACUUM` / `PRAGMA wal_checkpoint`（→ 步骤 5，二次确认）。
- 不做 server/engine 侧媒体外置（步骤 2 剩余）；不删 >2 MiB 单 event 本体（仍靠步骤 2）。
- 不自动定时任务、不静默后台 compaction。
- 不把未验证的 ad-hoc SQL 写进 OpenWork Server。

## 3. 单一真相：删除规则

继续以 `scripts/wodeappx-event-db-compaction-dryrun.mjs` 导出的常量为唯一 SQL 源：

| 导出 | 用途 |
|---|---|
| `COMPACTION_TYPE_FILTER` | 仅 `message.updated.%` / `message.part.updated.%` |
| `COMPACTION_ENTITY_SQL` | 实体 id 提取；NULL → 不删 |
| `COMPACTION_PLAN_SQL` | 只读计划 |
| `COMPACTION_DELETE_SQL` | 事务内删除 |
| `planCompaction` / `fingerprintProjections` / `fingerprintsEqual` | 计划与校验 |

**不变式**：apply 路径 `import` 上述导出，禁止在 Server/CLI 复制粘贴第二份 DELETE。

## 4. Feature flag 与确认门控

### 4.1 开关（全部默认关）

| 层 | 名称 | 默认 | 含义 |
|---|---|---|---|
| 环境 | `WODEAPPX_EVENT_DB_COMPACTION_APPLY` | unset/0 | 未设为 `1` 时，任何 apply 入口直接拒绝 |
| CLI | `--i-understand-write-live-db` | 无 | 显式承认写线上库 |
| CLI | `--confirm-plan=<token>` | 无 | 必须匹配最近一次 dry-run/plan 签发的 token |
| Server | `maintenance.eventDbCompaction.enabled`（prefs/env） | false | HTTP apply 路由存在但默认 404/403 |

三者（或 CLI 三件套：env + 两 flag）缺一不可。

### 4.2 Plan token（防「旧计划打新库」）

`pnpm test:event-db-audit` 或新命令 `pnpm test:event-db-compaction:plan` 在只读打开线上库后输出：

```json
{
  "token": "sha256前16位",
  "issuedAt": "ISO-8601",
  "dbPath": "...",
  "dbInode": 123,
  "dbSizeBytes": 3799965696,
  "eventRows": 170002,
  "deleteRows": 85956,
  "deleteBytes": 2428364650,
  "ruleVersion": "v1-message-part-final-snapshot",
  "expiresAt": "issuedAt+2h"
}
```

`token = sha256(ruleVersion|dbPath|dbInode|dbSizeBytes|eventRows|deleteRows|deleteBytes|issuedAt|expiresAt)`（字段以实现为准，须稳定可复算）。`expiresAt` 缺失/非法 → 拒绝（不可绕过 TTL）。

Apply 时重算当前库指纹；任一字段漂移（库被写入、换文件、计划过期）→ **拒绝**，要求重新 plan。

### 4.3 人为确认文案（CLI 打印，Server UI 同文）

必须展示：将删行数、MiB、规则摘要、备份路径、是否含 VACUUM（步骤 4 默认否）。  
无交互 TTY 时禁止「按 y」；只认 `--confirm-plan=`。

## 5. 空闲与备份前置

### 5.1 空闲（Idle gate）

Apply 开始前全部满足，否则 409 / 退出码 2：

1. **OpenWork RunRegistry**：目标账户相关 workspace 无 active run；无 reload lease。（Server 路径；CLI 当前以 2–4 为主。）
2. **引擎 live status（fail-closed）**：无 discovery → 视为引擎未运行，通过。有 discovery 时二次读取 status 须为 idle；**探测请求失败默认拒绝**（禁止 fail-open）。紧急跳过仅允许显式 env `WODEAPPX_EVENT_DB_COMPACTION_ALLOW_IDLE_PROBE_FAILURE=1`。
3. **Maintenance lock**：备份根目录下 `.compaction-apply.lock`（`wx`），全局同时只允许一个 apply。
4. **可选更严**：要求用户先退出桌面端 / 停止 sidecar（env `WODEAPPX_EVENT_DB_COMPACTION_REQUIRE_ENGINE_DOWN=1`）。默认不要求关引擎，但 idle 探测失败或 DB 写锁失败则中止。

并发：`maintenance concurrency: 1`（§7.8）— 全局同时只允许一个 compaction apply。

### 5.2 备份（Backup gate）

Apply 删除前强制：

1. 复制 `opencode.db` + `-wal` + `-shm` →  
   `~/Library/Application Support/com.differentai.openwork/backups/event-db-compaction-<ISO>/`  
   （或 `WODEAPPX_EVENT_DB_BACKUP_ROOT`）
2. 对备份做 `PRAGMA integrity_check`；失败则中止、不删线上。
3. 写 `backup-manifest.json`：源路径、大小、sha256（至少整文件 hash）、计划 token、操作者主机名。
4. 备份目录磁盘剩余空间 ≥ 源库体积 × 1.2（`df -Pk`），否则中止；`df` 失败同样拒绝。
5. 权限：备份目录 `0700`，库文件与 manifest `0600`。

**没有成功备份 = 禁止 DELETE。**

## 6. Apply 状态机

```text
PLAN (只读) → BACKUP → IDLE_GATE → BEGIN TX → DELETE → FINGERPRINT+FK+INTEGRITY
  → COMMIT → RELEASE_LEASE → REPORT
  ↘ 任一步失败：ROLLBACK（若已 BEGIN）/ 不 COMMIT；保留备份；写失败报告
```

| 阶段 | 动作 | 失败策略 |
|---|---|---|
| PLAN | 只读 `planCompaction`，签发 token | 不写库 |
| BACKUP | 复制 + integrity | 中止 |
| IDLE_GATE | registry + status + lease | 中止 |
| DELETE | `BEGIN; COMPACTION_DELETE_SQL; ` 投影指纹 + FK；`COMMIT` | `ROLLBACK`；库应回到删除前（同连接事务） |
| REPORT | `test-results/event-db-apply-<ISO>/` | 始终落盘 |

**VACUUM**：步骤 4 的 apply **默认 `--no-vacuum`**。步骤 5 单独命令：`...:vacuum --confirm-backup=<backupId>`，且再次 idle + 有备份。

若 SQLite 在其它连接持有写锁：超时失败，不强制杀引擎（除非用户显式 `REQUIRE_ENGINE_DOWN`）。

## 7. 组件与文件

### 7.1 CLI（首期必做）

| 命令 | 作用 |
|---|---|
| `pnpm test:event-db-compaction:plan` | 只读计划 + token（可复用 audit 输出） |
| `pnpm test:event-db-compaction:apply` | 门控 + 备份 + 事务删除（写线上） |
| 现有 dry-run / smoke | 不变；apply 前建议仍先 dry-run |

新脚本建议：`scripts/wodeappx-event-db-compaction-apply.mjs`  
共享逻辑从 dry-run 抽到 `scripts/wodeappx-event-db-compaction-core.mjs`（可选重构，避免循环依赖）。

### 7.2 OpenWork Server（首期可选 / 二期）

| 路由 | 方法 | 行为 |
|---|---|---|
| `/maintenance/event-db/plan` | GET/POST | 只读计划 + token |
| `/maintenance/event-db/apply` | POST | body: `{ confirmPlan, iUnderstandWriteLiveDb }`；跑与 CLI 同一 core |
| `/maintenance/event-db/status` | GET | 上次 apply / 备份路径 / flag 是否开启 |

约束：

- Server **import core**，不内联 SQL。
- flag 关 → 403。
- apply 持 maintenance lease；与 reload 互斥。

首期可 **仅 CLI**，Server 路由标 TODO，避免桌面 UI 误点。

### 7.3 单测

| 测项 | 要点 |
|---|---|
| token 漂移拒绝 | 改 eventRows 后 apply 失败 |
| 无备份拒绝 | mock 复制失败 |
| 事务回滚 | DELETE 后强制指纹失败 → ROLLBACK，行数复原 |
| flag 关闭拒绝 | env 未开直接 exit |
| 与 dry-run SQL 同源 | apply 模块引用同一 `COMPACTION_DELETE_SQL` 常量 |

挂入 `test:agent-capabilities` 的不烧积分门禁（只测内存夹具，不碰真实线上库）。

## 8. 操作手册（评审通过后给人执行）

```bash
# 0. 建议：桌面端无进行中任务；大库可先退出桌面端降低锁竞争
pnpm test:event-db-audit
pnpm test:event-db-compaction:dryrun   # 仍只打副本
# 可选：pnpm test:event-db-compaction:smoke

# 1. 签发计划
pnpm test:event-db-compaction:plan
# → 记下 token

# 2. 写线上（三保险）
WODEAPPX_EVENT_DB_COMPACTION_APPLY=1 \
  pnpm test:event-db-compaction:apply \
  --i-understand-write-live-db \
  --confirm-plan=<token>

# 3. 步骤 5（另议）：空闲 + 确认备份后再 VACUUM
```

回滚：停止引擎 → 用备份目录整夹覆盖 `opencode.db`(+wal/shm) → integrity → 再启。

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 删错规则 | SQL 单源；token 绑 ruleVersion |
| 计划过期库已变 | token 含 inode/size/row counts；漂移拒绝 |
| 引擎锁库 | idle lease；锁超时失败；可选要求引擎关闭 |
| 事务中断电源 | 备份优先；SQLite 事务日志；integrity 失败则停 |
| 误触 UI | 首期无 UI；Server flag 默认关 |
| VACUUM 长锁 | 不进步骤 4；步骤 5 单独确认 |
| 与 PERF-05 关系 | apply 不解决新增大 event；步骤 2 仍要做 |

## 10. 验收标准（实现完成后）

- [ ] flag 默认关时 apply 无法删行（单测 + 手工）
- [ ] 无 token / token 漂移 / 无备份 → 零删除
- [ ] 成功路径：删除行数与 plan 一致；投影指纹不变；FK=0；integrity ok
- [ ] 失败注入路径：ROLLBACK 后 event 行数恢复
- [ ] 备份可独立启动引擎冒烟（复用 smoke `--copy`）
- [ ] 文档 §7.6 步骤 4 改为「已实现（默认关）」并链到本设计
- [ ] **线上首次执行前**再经一次人工确认（本设计评审 ≠ 授权写库）

## 11. 建议落地切片

| 切片 | 内容 | 写线上？ |
|---|---|---|
| 4a | 抽 core + `plan` CLI + token + 单测 | 否 |
| 4b | `apply` CLI：备份 + idle（进程内检测）+ 事务删除；无 Server | 是（仍要 flag+确认） |
| 4c | Server maintenance 路由 + lease 与 reload 互斥 | 是（同门控） |
| 5 | 独立 vacuum 命令 | 是（另确认） |

**推荐评审通过后先做 4a → 4b；4c 可后置。**

## 12. 待你拍板

1. 首期是否 **仅 CLI（4a+4b）**，Server UI/路由暂缓？  
2. 默认是否 **允许引擎仍在运行**（仅 idle+lease），还是强制 `REQUIRE_ENGINE_DOWN`？  
3. 首次对本机 3.6 GiB 库执行 apply，是否要我在实现后 **停在 dry-run 打印**，由你亲自跑带 token 的 apply 命令？

确认以上三点与整体方案后，再按 4a 开工（仍不自动写库）。
