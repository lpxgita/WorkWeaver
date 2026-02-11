# AI 总结模块 - 架构设计文档

## 1. 项目概述

### 1.1 目标
读取 `auto_screenshot` 产生的截图文件，调用 Google Gemini API，按 1 分钟 / 10 分钟 / 1 小时三个时间粒度生成结构化总结，并持久化存储供跨时间聚合使用。

### 1.2 核心需求
- 每分钟读取最近 12 张截图 + 过去 9 条 1min 总结 → 生成 1min 总结
- 每 10 分钟读取最近 10 条 1min 总结 + 过去 5 条 10min 总结 → 生成 10min 总结
- 每 1 小时读取最近 6 条 10min 总结 + 更早 6 条 10min 总结 → 生成 1h 总结
- 总结结果持久化为 JSON 文件，按日期+粒度组织
- 通过 YAML 配置驱动，与截图服务解耦

---

## 2. 系统架构

### 2.1 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                       AI 总结服务                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │   配置模块   │    │  Gemini客户端│    │   日志模块   │         │
│  │  (Config)   │───►│ (GeminiClient)│──►│  (Logger)   │         │
│  └─────────────┘    └──────┬──────┘    └─────────────┘         │
│         │                  │                                    │
│         │           ┌──────▼──────┐                             │
│         │           │  总结调度器  │                             │
│         └──────────►│(SummaryScheduler)                         │
│                     └──────┬──────┘                             │
│                            │                                    │
│                     ┌──────▼──────┐    ┌─────────────┐         │
│                     │  截图读取器  │    │  总结存储    │         │
│                     │(ScreenshotReader)│(SummaryStore)│         │
│                     └─────────────┘    └─────────────┘         │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  外部依赖: @google/genai, yaml                                  │
│  数据来源: auto_screenshot/screenshots/                          │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 模块职责

| 模块 | 文件 | 职责 |
|------|------|------|
| **配置模块** | `src/config.js` | 加载验证 YAML 配置 |
| **Gemini 客户端** | `src/gemini-client.js` | 封装 Google Gemini API 调用，构建多图+文本请求 |
| **截图读取器** | `src/screenshot-reader.js` | 按时间范围检索截图文件，读取为 Buffer |
| **总结存储** | `src/summary-store.js` | 总结结果的持久化读写（JSON 文件） |
| **提示词构建器** | `src/prompt-builder.js` | 按时间粒度组装 system prompt + 用户输入 |
| **总结调度器** | `src/summary-scheduler.js` | 定时触发各粒度总结任务，编排完整流程 |
| **日志模块** | `src/logger.js` | 复用 auto_screenshot 的日志模块设计 |
| **主入口** | `main.js` | CLI 启动、模块装配、信号处理 |

---

## 3. 目录结构

```
work_monitor/ai_summary/
├── main.js                    # 主入口
├── package.json               # 项目配置
├── config.example.yaml        # 配置文件示例
├── config.yaml                # 用户配置（gitignore）
├── src/
│   ├── config.js              # 配置加载模块
│   ├── gemini-client.js       # Gemini API 封装
│   ├── screenshot-reader.js   # 截图文件检索与读取
│   ├── summary-store.js       # 总结结果持久化
│   ├── prompt-builder.js      # 提示词构建
│   ├── summary-scheduler.js   # 总结调度器
│   └── logger.js              # 日志模块
├── logs/                      # 日志目录
└── summaries/                 # 总结结果存储目录
    └── 2026-02-05/
        ├── 1min/              # 1分钟级别总结
        │   ├── 14-30.json
        │   ├── 14-31.json
        │   └── ...
        ├── 10min/             # 10分钟级别总结
        │   ├── 14-30.json
        │   ├── 14-40.json
        │   └── ...
        └── 1h/                # 1小时级别总结
            ├── 14-00.json
            ├── 15-00.json
            └── ...
```

---

## 4. 配置文件设计

