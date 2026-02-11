# Prompt 与 Output Schema 设计思路

## 1. 设计背景与目标

本系统通过 AI 对屏幕截图进行多粒度总结，核心诉求是：
- **原子记录（2min）**：捕捉具体动作+对象+变化，为上层聚合提供结构化要素。
- **中期聚合（10min）**：去重合并，形成带时间轴的任务轨迹。
- **长期归纳（1h）**：提炼阶段成果与时间分布，可直接作为日报/周报素材。

设计原则来源于 `task/2.ai总结板块.md` 定义的 9 个总结维度（任务与目标、动作类型、对象与上下文、内容变化、进度与结果、阻塞与风险、下一步意图、专注与切换、置信度），以及 `task/3. 总结需求.md` 对活动持续时间统计的要求。

## 2. 粒度演进：从 1min 到 2min

原始设计（`task/2.ai总结板块.md`）基于 1 分钟粒度。实际运行后调整为 2 分钟，原因：
- 1 分钟内截图变化极少，AI 频繁返回"无变化"，API 调用浪费。
- 2 分钟可获得足够的屏幕变化信号，同时将 API 调用量减半。
- 配置兼容：`config.js:198-213`（`_normalizeGranularity`）自动将旧 1min 配置切换为 2min。

## 3. 2min 级别 — 字段设计思路

### 字段总览

| 字段 | 类型 | 设计动机 |
|------|------|----------|
| category_type | string[] | **活动归类类型列表**：每个元素为 任务/行为/新建任务/新建行为。与 category_name 一一对应。一个 2min 时段内可能涉及 1~3 个活动。基于 Todo List 归类，新建类型自动回写。 |
| category_name | string[] | **归类名称列表**：每个元素为对应的主任务名或行为名。是跨粒度聚合的主键，取代原 task_label 的对齐作用。按主次顺序排列（最主要活动在前）。 |
| subtask_name | string[] | **子任务名称列表**：与 category_name 一一对应。仅当对应活动归类到任务且有明确子任务行为时填写，否则为空字符串。AI 可建议新子任务名，自动回写到主任务下。 |
| task_status | string | 标注任务生命周期节点（开始/继续/切换/结束），使上层能判断任务边界和持续性。 |
| interaction_mode | string | **浏览与操作的显式区分**，解决原始设计中"核心动作"字段混淆被动浏览与主动操作的问题。 |
| browse_content | string | 浏览场景下的具体内容（页面/文档/视频等），与 operate_action 互补，使上层能分别统计浏览时间和操作时间。 |
| operate_action | string | 操作场景下的具体动作（编辑/提交/执行命令等），是 10min 聚合的核心信号源。 |
| core_action | string | 本时间段最关键的单一动作。操作优先于浏览。供快速预览。 |
| context | string | 应用/窗口/文件/网页/关键词，作为**关键对象对齐字段**，上层按此匹配和聚合。 |
| content_change | string | 标注内容变化类型，使上层能过滤"无变化"记录、突出实际产出。 |
| progress | string | 标注推进状态，供 10min/1h 提炼关键进展。 |
| blockers | string | 记录阻塞和风险，逐层向上传播至 1h 级别。 |
| next_intent | string | 下一步意图推断，为连续性分析提供线索。 |
| confidence | string | 证据充分性标记，低置信度的记录在上层聚合时权重降低。 |
| duration_minutes | number | **活动持续时间**，通过回溯历史 category_name[0]（主活动）连续出现次数 × 2 计算。解决"活动持续了多久"的需求（`task/3. 总结需求.md`）。 |

### 浏览/操作区分机制

**设计动机**：原始 1min 设计只有"核心动作"一个字段，无法区分"用户在阅读文档"和"用户在编辑代码"。这两种行为的信息价值和上层聚合方式完全不同：
- 浏览是被动信息获取，上层聚合时应作为背景。
- 操作是主动产出行为，上层聚合时应作为主线。

