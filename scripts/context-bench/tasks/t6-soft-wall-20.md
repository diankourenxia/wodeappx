# Soft-wall A/B — 20 paired turns

Each `PAD` macro is expanded by `run-task.mjs` into deterministic context. The
model must retain exact anchors while keeping responses short. Tools and file
writes are forbidden so the test isolates context growth and compaction.

## Turn 1
记住以下长期锚点，后续会核验：项目代号 `ORBIT-CEDAR-731`；负责人 `林澈`；硬约束 `所有发布必须先经过灰度组 G7`。不要调用工具，不要写文件。忽略下面仅用于增加上下文长度的 padding。回复必须只有 `ACK-01`。

{{PAD:8000:T01}}

## Turn 2
新增锚点：主仓库 `northstar/atlas-console`；回滚窗口 `17 分钟`。不要调用工具，不要写文件。忽略 padding。回复必须只有 `ACK-02`。

{{PAD:8000:T02}}

## Turn 3
新增锚点：客户批次 `BATCH-44-KITE`；审计标签 `amber-rail`。不要调用工具，不要写文件。忽略 padding。回复必须只有 `ACK-03`。

{{PAD:8000:T03}}

## Turn 4
新增锚点：主区域 `ap-southeast-3`；备份区域 `eu-west-2`。不要调用工具，不要写文件。忽略 padding。回复必须只有 `ACK-04`。

{{PAD:8000:T04}}

## Turn 5
新增锚点：数据保留期 `143 天`；告警频道 `ops-lantern`。不要调用工具，不要写文件。忽略 padding。回复必须只有 `ACK-05`。

{{PAD:8000:T05}}

## Turn 6
新增锚点：发布列车 `R-2026.07.29`；冻结时间 `21:35 CST`。不要调用工具，不要写文件。忽略 padding。回复必须只有 `ACK-06`。

{{PAD:8000:T06}}

## Turn 7
新增锚点：实验桶 `quartz-19`；最低样本量 `2,048`。不要调用工具，不要写文件。忽略 padding。回复必须只有 `ACK-07`。

{{PAD:8000:T07}}

## Turn 8
第一次核验。不要调用工具，不要写文件。仅根据此前对话，按以下字段顺序输出实际值：
`CHECK-08|项目代号|负责人|灰度组|主仓库|回滚窗口|客户批次|审计标签`
回复必须严格为一行，不要输出字段名或解释。

{{PAD:8000:T08}}

## Turn 9
新增锚点：迁移工单 `MIG-8821`；验收人 `周岚`。不要调用工具，不要写文件。忽略 padding。回复必须只有 `ACK-09`。

{{PAD:8000:T09}}

## Turn 10
新增锚点：账本分片 `ledger-cobalt-6`；校验和 `9f3a-71c2`。不要调用工具，不要写文件。忽略 padding。回复必须只有 `ACK-10`。

{{PAD:8000:T10}}

## Turn 11
新增锚点：客服升级码 `ESC-51-MAPLE`；响应 SLA `23 分钟`。不要调用工具，不要写文件。忽略 padding。回复必须只有 `ACK-11`。

{{PAD:8000:T11}}

## Turn 12
第二次核验。不要调用工具，不要写文件。仅根据此前对话，按以下字段顺序输出实际值：
`CHECK-12|主区域|备份区域|数据保留期|告警频道|发布列车|冻结时间|实验桶|最低样本量`
回复必须严格为一行，不要输出字段名或解释。

{{PAD:8000:T12}}

## Turn 13
新增锚点：合规例外 `EXC-NIMBUS-04`；到期日 `2026-08-19`。不要调用工具，不要写文件。忽略 padding。回复必须只有 `ACK-13`。

{{PAD:8000:T13}}

## Turn 14
新增锚点：队列上限 `37`；退避基数 `650ms`。不要调用工具，不要写文件。忽略 padding。回复必须只有 `ACK-14`。

{{PAD:8000:T14}}

## Turn 15
新增锚点：签名密钥别名 `signer-iris`；轮换序号 `rotation-12`。不要调用工具，不要写文件。忽略 padding。回复必须只有 `ACK-15`。

{{PAD:8000:T15}}

## Turn 16
新增锚点：演练场景 `DRILL-PINE-88`；恢复目标 `11 分钟`。不要调用工具，不要写文件。忽略 padding。回复必须只有 `ACK-16`。

{{PAD:8000:T16}}

## Turn 17
新增锚点：结算币种 `SGD`；汇率快照 `FX-0729-B`。不要调用工具，不要写文件。忽略 padding。回复必须只有 `ACK-17`。

{{PAD:8000:T17}}

## Turn 18
新增锚点：发布说明编号 `RN-3107`；审批组 `CAB-indigo`。不要调用工具，不要写文件。忽略 padding。回复必须只有 `ACK-18`。

{{PAD:8000:T18}}

## Turn 19
最终核验前不新增事实。不要调用工具，不要写文件。忽略 padding。回复必须只有 `ACK-19`。

{{PAD:8000:T19}}

## Turn 20
最终核验。不要调用工具，不要写文件。仅根据此前对话，按以下字段顺序输出实际值：
`CHECK-20|项目代号|负责人|灰度组|客户批次|主区域|数据保留期|实验桶|迁移工单|验收人|校验和|客服升级码|合规例外|队列上限|签名密钥别名|演练场景|恢复目标|结算币种|发布说明编号|审批组`
回复必须严格为一行，不要输出字段名或解释。

{{PAD:8000:T20}}
