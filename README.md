# WorkWeaver

基于屏幕截图与 AI 总结的工作活动监控系统。定时截取屏幕，通过 Google Gemini 按 1分钟 / 10分钟 / 1小时 三个时间粒度自动生成结构化工作总结，帮助你回顾和分析每日工作轨迹。

## 功能特性

- **自动截图** — 按固定间隔截取屏幕，支持多显示器、图像缩放、按日期归档
- **多粒度 AI 总结** — 1min 级别提取任务标签与核心动作，10min 级别串联任务轨迹，1h 级别输出阶段成果与时间分布
- **活动持续时间统计** — 自动追踪每个活动的持续时长，在各粒度逐层聚合
- **时间断档检测** — 服务中断后重启时自动检测空档，避免 AI 错误累加中断前的数据
- **Electron 桌面应用** — 图形化管理界面，一键启停服务，实时查看日志，浏览截图与总结
- **macOS 打包** — 支持打包为 `.app` / `.dmg`，开箱即用
- **时间窗口限制** — 可配置仅在工作时间和工作日运行

## 系统架构

```
┌─────────────────────────────────────────────────┐
│              Electron 桌面应用                     │
│   (服务控制 / 截图浏览 / 总结查看 / 配置编辑 / 日志)  │
└──────────────┬────────────────┬──────────────────┘
               │ spawn          │ spawn
    ┌──────────▼──────┐  ┌─────▼────────────┐
    │  auto_screenshot │  │   ai_summary     │
    │  定时截图服务      │  │  AI 总结服务      │
    │                  │  │                  │
    │  screenshot-     │  │  Google Gemini   │
    │  desktop + sharp │  │  @google/genai   │
    └────────┬─────────┘  └──────┬───────────┘
             │                   │
             ▼                   ▼
      ~/Documents/         ~/Documents/
      auto_screenshot/     work_monitor/summaries/
      (截图文件)            (JSON 总结)
```

三个子系统共享一份 `config.yaml` 配置文件。

## 快速开始

### 环境要求

- **Node.js** >= 18
- **macOS**（截图功能依赖 macOS 原生 API）
- **Google Gemini API Key**（用于 AI 总结）

### 1. 安装依赖

```bash
# 截图服务
cd auto_screenshot && npm install

# AI 总结服务
cd ../ai_summary && npm install

# Electron 桌面应用（可选）
cd ../electron-app && npm install
```

### 2. 配置

复制配置模板并填入 API Key：

```bash
cp config.example.yaml config.yaml
```

编辑 `config.yaml`，至少需要配置：

```yaml
# Gemini API 密钥（必填）
gemini:
  api_key: "你的 API Key"

# 截图存储路径（推荐使用 ~ 绝对路径）
storage:
  directory: "~/Documents/auto_screenshot"

# 总结输出路径
summary:
  directory: "~/Documents/work_monitor/summaries"
```

完整配置项说明见 [config.example.yaml](config.example.yaml)。

### 3. 运行

#### 方式一：命令行独立运行

```bash
# 启动截图服务
cd auto_screenshot && node main.js

# 启动 AI 总结服务（新终端）
cd ai_summary && node main.js
```

两个服务均默认读取上级目录的 `config.yaml`，也可通过 `--config` 指定：

```bash
node main.js --config /path/to/config.yaml
```

#### 方式二：Electron 桌面应用

```bash
cd electron-app && npm start
```

在 GUI 中可一键启停截图服务和 AI 总结服务，并实时查看日志、浏览截图和总结数据。

## AI 总结输出示例

### 1分钟级别

```json
{
  "task_label": ["work_monitor开发", "Agent规则配置"],
  "task_status": "继续",
  "core_action": "对比 withScout 指令与文档同步逻辑的差异",
  "context": "Cursor / .cursor/skills / AGENTS.md",
  "content_change": "新增",
  "progress": "推进",
  "blockers": "无",
  "next_intent": "确认技能集成生效",
  "confidence": "高",
  "duration_minutes": 12
}
```

### 10分钟级别

```json
{
  "task_main": "AI总结系统的Agent架构重构与服务逻辑修复",
  "activity_timeline": [
    {"label": "work_monitor开发", "minutes": 7},
    {"label": "Agent规则配置", "minutes": 3}
  ],
  "key_progress": "完成存储路径重定向与时间断档检测逻辑",
  "blockers": "无",
  "next_step": "完成核心文件的批量代码应用",
  "confidence": "高"
}
```