**区分规则**（`prompt-builder.js:178-181`）：
- **浏览**：仅查看/阅读/滚动/播放，无输入/执行/提交。
- **操作**：输入、编辑、执行命令、点击按钮/菜单、保存/提交/创建/删除。
- **特殊情况**：对话框/弹窗/表单中的确认/提交/保存/重命名等操作优先记录。

**聚合影响**：10min 级别 prompt 明确要求"优先提炼 operate_action/interaction_mode=操作或混合"，1h 级别要求"以实际操作为主线，过滤纯浏览噪声"。

### duration_minutes 计算逻辑

**设计动机**：满足 `task/3. 总结需求.md` "最细颗粒度下统计活动持续时间"的需求。

**规则**（`prompt-builder.js`）：
1. 回溯历史 2min 总结的 category_name 字段（取列表第一个元素，即主活动名称）。
2. 统计该名称在 category_name[0] 中连续出现的 2min 段数 + 当前段 = duration_minutes。
3. 新活动或无历史 → duration_minutes = 2。
4. 时间断档后重新从 2 开始计数。
5. 旧数据兼容：若无 category_name 则使用 task_label[0]。

## 4. 10min 级别 — 字段设计思路

### 字段总览

| 字段 | 类型 | 设计动机 |
|------|------|----------|
| task_main | string | 按任务标签合并后的主线描述。将 5 个 2min 的碎片信息归纳为一句话。 |
| activity_timeline | array | **时间轴结构**（每条含 label, category_type, start_time, end_time, minutes, subtasks），解决"这 10 分钟做了哪些事、各花了多久"的问题。label 使用 category_name（任务名/行为名），category_type 标识任务/行为，subtasks 收集子任务名。 |
| key_progress | string | 仅保留新增/变化/结果，去除重复的静态描述。 |
| key_objects | string | 从 2min 的 context 字段聚合，为 1h 提供对象对齐依据。 |
| content_change | string | 聚合 2min 的内容变化。 |
| blockers | string | 聚合 2min 的阻塞信息。 |
| next_step | string | 基于进展推断下一步。 |
| confidence | string | 聚合后的置信度。 |

### activity_timeline 设计

**设计动机**：原始 10min 设计（`task/2.ai总结板块.md`）只有"任务主线"文本描述，缺乏结构化的时间信息。为满足活动持续时间统计（`task/3. 总结需求.md`）和 1h 级别的 time_distribution 聚合需求，新增结构化时间轴。

**构建规则**（`prompt-builder.js`）：
1. 从每条 2min 总结提取 timestamp、category_type（列表）、category_name（列表）、subtask_name（列表）。
2. 对列表中的每个活动分别生成时间轴条目，label 使用 category_name 中的元素。
3. 每条 2min 代表一个 2 分钟段：start = timestamp - 2min，end = timestamp。
4. 合并相同 category_name 的连续/相邻段为一条记录。
5. 中间间断 > 4 分钟的拆分为两条独立记录。
6. 过滤累计 < 3 分钟的零散活动。
7. 按 start_time 升序排列。
8. 旧数据兼容：若 category_name 为字符串则视为单元素列表；若无 category_name 但有 task_label，用 task_label[0] 作为 label，category_type 视为"行为"。

**3 分钟过滤阈值依据**：2min 粒度下，单次出现的活动仅 2 分钟，大概率是短暂切换或误判，不具备聚合价值。≥ 3 分钟（至少出现 2 次）表示有一定持续性。

## 5. 1h 级别 — 字段设计思路

### 字段总览

| 字段 | 类型 | 设计动机 |
|------|------|----------|
| achievements | string[] | 1-3 条阶段性成果，是 1h 最核心的输出，直接可用于日报。 |
| task_chain | string | 按时间顺序串联的任务链条，呈现整体工作流向。 |
| time_distribution | array | 主要活动的时间分布（每条含 label, category_type, minutes, subtasks），按累计分钟降序。解决"这 1 小时的时间花在哪了"。 |
| miscellaneous | array | **杂项活动归类**（累计 < 5 分钟的零散活动），使主要活动的时间占比一目了然。 |
| key_output | string | 具体产出物（代码/文档/配置/结论），供周报提取。 |
| blockers | string | 聚合 10min 的阻塞信息。 |
| next_direction | string | 下一阶段方向，粒度从"下一步"提升为"方向"。 |
| confidence | string | 整体置信度。 |

