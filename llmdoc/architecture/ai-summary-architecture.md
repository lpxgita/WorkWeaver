# AI 总结模块 - 架构

## 1. Identity
- **What it is:** 基于 Google Gemini 的多时间粒度屏幕活动总结服务。
- **Purpose:** 读取截图数据，按 2min / 10min / 1h 粒度调用 AI 生成结构化总结，支持跨时间聚合。

## 2. Core Components

| 模块 | 文件 | 职责 |
|------|------|------|
| 配置 | `ai_summary/src/config.js` (`Config`) | YAML 加载、默认值合并、参数校验 |
| Gemini 客户端 | `ai_summary/src/gemini-client.js` (`GeminiClient`) | 封装 Gemini API，构建 inline 图片请求，带重试 |
| 截图读取器 | `ai_summary/src/screenshot-reader.js` (`ScreenshotReader`) | 按时间范围检索截图文件，读取为 Buffer |
| 总结存储 | `ai_summary/src/summary-store.js` (`SummaryStore`) | 总结 JSON 文件的读写，按日期+粒度组织 |
| 提示词构建 | `ai_summary/src/prompt-builder.js` (`PromptBuilder`) | 按粒度组装 prompt + 图片/历史总结 |
| 调度器 | `ai_summary/src/summary-scheduler.js` (`SummaryScheduler`) | 定时触发各粒度任务，编排流程 |
| 日志 | `ai_summary/src/logger.js` (`Logger`) | 多级别日志输出 |
| Token 跟踪 | `ai_summary/src/token-tracker.js` (`TokenTracker`) | 记录每次 API 调用的 token 用量，按时间/粒度/会话聚合，持久化到 JSON |
| 焦点窗口采集 | `ai_summary/src/active-window-collector.js` (`ActiveWindowCollector`) | 封装 ActiveWindowMonitor，持续采集窗口切换事件，按时间范围查询并格式化为 prompt 文本 |
| 焦点窗口监控器 | `ai_summary/src/active-window-monitor.js` (`ActiveWindowMonitor`) | 基于 AppleScript 调用 `osascript` 获取焦点窗口，供采集器使用（打包兼容） |
| Prompt 日志 | `ai_summary/src/prompt-logger.js` (`PromptLogger`) | 将每次构建的 prompt 按日期+粒度存储到文件，便于后续查看 |
| 截图比对器 | `ai_summary/src/screenshot-comparer.js` (`ScreenshotComparer`) | Buffer 逐字节比对截图一致性，生成无变化模板记录，检测子级全部无变化 |
| Todo 回写器 | `ai_summary/src/todo-writer.js` (`TodoWriter`) | 解析 AI 响应中的分类信息，将新任务/子任务/行为回写到 JSON 文件 |
| 主入口 | `ai_summary/main.js` (`main`) | CLI 启动、模块装配、信号处理，支持 `--todo-dir` 参数指定 Todo 数据目录 |

