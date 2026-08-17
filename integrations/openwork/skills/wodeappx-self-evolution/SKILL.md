---
name: wodeappx-self-evolution
description: >-
  WodeAppX（wodeappx）自进化安全底线（M1）。当用户要求 Agent 修改 wodeappx 自身源码
  （界面、功能、配置、脚本）时必须使用：改动前 git 快照 → 修改 → 自动验证门禁
  （typecheck + patch 单测）→ 失败自动回滚。也适用于"改你自己的代码""自进化"
  "改了重启生效"、斜杠 `/自进化` / `/evolve` 类请求。不用于普通业务仓库改动（那些走常规编辑流程）。
---

# WodeAppX 自进化工作流（M1 安全底线）

设计文档：`wodeappx/docs/SELF_EVOLUTION_DESIGN.md`。本 skill 是其中的 M1，强制执行。

**快捷入口：** 对话输入 `/自进化`（英文 `/evolve`），命令会预填本流程；同意前不得写代码。

外观 / 皮肤类需求：先读示例提示词与白名单
`wodeappx/docs/examples/skin-theme-evolve-examples.md`（萌宠 / Coser / 可爱风 / 商务）。
那是说明书与可复制意图，不是主题配置系统；市场互通以后再做。

## 硬性规则（不得绕过）

1. **先确认方案再动手**：用一两句话向用户复述要改什么、改哪些文件，等用户同意。
2. **改动前必须打快照**：

   ```bash
   node wodeappx/scripts/self-evolve-guard.mjs snapshot --label "<一句话说明本次改动>"
   ```

   记录返回的 `snapshotId`。快照是非破坏性的：用户已有的未提交改动会被纳入保护，回滚时恢复。
3. **改完必须过验证门禁**（不允许"改完直接说好了"）：

   ```bash
   node wodeappx/scripts/self-evolve-guard.mjs verify
   ```

   默认跑两步：`@openwork/app` typecheck + OpenWork patch 单测。任一步 FAIL 即门禁失败。
   改动极小且明确不涉及类型/补丁时，才可用 `--skip-*` 跳过对应步骤，并在汇报中说明理由。
4. **门禁失败必须回滚，不留坏代码**：

   ```bash
   node wodeappx/scripts/self-evolve-guard.mjs rollback <snapshotId>
   ```

   回滚后向用户报告：失败原因（摘录关键报错）、已回滚到快照、下一步建议。
   用户明确说"先别回滚，我自己看看"时除外。
5. **生效需用户确认 + 切版本**：验证通过后，告知用户"改动已验证"，由用户决定如何生效——
   开发版多数渲染层改动热更新即生效；主进程 / sidecar 改动需要重启应用（用户手动）。
   Agent 不得自行重启应用或杀进程。**用户确认生效后，切一个命名版本**：

   ```bash
   node wodeappx/scripts/self-evolve-guard.mjs version commit --label "<本次改动说明>"
   ```

   版本存在独立影子仓库 `~/.wodeappx/self-evolve/repo.git`（不污染外层业务仓库，
   且能纳管被 gitignore 的 vendor/openwork 源码）。历史与回退：

   ```bash
   node wodeappx/scripts/self-evolve-guard.mjs version log            # 版本历史
   node wodeappx/scripts/self-evolve-guard.mjs version restore <hash> # 回退（追加式提交，不改写历史）
   ```

   `version restore` 有未提交变化时会拒绝，须先 `version commit` 或人工 `--force`。
   回退后必须重新跑 `verify` 再向用户报告。
6. **保护清单**：以下文件 Agent 修改前必须先获得用户明确确认（它们守护门禁本身）：
   - `wodeappx/scripts/self-evolve-guard.mjs`
   - 本 skill 文件（`.agents/skills/wodeappx-self-evolution/SKILL.md`）
   - `vendor/openwork/package.json` 的 typecheck 配置、`tsconfig*.json`

## 标准流程

```text
用户："把 XXX 页面的按钮改成 YYY"
  1. 复述方案 → 用户确认
  2. snapshot --label "改 XXX 页面按钮"   → 记录 snapshotId
  3. 读代码、做最小编辑（保持无关改动不动）
  4. verify
     ├─ PASS → 告知用户已验证，说明如何生效（热更新 / 需重启）
     └─ FAIL → rollback <snapshotId> → 报告失败原因与回滚事实
```

## 多会话共存规则（礼貌回滚，不加锁）

多个对话可以同时改代码，谁也不拦谁；但必须遵守三条，避免互相覆盖：