### time_distribution / miscellaneous 设计

**设计动机**：直接回应 `task/3. 总结需求.md` "在小时级别总结时需要特别考虑活动的持续时间，对于一些比较杂的活动可以集中列一下"。

**聚合规则**（`prompt-builder.js:261-265`）：
1. 从 10min 总结的 activity_timeline 提取 label 和 minutes。
2. 相同标签的 minutes 累加。
3. 累计 ≥ 5 分钟 → time_distribution（主要活动）。
4. 累计 < 5 分钟 → miscellaneous（杂项活动）。

**5 分钟阈值依据**：在 1 小时（60 分钟）内，占比 < 8% 的活动难以称为"主要活动"。5 分钟是 10min 窗口的一半，恰好过滤掉仅在某个 10min 窗口中短暂出现的活动。

## 6. 跨粒度聚合设计

### 字段传递机制

下层字段通过 `_formatHistorySummaries()`（`prompt-builder.js`）自动序列化为文本传递给上层 prompt。该方法遍历总结对象的所有字段（排除 timestamp 和 granularity），使新增字段无需修改传递代码；历史总结头部时间采用完整跨度（开始-结束）展示，便于上层准确理解过去活动窗口。

### 聚合链路

```
2min                    10min                   1h
─────────────────────  ─────────────────────  ─────────────────────
category_name[]  ───→  activity_timeline      ───→  time_distribution
category_type[]        (展开列表→合并+过滤≥3min)     (累加+过滤≥5min)
subtask_name[]         .label=category_name[i]      .label=category_name
                       .category_type               .category_type
                       .subtasks                    .subtasks
                                               ───→  miscellaneous
                                                      (累加<5min)

task_status      ───→  task_main              ───→  task_chain
                       (合并描述)                    (串联)

core_action      ───→  key_progress           ───→  achievements
operate_action         (去重+聚焦变化)               (提炼成果)

context          ───→  key_objects            ───→  (融入 task_chain)

content_change   ───→  content_change         ───→  key_output

blockers         ───→  blockers               ───→  blockers

duration_minutes ───→  activity_timeline       ───→  time_distribution
                       .minutes                      .minutes
```

### 噪声过滤策略

每个粒度层级都有对应的噪声过滤机制：
- **2min**：`interaction_mode` 区分浏览/操作，为上层提供过滤依据。
- **10min**：prompt 要求"优先提炼操作，浏览仅作为背景"；activity_timeline 过滤 < 3 分钟活动。
- **1h**：prompt 要求"以操作为主线，过滤纯浏览/短暂切换"；miscellaneous 归集零散活动。

## 7. 辅助机制

### 时间断档检测

**问题**：服务中断后重启，历史总结不连续，AI 可能错误累加 duration_minutes 或假设中间无变化。

**方案**（`summary-scheduler.js:134-166`，`prompt-builder.js:33-43`）：
- `_detectTimeGap()` 比较最新历史总结时间戳与当前时间。
- 差距 > 2 倍粒度间隔（2min 基础即 > 4 分钟）视为断档。
- 注入断档提示：duration_minutes 重新从 2 开始、task_status 标注"继续"。

### Todo 任务/行为目录注入（结构化 XML 格式）

**问题**：AI 需要知道用户定义的任务列表和行为类型，才能将屏幕活动归类到正确的分类中。早期采用纯文本缩进格式传输，缺少类型标签、任务描述、子任务状态等结构化信息，不利于模型准确理解层级关系和归类依据。

