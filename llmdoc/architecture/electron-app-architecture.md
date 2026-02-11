# Electron 桌面应用 - 架构

## 1. Identity
- **What it is:** 基于 Electron 的图形化桌面客户端，统一管理 Work Monitor 的所有服务。
- **Purpose:** 提供可视化界面控制截图服务与 AI 总结服务的启停，浏览截图、查看 AI 总结、编辑配置、实时查看日志，并支持打包为 macOS 原生应用。

## 2. Core Components

| 模块 | 文件 | 职责 |
|------|------|------|
| 主进程 | `electron-app/main.js` | 窗口创建、IPC 处理注册、服务事件转发、应用生命周期管理 |
| 预加载脚本 | `electron-app/preload.js` | 通过 `contextBridge` 安全暴露 IPC API 到渲染进程 |
| 服务管理 | `electron-app/service-manager.js` (`ServiceManager`) | 子进程启动/停止、状态跟踪、日志收集、事件发射 |
| 配置管理 | `electron-app/config-manager.js` (`ConfigManager`) | 读写 `config.yaml`，YAML 序列化/反序列化 |
| 数据读取 | `electron-app/summary-reader.js` (`SummaryReader`) | 读取总结 JSON 文件和截图文件列表 |
| Todo 数据存储 | `electron-app/todo-store.js` (`TodoStore`) | 任务与行为目录的 CRUD，JSON 文件持久化 |
| 界面布局 | `electron-app/renderer/index.html` | 7 个页面：仪表盘、截图服务、AI 总结、Todo List、API 用量、配置、日志 |
| 界面样式 | `electron-app/renderer/styles.css` | 深色主题 macOS 风格，响应式布局 |
| 前端逻辑 | `electron-app/renderer/app.js` (`App`) | 页面导航、服务控制、数据加载、实时日志追加、Todo 管理 |
| 打包辅助 | `electron-app/scripts/install-deps.js` | 打包前安装 auto_screenshot 和 ai_summary 的生产依赖 |

- 配置页面字段：`electron-app/renderer/index.html`（配置表单）与 `electron-app/renderer/app.js`（loadConfigToForm/saveConfig）支持编辑 `schedule.stop_times`。
- API 用量统计页面：`electron-app/renderer/index.html`（page-token-stats）与 `electron-app/renderer/app.js`（loadTokenStatsDates/loadTokenStats/renderTokenStats）。支持按日期、会话、时间范围筛选，展示总览卡片、按粒度分类、按分钟时间线三个区域。
- Todo List 页面：`electron-app/renderer/index.html`（page-todo）与 `electron-app/renderer/app.js`（loadTodos/renderTodos/loadBehaviors/renderBehaviors）。支持任务/行为两个 Tab，主任务 CRUD、子任务管理、描述编辑、行为目录管理、标题/名称重命名（含历史数据回写）。数据通过 `electron-app/todo-store.js`（`TodoStore`）持久化到 JSON 文件。
- Token 统计数据读取：`electron-app/summary-reader.js`（getTokenStatsDates/getTokenStats）读取 `{summary.directory}/token-stats/YYYY-MM-DD.json` 文件，支持按会话和时间范围过滤。
- AI 总结页面时间轴：`electron-app/renderer/app.js`（renderSummaryTimeline/buildSummaryTimelineData）在 10min 粒度下渲染甘特图式时间轴，数据来源为 10min 总结的 `activity_timeline` 字段（含 start_time/end_time），过滤累计 <3 分钟的短事件，支持横向滚动、时间刻度和当前时间标记。采用泳道（lane）模型：相同 label 的活动合并到同一行，一行内可有多个不连续的色块段（segments）。短时间活动的标签文字允许溢出 bar 区域向后延伸显示完整名称。

## 3. Execution Flow (LLM Retrieval Map)

### 3.1 应用启动流程

```
Electron 启动 → main.js
  ├─ 1. 计算 projectRoot（开发环境: __dirname/.. | 打包环境: process.resourcesPath）
  ├─ 2. getUserConfigPath()
  │       ├─ 开发环境: projectRoot/config.yaml
  │       └─ 打包环境: app.getPath('userData')/config.yaml
  │            └─ 首次运行: 从 Resources/config.yaml 复制到 userData 目录
  ├─ 3. new ServiceManager(projectRoot, configPath)  服务进程管理器
  ├─ 4. new ConfigManager(configPath)                配置文件管理
  ├─ 5. new SummaryReader(projectRoot)               数据读取器
  ├─ 6. 注册 IPC handlers (service:*, config:*, summary:*, screenshot:*, token-stats:*)
  ├─ 7. app.whenReady() → createWindow()
  │       ├─ BrowserWindow (1200x800, hiddenInset 标题栏)
  │       └─ loadFile('renderer/index.html')
  └─ 8. 绑定 ServiceManager 事件 → webContents.send() 转发到渲染进程
```