## 3. Execution Flow (LLM Retrieval Map)
- 启动入口：`ai_summary/main.js:86-170`（main）加载配置、初始化模块、注册信号处理并启动调度器。
- 配置加载与粒度规范化：`ai_summary/src/config.js:75-125`（Config.loadUnified）加载统一配置并计算 screenshots_per_minute；`ai_summary/src/config.js:198-213`（Config._normalizeGranularity）兼容旧 1min 配置并切换为 2min。
- 停止时间断点：`ai_summary/main.js:83-176`（parseStopTimes/getNextStopTime/scheduleStopTimer）计算下一次停止时间并设置自动退出定时器。
- 调度器启动：`ai_summary/src/summary-scheduler.js:50-83`（SummaryScheduler.start）启动 2min/10min/1h 定时器。
- 2min 执行：`ai_summary/src/summary-scheduler.js:180-298`（SummaryScheduler._run2min）读取截图→**截图一致性比对（若全部一致则跳过 API，使用模板记录）**→读取历史→断档检测→获取焦点窗口信息→构建 prompt→记录 prompt 日志→调用 Gemini→保存结果。
- 10min 执行：`ai_summary/src/summary-scheduler.js:303-380`（SummaryScheduler._run10min）读取 2min 总结→**检测全部 no_change（若是则跳过 API，使用模板记录）**→汇总 + 焦点窗口信息→构建 prompt→记录日志→调用 Gemini→保存。
- 1h 执行：`ai_summary/src/summary-scheduler.js:385-470`（SummaryScheduler._run1h）读取 10min 总结→**检测全部 no_change（若是则跳过 API，使用模板记录）**→汇总 + 焦点窗口信息→构建 prompt→记录日志→调用 Gemini→保存。
- 截图比对：`ai_summary/src/screenshot-comparer.js`（ScreenshotComparer）使用 `Buffer.equals()` 逐字节精确比对。`allIdentical(screenshots)` 判断 2min 级截图一致性；`allNoChange(summaries)` 判断上级总结的所有子级是否全部标记 `no_change: true`。模板记录由 `buildNoChange2minRecord/buildNoChange10minRecord/buildNoChange1hRecord` 生成，字段与正常总结格式兼容。
- 焦点窗口采集：`ai_summary/src/active-window-collector.js`（ActiveWindowCollector）优先封装 `ai_summary/src/active-window-monitor.js`（打包兼容），回退到 `active_window/src/active-window-monitor.js`（开发兼容）。在 `main.js` 启动时初始化并持续采集。各粒度执行时通过 `getTimelineInRange()` 获取对应时间范围内的窗口切换记录，`formatForPrompt()` 格式化为 `"完整焦点窗口名(应用名-窗口标题)" HH:MM:SS-HH:MM:SS` 文本注入 prompt。
- Prompt 日志记录：`ai_summary/src/prompt-logger.js`（PromptLogger）在各粒度的 `_run*` 方法中，prompt 构建后调用 `promptLogger.log(granularity, timestamp, contents)` 持久化。存储路径: `{summary.directory}/prompt-logs/{YYYY-MM-DD}/{粒度}/HH-mm.txt`。
- 提示词构建：`ai_summary/src/prompt-builder.js`（PromptBuilder.build2min/build10min/build1h）组装系统提示、焦点窗口时间线、历史输入与截图。历史总结头部时间使用完整跨度展示（开始时间-结束时间），而非单时间点。
- Token 用量跟踪：`ai_summary/src/token-tracker.js`（TokenTracker）在每次 Gemini API 调用后记录 `usageMetadata` 中的 token 计数。`GeminiClient.generate()` 返回 `{text, usageMetadata}`，各粒度的 `_run*` 方法调用 `tokenTracker.record(granularity, usageMetadata)` 记录。数据按日期存储于 `{summary.directory}/token-stats/YYYY-MM-DD.json`，按会话（session）分组，支持按分钟/粒度/时间范围查询。

## 4. Output Schema (各粒度 JSON 字段)

### 2min 级别输出
- 字段：category_type（列表）、category_name（列表）、subtask_name（列表）、task_status、interaction_mode、browse_content、operate_action、core_action、context、content_change、progress、blockers、next_intent、confidence、duration_minutes。
- category_type/category_name/subtask_name 均为列表（1~3 个元素），一一对应。支持一个 2min 时段内多活动归类。task_label 已移除，由 category_name 列表完全取代。
- 基于 Todo List 的任务/行为归类，新建类型由 `TodoWriter` 自动回写到 JSON 文件（支持列表格式逐项处理）。
- 浏览/操作区分规则与字段说明：`ai_summary/src/prompt-builder.js`。
- duration_minutes 以 category_name[0]（主活动）连续出现次数 × 2 计算。
- 断档提示与重新计数：`ai_summary/src/prompt-builder.js` 与 `ai_summary/src/summary-scheduler.js`。
- 旧数据兼容：无 category_name 的旧数据通过 task_label[0] 回退；无 category_type 的默认为"行为"。

### 10min 级别输出
- 字段：task_main、activity_timeline、key_progress、key_objects、content_change、blockers、next_step、confidence。
- activity_timeline 由模型从 2min 总结中提炼，每条包含 label、category_type、start_time（HH:MM）、end_time（HH:MM）、minutes、subtasks，表示一段连续活动的起止时间和归类信息。
- 模型从 2min 总结的 category_name 列表中展开各个活动，推算起止时间，合并相邻同类活动，过滤累计 <3 分钟的零散活动。
- 旧数据兼容：若 2min 总结中 category_name 为字符串则视为单元素列表；若无 category_name 但有 task_label 则用 task_label[0] 作为 label。
- 聚合时优先提炼操作动作并过滤纯浏览噪声：`ai_summary/src/prompt-builder.js` (_get10minPrompt)。

### 1h 级别输出
- 字段：achievements、task_chain、time_distribution、miscellaneous、key_output、blockers、next_direction、confidence。
- time_distribution/miscellaneous 每条包含 label、category_type、minutes、subtasks，聚合来自 10min 的 activity_timeline。
- 小时级别以 10min 的实际操作为主线并过滤纯浏览噪声：`ai_summary/src/prompt-builder.js:220-224`。