### 1小时级别

```json
{
  "achievements": [
    "成功构建并打包 Electron 桌面应用",
    "完成活动持续时间统计功能开发"
  ],
  "task_chain": "Electron 打包 -> 功能迭代 -> 架构可视化",
  "time_distribution": [
    {"label": "work_monitor开发", "minutes": 35},
    {"label": "远程调试", "minutes": 15}
  ],
  "miscellaneous": [
    {"label": "账单审计", "minutes": 3}
  ],
  "key_output": "Work Monitor-1.0.0-arm64.dmg",
  "confidence": "高"
}
```

## macOS 打包

```bash
cd electron-app

# 打包为 .dmg + .zip
npm run build

# 仅打包 .dmg
npm run build:dmg
```

产物位于 `electron-app/dist/` 目录。打包后数据存储在用户目录下，不会写入 `.app` 内部：

| 数据 | 路径 |
|------|------|
| 配置文件 | `~/Library/Application Support/Work Monitor/config.yaml` |
| 截图文件 | `~/Documents/auto_screenshot/` |
| AI 总结 | `~/Documents/work_monitor/summaries/` |
| 日志文件 | `~/Documents/work_monitor/logs/` |

## 项目结构

```
work_monitor/
├── config.yaml                # 统一配置文件
├── config.example.yaml        # 配置模板（含完整注释）
├── auto_screenshot/           # 截图服务
│   ├── main.js                #   CLI 入口
│   └── src/
│       ├── config.js          #   配置加载与校验
│       ├── screenshot.js      #   截图引擎（多显示器）
│       ├── scheduler.js       #   定时调度器
│       ├── storage.js         #   文件存储
│       └── logger.js          #   日志
├── ai_summary/                # AI 总结服务
│   ├── main.js                #   CLI 入口
│   └── src/
│       ├── config.js          #   配置加载与校验
│       ├── gemini-client.js   #   Gemini API 封装
│       ├── screenshot-reader.js #  截图文件检索
│       ├── summary-store.js   #   总结存储（JSON）
│       ├── prompt-builder.js  #   提示词构建（含断档检测提示）
│       ├── summary-scheduler.js # 多粒度调度（含断档检测）
│       └── logger.js          #   日志
├── electron-app/              # Electron 桌面应用
│   ├── main.js                #   主进程
│   ├── preload.js             #   安全 API 桥接
│   ├── service-manager.js     #   子进程管理
│   ├── config-manager.js      #   配置读写
│   ├── summary-reader.js      #   数据读取
│   ├── scripts/
│   │   └── install-deps.js    #   打包前依赖安装
│   └── renderer/
│       ├── index.html         #   界面布局
│       ├── styles.css         #   深色主题样式
│       └── app.js             #   前端逻辑
├── task/                      # 需求文档
└── llmdoc/                    # 项目文档（LLM 友好格式）
```

## 配置说明

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `screenshot.interval` | 截图间隔（秒） | `5` |
| `screenshot.format` | 图片格式 | `jpeg` |
| `screenshot.quality` | 图片质量 (1-100) | `80` |
| `screenshot.dimension` | 图片尺寸比例 (25/50/75/100) | `100` |
| `storage.directory` | 截图存储目录 | `~/Documents/auto_screenshot` |
| `gemini.api_key` | Gemini API 密钥 | — |
| `gemini.model` | 模型名称 | `gemini-3-flash-preview` |
| `summary.directory` | 总结输出目录 | `~/Documents/work_monitor/summaries` |
| `schedule.enabled` | 是否启用时间限制 | `false` |
| `schedule.start_time` | 开始时间 | `08:00` |
| `schedule.end_time` | 结束时间 | `22:00` |
| `schedule.days` | 工作日 | `Mon-Fri` |

完整参考：[config.example.yaml](config.example.yaml)

## 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | Node.js |
| 截图 | [screenshot-desktop](https://github.com/bencevans/screenshot-desktop) |
| 图像处理 | [sharp](https://sharp.pixelplumbing.com/) |
| AI 引擎 | [Google Gemini](https://ai.google.dev/) (`@google/genai`) |
| 桌面应用 | [Electron](https://www.electronjs.org/) |
| 打包 | [electron-builder](https://www.electron.build/) |
| 配置 | [yaml](https://eemeli.org/yaml/) |

## 许可证

MIT