1. **实例各用各的**：`self-evolve-instance.mjs start` 不指定 `--id` 会自动分配空闲实例号，
   每个会话固定用自己的号，不要 stop 别人的实例。`status`（不带 --id）可查看全部实例归属。
2. **回滚只回自己的**：`snapshot` 会自动登记会话；`rollback` 时若检测到其他活跃会话，
   修改时间落在他们开始之后的文件会被**跳过并警告**（绝不静默覆盖他人成果）。
   看到"礼貌跳过"时先报告用户，确认无他人工作后再 `--force`。rollback 完成会自动注销自己的会话。
3. **`version restore` 报身份**：执行时加 `--session <本会话的 snapshotId>`，
   否则会保守地把所有登记会话都当作"别人"，可能全部跳过。

会话登记查看 / 清理：

```bash
node wodeappx/scripts/self-evolve-guard.mjs session list          # 谁在改代码
node wodeappx/scripts/self-evolve-guard.mjs session end --all     # 清理残留登记（会话崩溃后）
```

## worktree 隔离（多会话并行的彻底方案）

止血层（礼貌回滚）之外，并行强度大时用 worktree：每个对话在影子版本库上开一份
**独立代码副本 + 独立分支 + 独立 node_modules + 独立构建产物**，物理隔离互不覆盖
（与 Cursor 后台 Agent / Codex 云端任务同构）。

```bash
node wodeappx/scripts/self-evolve-guard.mjs worktree create --label "<说明>"   # 创建副本 wt-N
cd ~/.wodeappx/worktrees/wt-N/vendor/openwork && pnpm install                  # 约 1 分钟
cd apps/server && pnpm build   # 首次必须：构建嵌入式服务端（dist 不入版本库）
# 在副本里改代码；界面改动后：cd ../app && pnpm build
node ~/.wodeappx/worktrees/wt-N/scripts/self-evolve-instance.mjs start --root ~/.wodeappx/worktrees/wt-N
node wodeappx/scripts/self-evolve-guard.mjs worktree list                       # 所有副本状态
node wodeappx/scripts/self-evolve-guard.mjs worktree promote N [--commit "..."] # 转正：合并回主线
node wodeappx/scripts/self-evolve-guard.mjs worktree remove N                   # 清理副本（分支保留）
```

规则：
- promote 前 worktree 必须提交干净（或 `--commit` 自动提交）；主线有未提交变化时拒绝合并。
- promote 后界面改动需在**主树**重新 `pnpm build`（apps/app），主进程改动需重启正式版。
- worktree 里验证用**副本自己的** guard 脚本（路径自动指向副本）。
- 界面改动共享构建产物才需要 worktree 隔离；主进程改动在主树做 + 候选实例即可。

## 注意事项

- 快照与回滚作用在**仓库根**（wodeappx 不是独立 git 仓库），脚本已自动定位。
- `wodeappx/vendor/openwork/` 被 gitignore，git 快照管不到它——脚本会对其中高频改动的源码树（`apps/*/src`、`apps/desktop/electron`、`.opencode`、`patches`）做文件级 hash 清单 + 内容备份，回滚时按清单恢复/删除。改动**其他** ignored 区域时，快照命令加 `--protect <相对路径>` 追加保护。
- 回滚只删除"快照后新建"的 untracked 文件；快照前已存在的 untracked 文件绝不删除。
- 用户已有的未提交改动在快照里有备份（stash 对象），回滚会恢复它们的**内容**；但个别文件在 index 里的 staged/unstaged 标记可能变化（内容不受影响），如用户有精细的暂存状态，动手前先提醒。
- 快照状态存在 `.git/self-evolve/`，可用 `status` 子命令查看历史快照。
- **共享工作区防护**：快照后若 HEAD 移动过（有人提交了 commit），rollback 会拒绝执行，需人工核对 `git log` 后加 `--force`。回滚输出会列出所有将被丢弃的快照后改动——自进化会话期间尽量保持工作区独占，发现混入他人改动时先停下来报告用户。
- **工具自引用陷阱**：guard 脚本自身也在版本域内。`version restore` 回退旧版本会把脚本一并回退；回退后如需继续操作版本库，先取回最新脚本：

  ```bash
  GIT_DIR=~/.wodeappx/self-evolve/repo.git GIT_WORK_TREE=<wodeappx根> \
    git restore --source <最新版本hash> --worktree -- scripts/self-evolve-guard.mjs
  ```
- 完整构建（`pnpm build`）耗时，M1 阶段不自动构建；A/B 版本切换属于 Phase 2，见设计文档。
- 涉及会话 / 配置存储 schema 的破坏性变更：不进本流程，直接要求人工评审（设计文档 §6 红线）。