### 无变化模板记录（各粒度共有字段）
- `no_change: true` — 标记此记录为截图/子级无变化的模板记录，非 AI 生成。
- `skip_reason: string` — 跳过原因描述。
- 2min 模板额外字段: `screenshots_compared`（比对的截图数量）。
- 10min 模板额外字段: `no_change_2min_count`（无变化的 2min 子级数量）。
- 1h 模板额外字段: `no_change_10min_count`（无变化的 10min 子级数量）。
- 各粒度模板的其余字段与正常 AI 总结格式一致（填充默认值），保证上层聚合读取兼容。

## 5. Design Rationale
- **inline 图片:** 参考文档要求不使用 files 系统，直接 base64 内联上传截图。
- **JSON 输出:** Prompt 要求 AI 严格输出 JSON，解析失败时降级保存原始文本。
- **与截图服务解耦:** 通过文件系统读取截图，两个服务可独立启停。
- **递增重试:** API 调用失败按递增延迟重试，避免限频时频繁请求。
- **活动持续时间逐层聚合:** 2min 级别由 AI 从历史上下文推算 `duration_minutes`，10min 级别由模型直接输出带起止时间的 `activity_timeline`（含 start_time/end_time/minutes），1h 级别进一步聚合为 `time_distribution` + `miscellaneous`。下层新增字段通过 `_formatHistorySummaries()` 自动序列化传递到上层 prompt，无需额外代码改动（`ai_summary/src/prompt-builder.js:117-133`）。
- **杂项活动归类（1h）:** 小时级别将累计 <5 分钟的零散活动归入 `miscellaneous`，使主要活动的时间占比一目了然，杂项集中查阅不遗漏。
- **时间断档检测:** `_detectTimeGap()` 比较最新历史总结的时间戳与当前时间，差距超过 2 倍粒度间隔视为服务中断（2min 基础粒度即 >4 分钟）。断档信息注入 prompt 通知 AI：不要累加中断前的 `duration_minutes`，`task_status` 应标注为"继续"（`ai_summary/src/summary-scheduler.js:134-166`，`ai_summary/src/prompt-builder.js:33-43`）。
- **停止时间断点:** 基于 `schedule.stop_times` 设定自动退出时间点，避免服务长时间空转（`ai_summary/main.js:156-175`）。
- **Token 用量双层存储:** 内存中维护本次会话统计（按粒度汇总），同时逐条持久化到 JSON 文件。文件以日期为单位，内含多个 session 的记录，支持 Electron UI 跨会话查询。每条记录包含精确到分钟的时间标签（`minute` 字段），使 UI 可按任意时间范围（如 10:11-10:30）筛选和聚合。
- **GeminiClient 返回值变更:** `generate()` 从返回 `string` 改为 `{text, usageMetadata}`，`usageMetadata` 包含 `promptTokenCount/candidatesTokenCount/totalTokenCount/promptTokensDetails/thoughtsTokenCount`，由调用方决定是否传给 TokenTracker。
- **焦点窗口集成（可选依赖）:** `ActiveWindowCollector` 优先加载 `ai_summary/src/active-window-monitor.js` 与 `ai_summary/src/get-active-window.scpt`（避免打包后跨目录模块缺失），并保留开发环境回退路径。`main.js` 中以 try-catch 初始化，失败不影响主流程。采集器以 1 秒间隔轮询，内部维护时间线（按应用名+窗口标题识别并合并相邻同窗口条目），各粒度通过时间范围查询获取对应窗口信息，格式化为 `"完整焦点窗口名(应用名-窗口标题)" HH:MM:SS-HH:MM:SS` 注入 prompt。
- **Prompt 日志持久化:** `PromptLogger` 在每次 prompt 构建后将完整内容（图片用占位符替代）保存为文本文件。按 `{summary.directory}/prompt-logs/{YYYY-MM-DD}/{粒度}/HH-mm.txt` 组织，2min/10min/1h 分开存放，便于按日期和粒度回溯查看。日志记录失败仅打印警告不中断主流程。
- **截图无变化跳过:** `ScreenshotComparer` 使用 `Buffer.equals()` 精确比对所有截图，全部一致则判定为屏幕无变化。跳过 API 请求，改用本地模板记录（带 `no_change: true` 标记）。模板记录保存在与正常总结相同的目录和格式中，保证上层聚合读取兼容。10min 级检查所有 2min 子级是否全部 `no_change`，1h 级检查所有 10min 子级，实现逐级向上传播。跳过次数计入 `stats.skipped`，停止时打印统计。prompt 日志中也会记录跳过事件。
