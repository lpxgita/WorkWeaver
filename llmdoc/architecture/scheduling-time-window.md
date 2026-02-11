# 调度器与时间窗口限制

## 1. Identity
- **What it is:** 定时任务调度器，控制截图执行频率与时间范围。
- **Purpose:** 按配置间隔执行截图，支持工作日与时间窗口限制，防止并发冲突。

## 2. Core Components
- `auto_screenshot/src/scheduler.js` (`Scheduler`): 调度器核心类。
- `auto_screenshot/src/config.js` (`Config.validate`): 校验 `schedule` 配置段。
- `auto_screenshot/config.example.yaml` (`schedule` 段): 时间限制配置示例。

## 3. Execution Flow (LLM Retrieval Map)
- `auto_screenshot/src/scheduler.js:35-76`（Scheduler.start/stop）启动定时器、停止并等待执行中的任务完成。
- `auto_screenshot/src/scheduler.js:83-130`（Scheduler.isAllowed/isAllowedDay/isWithinAllowedTime）按工作日与时间窗口判断是否允许截图。
- `auto_screenshot/src/scheduler.js:136-181`（Scheduler.executeTask）执行截图、保存、记录日志并更新执行次数。
- `auto_screenshot/main.js:81-174`（parseStopTimes/getNextStopTime/scheduleStopTimer）解析 stop_times 并计算下一次停止时间。
- `auto_screenshot/main.js:230-268`（shutdown/scheduleStopTimer 调用）触发自动停止并走优雅关闭流程。

## 4. Stop Mechanism
- `schedule.stop_times` 为可选时间断点列表，服务启动后会计算下一次停止时间并设置定时器（`auto_screenshot/main.js:154-173`）。
- 当 `schedule.enabled` 为 true 时，停止时间会受 `schedule.days` 限制；否则默认按每天生效（`auto_screenshot/main.js:159-162`）。
- 到达停止时间后触发 `shutdown`，与 SIGTERM 相同的优雅关闭路径（`auto_screenshot/main.js:230-250`）。

## 5. Design Rationale
- **并发控制:** `isExecuting` 标志避免截图任务堆叠（当截图耗时超过间隔时）。
- **时间转分钟数:** 将 HH:MM 转换为分钟总数进行比较，逻辑简单可靠。
- **轮询等待:** 关闭时以 100ms 轮询等待当前任务完成，避免强制中断。
- **停止时间断点:** 通过 stop_times 触发自动退出，避免服务长时间空转。
