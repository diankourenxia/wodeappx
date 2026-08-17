# T4 — 跨 turn 切换工具域（最坏情况）

目的：每个 turn 换工具域，loaded set 每 turn 重建，制造持续 toolset 抖动，量化工单场景的上界成本。
预期行为：每个 turn toolset_changed=true，cache.read 反复触底，恢复不充分。

## Turn 1

在 `notes/` 下创建 `launch-checklist.md`，写一份新品上线清单：标题、五个二级条目（素材、定价、库存、投放、客服），每条两行说明。只用本地文件操作完成。

## Turn 2

本地的事先放一放。查一下最近 7 天销售指标和广告投放数据，对比哪个渠道 ROI 最高，把结论追加到 `notes/launch-checklist.md` 的「投放」条目下面。缺工具就搜索。

## Turn 3

回到文件工作：把 `notes/launch-checklist.md` 里「素材」条目展开成一个完整的拍摄清单，写进新文件 `notes/shooting-plan.md`，包含场景、道具、机位三个小节，每节四条。

## Turn 4

再切回经营侧：盘点库存并对低库存 SKU 创建补货单，然后把客服工单里的售后热点整理三条，追加到 `notes/shooting-plan.md` 末尾作为「拍摄注意事项」。缺工具就搜索。