```yaml
# config.yaml - AI 总结服务配置

# Gemini API 设置
gemini:
  api_key: ""                          # Google API Key（必填）
  model: "gemini-3-flash-preview"      # 模型名称
  max_retries: 3                       # API 调用失败重试次数
  retry_delay: 2                       # 重试间隔（秒）

# 截图数据源
screenshot:
  directory: "../auto_screenshot/screenshots"  # 截图目录（相对或绝对）
  format: "jpeg"                               # 截图格式
  interval: 5                                  # 截图间隔（秒），用于计算每分钟截图数

# 总结设置
summary:
  directory: "./summaries"             # 总结输出目录
  granularity:
    1min:
      enabled: true
      screenshots_per_minute: 12       # 每分钟截图数（60/interval）
      history_minutes: 9               # 需要读取过去多少分钟的1min总结
    10min:
      enabled: true
      history_count: 5                 # 需要读取过去多少个10min总结
    1h:
      enabled: true
      recent_10min_count: 6            # 最近的10min总结数
      earlier_10min_count: 6           # 更早的10min总结数

# 时间调度
schedule:
  enabled: false
  start_time: "08:00"
  end_time: "22:00"
  days:
    - Mon
    - Tue
    - Wed
    - Thu
    - Fri

# 日志设置
logging:
  level: "info"
  file: "./logs/ai-summary.log"
  console: true
```

---

## 5. 核心流程

### 5.1 总结调度流程

```
启动 → main.js
  │
  ├─ 加载配置 → Config.load()
  ├─ 初始化模块
  │    ├─ Logger
  │    ├─ ScreenshotReader（指向截图目录）
  │    ├─ SummaryStore（指向总结目录）
  │    ├─ GeminiClient（API Key + 模型）
  │    ├─ PromptBuilder（加载各粒度 prompt 模板）
  │    └─ SummaryScheduler（注入所有模块）
  ├─ 注册 SIGINT/SIGTERM → 优雅关闭
  └─ scheduler.start()
       │
       ├─ setInterval(run1min, 60000)      每分钟触发
       ├─ setInterval(run10min, 600000)    每10分钟触发
       └─ setInterval(run1h, 3600000)      每小时触发
```

### 5.2 1分钟总结流程

```
run1min() 触发
  │
  ├─ 1. ScreenshotReader.getRecentScreenshots(1min)
  │      └─ 扫描截图目录，按时间排序，取最近12张
  │
  ├─ 2. SummaryStore.getRecentSummaries('1min', 9)
  │      └─ 读取过去9条1min总结JSON
  │
  ├─ 3. PromptBuilder.build1min(screenshots, historySummaries)
  │      ├─ 构建 system prompt（来自 task/2.ai总结板块.md 的1min模板）
  │      ├─ 将12张截图转为 types.Part.from_bytes（inline）
  │      └─ 将9条历史总结拼接为文本
  │
  ├─ 4. GeminiClient.generate(contents)
  │      ├─ 调用 client.models.generate_content()
  │      ├─ 失败时重试（最多 max_retries 次）
  │      └─ 返回 AI 响应文本
  │
  ├─ 5. 解析 AI 响应为结构化对象
  │
  └─ 6. SummaryStore.save('1min', timestamp, parsedResult)
         └─ 写入 summaries/{date}/1min/{time}.json
```

### 5.3 10分钟总结流程

```
run10min() 触发
  │
  ├─ 1. SummaryStore.getRecentSummaries('1min', 10)
  │      └─ 最近10条1min总结
  │
  ├─ 2. SummaryStore.getRecentSummaries('10min', 5)
  │      └─ 过去5条10min总结
  │
  ├─ 3. PromptBuilder.build10min(recent1min, history10min)
  │
  ├─ 4. GeminiClient.generate(contents)   （纯文本，无图片）
  │
  ├─ 5. 解析响应
  │
  └─ 6. SummaryStore.save('10min', timestamp, parsedResult)
```

### 5.4 1小时总结流程

```
run1h() 触发
  │
  ├─ 1. SummaryStore.getRecentSummaries('10min', 6)
  │      └─ 最近6条10min总结
  │
  ├─ 2. SummaryStore.getEarlierSummaries('10min', 6, skip=6)
  │      └─ 更早6条10min总结
  │
  ├─ 3. PromptBuilder.build1h(recent10min, earlier10min)
  │
  ├─ 4. GeminiClient.generate(contents)   （纯文本，无图片）
  │
  ├─ 5. 解析响应
  │
  └─ 6. SummaryStore.save('1h', timestamp, parsedResult)
```

---

## 6. 数据流设计