### 3.2 服务启停流程

```
渲染进程按钮点击
  → App.toggleService('screenshot')
  → window.api.startService('screenshot')     [preload → ipcRenderer.invoke]
  → ipcMain.handle('service:start')           [main.js]
  → ServiceManager.startService('screenshot')
      ├─ spawn(process.execPath, [scriptPath, '--config', configPath])
      │   ├─ env: ELECTRON_RUN_AS_NODE=1
      │   └─ cwd: auto_screenshot/ 目录
      ├─ 监听 child.stdout → _addLog() → emit('log')
      ├─ 监听 child.stderr → _addLog() → emit('log')
      └─ 监听 child.exit  → 更新状态 → emit('service-stopped')

ServiceManager.emit('log')
  → main.js 监听 → webContents.send('log-update')
  → preload.js ipcRenderer.on('log-update')
  → App.appendLogEntry() 实时追加到日志面板
```

说明：渲染进程的按钮与交互事件由 `electron-app/renderer/app.js` (`bindActions`) 统一绑定，`electron-app/renderer/index.html` 不使用内联事件属性，确保在 CSP 约束下正常触发。

### 3.3 IPC 通信接口

```
渲染进程 (app.js)
  ↕ window.api (preload.js contextBridge)
  ↕ ipcRenderer.invoke / ipcRenderer.on
  ↕ ipcMain.handle / webContents.send
主进程 (main.js)
  ↕ ServiceManager / ConfigManager / SummaryReader
```

| IPC 通道 | 方向 | 说明 |
|----------|------|------|
| `service:start` | 渲染→主 | 启动指定服务 |
| `service:stop` | 渲染→主 | 停止指定服务 |
| `service:start-all` | 渲染→主 | 一键启动全部服务（截图+AI总结） |
| `service:stop-all` | 渲染→主 | 一键停止全部服务 |
| `service:status` | 渲染→主 | 获取所有服务状态 |
| `service:logs` | 渲染→主 | 获取指定服务日志 |
| `service:clear-logs` | 渲染→主 | 清除指定服务日志 |
| `config:load` | 渲染→主 | 读取 config.yaml |
| `config:save` | 渲染→主 | 保存 config.yaml |
| `config:load-example` | 渲染→主 | 读取示例配置 |
| `summary:dates` | 渲染→主 | 获取可用的总结日期 |
| `summary:get` | 渲染→主 | 获取指定日期+粒度的总结 |
| `screenshot:recent` | 渲染→主 | 获取最近截图列表 |
| `screenshot:read` | 渲染→主 | 读取截图为 base64 |
| `screenshot:cleanup` | 渲染→主 | 清理过期截图（返回删除/稀疏统计） |
| `token-stats:dates` | 渲染→主 | 获取可用的 token 统计日期 |
| `token-stats:query` | 渲染→主 | 查询 token 统计（支持日期/会话/时间范围） |
| `todo:list` | 渲染→主 | 获取所有任务（含子任务） |
| `todo:create` | 渲染→主 | 创建主任务 |
| `todo:update` | 渲染→主 | 更新主任务（标题/描述/完成状态） |
| `todo:delete` | 渲染→主 | 删除主任务及所有子任务 |
| `todo:create-subtask` | 渲染→主 | 创建子任务 |
| `todo:update-subtask` | 渲染→主 | 更新子任务 |
| `todo:delete-subtask` | 渲染→主 | 删除子任务 |
| `behavior:list` | 渲染→主 | 获取所有行为 |
| `behavior:create` | 渲染→主 | 创建行为 |
| `behavior:update` | 渲染→主 | 更新行为 |
| `behavior:delete` | 渲染→主 | 删除行为 |
| `todo:rename` | 渲染→主 | 重命名任务标题（回写历史总结数据） |
| `behavior:rename` | 渲染→主 | 重命名行为名称（回写历史总结数据） |
| `todo:merge` | 渲染→主 | 合并任务/行为（删除源、回写历史总结数据） |
| `log-update` | 主→渲染 | 实时日志推送 |
| `service-change` | 主→渲染 | 服务状态变更通知 |

### 3.4 打包流程

