# Emotional Arc Ladder（情绪蓄力 → 爆点 → 反转）

> 竖屏短剧不能只堆「信息反转」。观众追的是**情绪被压住、被拖住、被吊着**，然后在某一刻**终于变化**的瞬间。  
> 这种变化不一定是打脸或屈辱翻盘——也可以是**终于说出口、终于离开、终于被看见、终于不再付出**。  
> **情绪梯可以跨集铺垫**；单集可以只负责继续积、继续忍、继续等。

## Three Levels

| 层级 | 作用 | 典型跨度 |
|------|------|----------|
| **Season / arc** | 长线情绪债：未说出口的话、未回应的付出、未兑现的等待 | 3-10 集一轮大变化 |
| **Episode** | 本集情绪任务：继续积、小波动、或集中释放 | 90s 内完成本集那一段 |
| **Shot** | 可见外化：身体、道具、距离、沉默、一句短台词 | 12-15s |

原则：**大变化可以铺垫多集；本集可以只「再忍一层」「再观望一秒」「再多付出一次」。**

## Emotional Palette（情绪参考 — 开放描述，不要套固定分类）

`emotionalGoal`、ledger 条目、人物内心，都用**具体、可拍的自然语言**写观众此刻的感受与角色状态。  
下面表格只是**常见参考**，不是枚举；可以组合、改写、发明新词，只要镜头能外化：

| 参考方向 | 举例（可混搭、可超出此表） | 可见拍法提示 |
|----------|---------------------------|--------------|
| 承受 | 默默承受、隐忍、负重 | 低头做事、把手藏进口袋、替人收拾烂摊子不说话 |
| 观望 | 试探、犹豫、旁观、装不知道 | 停在门口不进、目光跟随后移开、拿起手机又放下 |
| 付出 | 牺牲、兜底、沉默的保护 | 把文件推给对方、自己留下加班、删掉已编辑好的消息 |
| 渴望 | 想被看见、怕失去、暗恋 | 反复整理对方会注意到的小物、话到嘴边又咽回 |
| 亏欠 | 愧疚、迟来的道歉 | 不敢抬眼、礼物放下又拿走 |
| 对抗 | 不服、愤怒、反击欲 | 爽剧常用，只是众多情绪之一 |
| 恐惧 | 心虚、伪装、如履薄冰 | 听见名字就僵住、笑得太快 |
| 温柔 | 怜惜、克制的爱 | 替盖外套但立刻退开 |
| 释放 | 坦白、决裂、释怀、被理解 | 一句短台词 + 一个动作，不必高声 |
| *其他* | 嫉妒、麻木、荒诞、窃喜、厌倦、忠诚、背叛后的空…… | 用道具、距离、节奏让观众**看见**，不靠旁白贴标签 |

**原则**：分类服务于写作，不服务于校验。同一 beat 可以写「又酸又忍」而不是强行归入某一格。  
**`emotional_pressure` = 任何悬而未决的情绪积压**（不限屈辱）；释放也可以是离开、被看见、不再付出，而不必是翻盘。

## Core Pattern（完整梯 — 用于 payoff 集或季内大节点）

```
触发 → 积压/忍耐/悬置 → 临界 → 变化/反转 → 余震/新悬念
```

| 阶段 | 观众感受 | 示例（不限于爽剧） |
|------|----------|-------------------|
| 触发 | 「有事要发生」 | 看见对方和别人进门；发现自己又被排除在名单外；礼物被原样退回 |
| 积压 | 「憋着/悬着」 | 默默做完不被看见的事；站在人群外一步；把话删掉 |
| 临界 | 「快变了」 | 手抖、停步、深呼吸、终于抬眼 |
| 变化 | 「终于动了」 | 离开、坦白、接住、拒绝、亮证、拥抱后推开 |
| 余震 | 「然后呢」 | 对方愣住、门关上、消息已读不回、新秘密露头 |

**禁止**：信息反转（「原来他是总裁」）而**整条弧线上**没有任何可见情绪铺垫（可跨集，不可凭空）。

## Episode Emotional Modes