### 6.1 截图 → 总结数据流

```
auto_screenshot/screenshots/
    └── 2026-02-05/
        ├── 2026-02-05_14-30-00_1.jpeg  ─┐
        ├── 2026-02-05_14-30-05_1.jpeg   │  ScreenshotReader
        ├── ...                          │  读取最近12张
        └── 2026-02-05_14-30-55_1.jpeg  ─┘
                                          │
                                          ▼
                                   PromptBuilder.build1min()
                                          │
                                          ▼ (inline 图片 + 历史总结文本)
                                   GeminiClient.generate()
                                          │
                                          ▼
                                   SummaryStore.save('1min')
                                          │
                                          ▼
                              summaries/2026-02-05/1min/14-31.json
```

### 6.2 总结 → 聚合数据流

```
1min 总结 ──(10条)──► PromptBuilder.build10min() ──► 10min 总结
                                                          │
10min 总结 ──(12条)──► PromptBuilder.build1h() ──► 1h 总结
```

---

## 7. 总结存储格式

### 7.1 1min 总结 JSON

```json
{
    "timestamp": "2026-02-05T14:31:00.000Z",
    "granularity": "1min",
    "task_label": ["编辑代码", "work_monitor项目"],
    "task_status": "继续",
    "core_action": "在 VS Code 中编辑 scheduler.js 文件",
    "context": "VS Code / auto_screenshot/src/scheduler.js",
    "content_change": "修改",
    "progress": "推进",
    "blockers": "无",
    "next_intent": "继续完善调度逻辑",
    "confidence": "高"
}
```

### 7.2 10min 总结 JSON

```json
{
    "timestamp": "2026-02-05T14:40:00.000Z",
    "granularity": "10min",
    "task_main": "编辑 auto_screenshot 调度器模块 (继续)",
    "key_progress": "完成 scheduler.js 的时间窗口限制逻辑",
    "key_objects": "VS Code / scheduler.js / config.js",
    "content_change": "新增时间限制校验方法",
    "blockers": "无",
    "next_step": "编写存储模块",
    "confidence": "高"
}
```

### 7.3 1h 总结 JSON

```json
{
    "timestamp": "2026-02-05T15:00:00.000Z",
    "granularity": "1h",
    "achievements": ["完成调度器模块", "完成存储模块基础功能"],
    "task_chain": "调度器设计 → 时间限制 → 存储模块 → 文件命名",
    "key_output": "scheduler.js, storage.js 两个模块代码",
    "blockers": "无",
    "next_direction": "开始截图引擎模块开发",
    "confidence": "高"
}
```

---

## 8. 错误处理设计

| 错误类型 | 处理方式 | 示例 |
|----------|----------|------|
| 配置错误 | 启动失败，退出 | API Key 为空 |
| API 调用失败 | 重试 N 次后记录日志，跳过本次 | 网络超时、429 限频 |
| 截图文件不足 | 记录警告，使用可用截图继续 | 服务刚启动不足12张 |
| 历史总结不足 | 记录警告，使用可用总结继续 | 服务刚启动无历史 |
| 响应解析失败 | 记录原始响应到日志，保存原始文本 | AI 输出格式异常 |
| 文件写入失败 | 记录日志，跳过 | 磁盘满 |

---

## 9. 依赖清单

| 包名 | 用途 |
|------|------|
| `@google/genai` | Google Gemini API 客户端 |
| `yaml` | YAML 配置解析 |

---

## 10. 实现优先级

### Phase 1: 核心功能 (MVP)
1. [ ] 配置模块 (Config)
2. [ ] 日志模块 (Logger)
3. [ ] 截图读取器 (ScreenshotReader)
4. [ ] 总结存储 (SummaryStore)
5. [ ] Gemini 客户端 (GeminiClient)
6. [ ] 提示词构建器 (PromptBuilder)
7. [ ] 总结调度器 (SummaryScheduler)
8. [ ] 主入口 (main.js)

### Phase 2: 增强
1. [ ] 响应解析容错（正则/JSON双模式）
2. [ ] 截图不足时的降级策略
3. [ ] API 限频自适应（动态调整间隔）

### Phase 3: 扩展
1. [ ] 日报/周报自动生成
2. [ ] HTTP API 查询总结
3. [ ] 与截图服务共享配置