```
npm run build
  ├─ prebuild: node scripts/install-deps.js
  │     ├─ cd auto_screenshot && npm install --production
  │     └─ cd ai_summary && npm install --production
  └─ electron-builder --mac
        ├─ 打包 electron-app/ 代码为 asar
        ├─ 复制 extraResources:
        │     ├─ auto_screenshot/ → Resources/auto_screenshot/
        │     ├─ ai_summary/     → Resources/ai_summary/
        │     ├─ config.yaml     → Resources/config.yaml
        │     └─ config.example.yaml → Resources/config.example.yaml
        └─ 输出:
              ├─ dist/mac-arm64/Work Monitor.app
              └─ dist/Work Monitor-*.dmg
```

## 4. Design Rationale
- **进程隔离:** 使用 `spawn` + `ELECTRON_RUN_AS_NODE` 启动子服务，避免 Electron 主进程被阻塞，服务崩溃不影响 GUI。
- **contextBridge 安全模型:** 渲染进程完全隔离，仅通过 `preload.js` 暴露的白名单 API 与主进程通信，遵循 Electron 安全最佳实践。
- **事件驱动日志:** ServiceManager 继承 EventEmitter，日志通过事件链实时推送到渲染进程，无需轮询。
- **CSP 与事件绑定:** `electron-app/renderer/index.html` 禁用内联事件，交互由 `electron-app/renderer/app.js` (`bindActions`) 绑定，避免 CSP 阻止按钮与 tab 行为。
- **extraResources 部署:** 子模块作为外部资源打包，保持独立的 node_modules，避免与 Electron 依赖冲突。
- **路径适配:** `projectRoot` 在开发和打包环境自动切换（`__dirname/..` vs `process.resourcesPath`），子模块无需修改即可运行。
- **用户数据路径隔离:** 打包后配置文件存放在 `userData` 目录（`~/Library/Application Support/Work Monitor/config.yaml`），数据目录（summaries/logs）使用 `~/Documents/work_monitor/` 绝对路径，避免写入 `.app` 包内导致签名失效或升级丢失数据。
- **首次运行迁移:** 首次启动时自动从 `Resources/` 复制默认配置到 `userData`，后续所有读写操作指向 `userData` 中的副本。
- **时间轴泳道合并:** `buildSummaryTimelineData` 先合并连续同标签活动（间隔 <= 2 分钟），再按 label 分组到泳道（Map 保序）。返回 `{ lanes: [{ label, segments }] }` 结构，`renderSummaryTimeline` 每个 lane 渲染为一行，lane 内多个 segments 渲染为同行不连续色块。避免相同项目分散多行。
- **短活动标签溢出:** `.summary-timeline-row` 和 `.summary-timeline-bar` 设为 `overflow: visible`，标签文字使用独立 `span.summary-timeline-bar-label`（仅首段显示），允许超出 bar 宽度向右延伸。`.summary-timeline-canvas` 右侧预留 100px padding 防截断。
- **Todo 模块与 AI 总结集成:** Todo List 模块通过 JSON 文件（`todos.json` + `behaviors.json`）与 AI 总结服务交互：(1) `PromptBuilder` 在构建 prompt 时读取任务/行为目录注入上下文，引导 AI 基于用户定义的分类归类活动；(2) `TodoWriter` 在 2min 总结后解析 AI 响应，将新建的任务/子任务/行为回写到 JSON 文件；(3) Electron 通过 `--todo-dir` 参数传递数据目录给 ai_summary 服务。
- **重命名操作与历史回写:** 用户可在列表或详情弹窗中重命名任务标题/行为名称，重命名后自动遍历所有历史总结 JSON 文件将旧名称替换为新名称，保证历史时间数据归类一致。前端采用内联输入框交互（点击编辑按钮 → 标题变为输入框 → Enter/失焦提交、Esc 取消）。
- **合并操作与历史回写:** 用户可将任意任务/行为合并到另一个任务/行为中，源项消失。合并时遍历所有历史总结 JSON 文件，将源名称替换为目标名称，保证历史时间数据归类一致。
- **时间线筛选:** 前端时间轴支持按任务/行为名称多选筛选，从当天总结数据中动态提取筛选项。单选某个任务时可展开显示其子任务的时间分布。
- **一键启停全部服务:** 仪表盘顶部新增一键启停按钮（`electron-app/renderer/index.html` `.all-services-bar`），同时控制截图服务和 AI 总结服务。`ServiceManager.startAll()` 逐个启动未运行的服务（已运行的跳过），`ServiceManager.stopAll()` 并行停止所有服务。按钮状态通过 `updateStatusUI()` 实时同步：全部运行时显示"一键停止"（红色渐变），否则显示"一键启动"（绿蓝渐变），旁边提示文字动态反映当前状态。IPC 通道：`service:start-all` / `service:stop-all`。