**方案**（`prompt-builder.js` `_buildTodoContextText()`）：
- 使用 XML 标签结构化格式替代纯文本缩进列表。
- `<task_directory>` 包含活跃/已完成任务计数；每个 `<task>` 含 `name`/`status`/子任务统计属性。
- `<task_context>` 提供任务描述，帮助模型理解活动与任务的关联性。
- `<active_subtasks>` / `<completed_subtasks>` 区分子任务状态，便于模型匹配 subtask_name。
- `<behavior_directory>` + `<behavior>` 提供行为目录和可选描述。
- `<completed_tasks>` 保留已完成任务列表供历史上下文参考。
- XML 特殊字符通过 `_escapeXml()` 转义。

**各粒度归类规则注入**：
- 2min：`<classification_rules>` 按优先级排列（任务 → 行为 → 新建），含 `<output_format>` 说明输出格式。
- 10min：`<aggregation_rules>` 说明从 2min 聚合到 activity_timeline 的规则。
- 1h：`<aggregation_rules>` 说明从 10min 聚合到 time_distribution 的规则。

### 焦点窗口信息注入

**问题**：截图只能看到画面内容，无法精确知道用户当前聚焦的是哪个应用窗口。

**方案**（`active-window-collector.js`，`prompt-builder.js`）：
- 采集器以 1 秒间隔通过 AppleScript 获取焦点窗口。
- 格式化为 `"完整焦点窗口名(应用名-窗口标题)" HH:MM:SS-HH:MM:SS` 时间线。
- 各粒度通过时间范围查询获取对应窗口记录，注入 prompt。
- 辅助 AI 判断 context 和 interaction_mode，提高准确性。

### 截图无变化跳过

**问题**：用户离开屏幕时，截图完全一致，调用 API 浪费。

**方案**（`screenshot-comparer.js`）：
- 2min 级：`allIdentical()` 逐字节比对，全部一致则跳过 API，使用 `buildNoChange2minRecord()` 生成模板记录。
- 10min 级：`allNoChange()` 检查所有 2min 子级是否全部 `no_change: true`，是则跳过，使用 `buildNoChange10minRecord()`。
- 1h 级：同理检查所有 10min 子级。
- 模板记录与正常总结格式兼容（`no_change: true` 标记 + 默认值字段），保证上层聚合不中断。

### Prompt 日志持久化

**目的**：便于回溯查看每次发给 AI 的 prompt 内容，用于调试和优化提示词。

**实现**（`prompt-logger.js`）：
- 路径：`{summary.directory}/prompt-logs/{YYYY-MM-DD}/{粒度}/HH-mm.txt`。
- 2min / 10min / 1h 分开存放。
- 图片内容用占位符替代，仅保留文本部分。

## 8. 与原始设计的差异对照

| 维度 | 原始设计（`task/2.ai总结板块.md`） | 当前实现 |
|------|-------------------------------------|----------|
| 基础粒度 | 1min | 2min（减少 API 调用） |
| 1min/2min 字段 | 9 个文本字段 | 12 个结构化字段（移除 task_label，category_type/category_name/subtask_name 均为列表，新增 interaction_mode、browse_content、operate_action、duration_minutes） |
| 活动归类 | 单一 task_label 标签 | category_name[] 列表 + category_type[] 列表（支持一个时段多活动归类，取代 task_label） |
| 10min 字段 | 7 个文本字段 | 8 个结构化字段（新增 activity_timeline 时间轴） |
| 1h 字段 | 6 个文本字段 | 8 个结构化字段（新增 time_distribution、miscellaneous） |
| 输出格式 | 文本列表 | JSON（便于解析与存储） |
| 浏览/操作区分 | 无 | 有（interaction_mode + browse_content + operate_action） |
| 活动持续时间 | 无 | 有（duration_minutes → activity_timeline → time_distribution） |
| 断档检测 | 无 | 有（注入断档提示） |
| 焦点窗口 | 无 | 有（注入窗口时间线） |
| 无变化跳过 | 无 | 有（逐级传播） |
| 旧数据兼容 | — | 无 category_type 的旧数据默认视为"行为"类型；无 category_name 但有 task_label 的旧数据用 task_label[0] 作为 label |
| Todo 注入格式 | — | XML 结构化标签（task_directory/behavior_directory/classification_rules），含任务描述、子任务状态、归类优先级 |