| 模式 | 本集是否大释放 | 例子 |
|------|----------------|------|
| `buildup` | 否，继续积 | 又默默扛事；又观望没开口；又多付出一次无回应 |
| `payoff` | 是 | 终于说出口 / 终于离开 / 终于被看见 / 当众翻盘 |
| `bridge` | 小波动 | 一次试探、一次几乎坦白又收回 |
| `mixed` | 小释放 + 大钩 | 得到半句回应，但更大误会埋下 |

**buildup 集**结尾可以是：更孤独、更悬、更心疼、更危险 —— 不必更「憋屈」二字能概括。

### buildup 集参考（90s）

| 时间段 | beat | 情绪功能 |
|--------|------|----------|
| 0-15s | `cold_open` | 新触发：付出未被看见 / 观望落空 / 承受加码 |
| 15-45s | `emotional_pressure` | 继续积：忍、等、给、退 |
| 45-75s | `setup` | 差一点变化又收回 |
| 75-90s | `cliffhanger` | 悬而未决 |

## Season Emotional Ledger（跨集情绪账）

不只记「屈辱」。用通用条目 `emotionalDebts[]`：

```json
{
  "emotionalDebts": [
    {
      "id": "unseen_sacrifice",
      "label": "付出一直没人看见",
      "emotionalGoal": "默默扛事，越扛越空",
      "plantEps": [1, 2, 4],
      "visibleMarkers": ["夜班文件", "删掉的短信", "空了的咖啡杯"],
      "targetPayoffEp": 7,
      "intensity": 8
    },
    {
      "id": "almost_confession",
      "label": "话到嘴边又收回",
      "emotionalGoal": "想靠近又不敢",
      "plantEps": [3, 5],
      "visibleMarkers": ["门口停步", "未发送的语音"],
      "targetPayoffEp": 8
    }
  ],
  "relationshipShifts": [
    { "pair": "A-B", "from": "同事", "toward": "说不清的亏欠", "sinceEp": 2 }
  ]
}
```

规则：

- **跨集铺垫算数**；payoff 集可主要靠 ledger，不必当集再羞辱一遍  
- 连续 buildup 集须加**新的一层**（新处境、新外化、新关系位移），不能同一拍法机械重复  
- `emotional_release` = 销账或部分销账（被看见、被回应、决裂、释怀都算）

## Character Depth

```json
{
  "emotionalCore": "What they most want or fear emotionally (not plot)",
  "defaultMode": "Free phrase: how they usually carry emotion when silent, e.g. fixes things off-screen, laughs too fast, watches from the doorway",
  "visibleTell": "How inner state shows on body when they say nothing",
  "releaseStyle": "How they finally change: one line, one step, one object placed down"
}
```

同一「默默承受」：A 是低头做事，B 是笑一下把疼藏起来，C 是替人挡话但眼神不移 —— **同一种情绪，不同人物**。

## Manifest Fields

- `emotional_pressure` — 积压/悬置（忍、等、给、退、怕、愧……）  
- `emotional_release` — 变化/释放（说、走、接、拒、亮、抱……）  
- `emotional_peak` — 集内或季内最高点  
- `emotionalGoal` — **自然语言**写本 beat / 本集要让观众感到什么；可参考 palette，不必归类
- `episodeEmotionalMode` — `buildup` | `payoff` | `bridge` | `mixed`  
- `carriesPressureFromEpisodes` — 承接哪几集的积垫  

## Director Review

| 级别 | 条件 |
|------|------|
| **P0** | 大 payoff 当集爆发，但 ledger + 本集无任何可见情绪积垫 |
| **P0** | 变化只靠旁白解释，无动作/道具/关系位移 |
| **P1** | buildup 集过早完整释放，透支季线 |
| **P1** | 连续多集同一情绪同一拍法（只会低头忍）无新层 |
| **OK** | 多集默默付出/观望，一季后才被看见 |
| **OK** | buildup 集无 release，以悬停 cliffhanger 收 |

## Market Notes

爽剧的屈辱/打脸只是**对抗类**里的一种；北美剧常是**克制 + 证据 + 关系位移**；甜宠可以是**付出与观望**叠很多集才靠近。  
秒数与对白预算仍遵守 `episode-rhythm-manifest.md` / `locale-en-us.md`。
