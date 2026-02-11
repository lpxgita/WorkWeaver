/**
 * 提示词构建器模块
 * 按时间粒度组装 system prompt + 用户输入（图片/历史总结）
 * 支持注入 Todo List（任务/行为目录）信息辅助活动归类
 */

const fs = require('fs');
const path = require('path');

class PromptBuilder {
    /**
     * 创建提示词构建器
     * @param {GeminiClient} geminiClient - Gemini 客户端（用于构建图片 Part）
     * @param {Logger} logger - 日志模块
     * @param {Object} [options] - 可选配置
     * @param {string} [options.todoDataDir] - Todo 数据目录路径（含 todos.json / behaviors.json）
     */
    constructor(geminiClient, logger, options = {}) {
        this.geminiClient = geminiClient;
        this.logger = logger;
        this.todoDataDir = options.todoDataDir || null;
    }

    /**
     * 读取 Todo 任务列表和行为目录，格式化为 prompt 文本
     * @returns {string} 格式化后的文本，空字符串表示无数据或读取失败
     */
    _buildTodoContextText() {
        if (!this.todoDataDir) return '';

        try {
            let text = '';

            // 读取任务列表
            const todosFile = path.join(this.todoDataDir, 'todos.json');
            if (fs.existsSync(todosFile)) {
                const todos = JSON.parse(fs.readFileSync(todosFile, 'utf-8'));
                const activeTodos = todos.filter(t => !t.completed);
                if (activeTodos.length > 0) {
                    text += '普通任务\n';
                    for (const todo of activeTodos) {
                        text += `  ${todo.title}\n`;
                        if (todo.description) {
                            text += `  ${todo.description}\n`;
                        }
                        if (todo.children && todo.children.length > 0) {
                            for (const child of todo.children) {
                                if (!child.completed) {
                                    text += `    ${child.title}\n`;
                                }
                            }
                        }
                    }
                }
            }

            // 读取行为目录
            const behaviorsFile = path.join(this.todoDataDir, 'behaviors.json');
            if (fs.existsSync(behaviorsFile)) {
                const behaviors = JSON.parse(fs.readFileSync(behaviorsFile, 'utf-8'));
                if (behaviors.length > 0) {
                    text += '行为类型\n';
                    for (const b of behaviors) {
                        text += `  ${b.name}\n`;
                    }
                }
            }

            return text.trim();
        } catch (err) {
            this.logger.warn(`读取 Todo 数据失败（不影响主流程）: ${err.message}`);
            return '';
        }
    }

    /**
     * 构建 2 分钟级别的请求内容
     * 输入: 2分钟内截图(Buffer) + 过去若干条2min总结(Object) + 可选断档信息 + 可选焦点窗口信息
     * @param {Array<{buffer: Buffer, timestamp: Date}>} screenshots - 截图数据
     * @param {Array<Object>} historySummaries - 历史2min总结
     * @param {string} format - 图片格式 (jpeg/png)
     * @param {Object|null} gapInfo - 时间断档信息 { gapMinutes, lastSummaryTime }
     * @param {string} [activeWindowText] - 焦点窗口时间线文本（已格式化）
     * @returns {Array} Gemini contents 数组
     */
    build2min(screenshots, historySummaries, format = 'jpeg', gapInfo = null, activeWindowText = '') {
        const contents = [];
        const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';

        // 1. System Prompt
        contents.push(this._get2minPrompt());

        // 1.5 注入 Todo 任务/行为目录
        const todoText = this._buildTodoContextText();
        if (todoText) {
            contents.push(
                `\n【用户任务与行为目录】\n` +
                `以下是用户当前的任务列表和行为类型，请基于这些信息对活动进行归类。\n` +
                `${todoText}\n` +
                `归类规则:\n` +
                `- 优先将活动归类到已有的任务或行为中。\n` +
                `- category_type、category_name、subtask_name 都是列表,按主次顺序排列,三者一一对应。\n` +
                `- 如果活动明确属于某个主任务下的具体子任务，category_type 中对应元素填"任务"，category_name 中填主任务名，subtask_name 中填子任务名。\n` +
                `- 如果活动属于某个主任务但没有明显的子任务行为，category_type 中填"任务"，category_name 中填主任务名，subtask_name 中填空字符串。\n` +
                `- 如果活动属于某个行为类型，category_type 中填"行为"，category_name 中填行为名，subtask_name 中填空字符串。\n` +
                `- 如果无法归类到已有的任务或行为，可以新建：category_type 中填"新建任务"或"新建行为"，category_name 中填你建议的名称。\n` +
                `- 新建行为的名称需要适度具体，例如"使用ChatGPT查询技术问题"是合适的，"浏览网站"太宽泛，"使用chatgpt搜索2025年JS框架对比"太具体。\n` +
                `- 如果你认为当前活动应该作为某个已有主任务的新子任务，category_type 中填"任务"，category_name 中填已有的主任务名，subtask_name 中填你建议的新子任务名。`
            );
        }

        // 2. 时间断档提示（如果有）
        if (gapInfo) {
            contents.push(
                `\n【⚠️ 时间断档提示】\n` +
                `上次总结时间: ${gapInfo.lastSummaryTime}，距离现在约 ${gapInfo.gapMinutes} 分钟。\n` +
                `这意味着监控服务在这段时间内没有运行，中间的用户活动未被记录。\n` +
                `因此：\n` +
                `- 下方的历史总结可能不连续，不要假设中间没有活动变化。\n` +
                `- duration_minutes 应当从本次重新计算为 2，不要累加断档前的时间。\n` +
                `- task_status 如果与断档前相同，应标注为"继续"而非直接延续上下文。`
            );
        }

        // 3. 焦点窗口时间线（如果有）
        if (activeWindowText) {
            contents.push(
                `\n【焦点窗口时间线（本2分钟内用户切换的应用窗口）】\n` +
                `格式: "完整焦点窗口名(应用名-窗口标题)" 开始时间-结束时间\n` +
                `${activeWindowText}\n` +
                `说明: 此信息反映用户实际使用的应用及时长，可辅助判断 context 和 interaction_mode。`
            );
        }

        // 4. 历史总结文本（如果有）
        if (historySummaries.length > 0) {
            const historyText = this._formatHistorySummaries(historySummaries, '2min');
            contents.push(`\n【过去${historySummaries.length}个2分钟的AI总结】\n${historyText}`);
        }

        // 5. 当前分钟的截图（inline 方式）
        contents.push(`\n【当前2分钟的${screenshots.length}张截图（按时间顺序）】`);
        for (const shot of screenshots) {
            contents.push(this.geminiClient.buildImagePart(shot.buffer, mimeType));
        }

        return contents;
    }

    /**
     * 构建 10 分钟级别的请求内容
     * 输入: 最近若干条2min总结 + 过去5条10min总结 + 可选焦点窗口信息
     * @param {Array<Object>} recent2min - 最近若干条2min总结
     * @param {Array<Object>} history10min - 过去5条10min总结
     * @param {string} [activeWindowText] - 焦点窗口时间线文本（已格式化）
     * @returns {Array} Gemini contents 数组
     */
    build10min(recent2min, history10min, activeWindowText = '') {
        const contents = [];

        // 1. System Prompt
        contents.push(this._get10minPrompt());

        // 1.5 注入 Todo 任务/行为目录
        const todoText10 = this._buildTodoContextText();
        if (todoText10) {
            contents.push(
                `\n【用户任务与行为目录】\n` +
                `${todoText10}\n` +
                `归类规则: 从2min总结的 category_type/category_name/subtask_name 列表字段聚合，activity_timeline 的 label 使用 category_name 中的各元素（主任务名或行为名），category_type 使用对应元素，如有子任务则在 subtasks 中体现。旧数据中若 category_name 为字符串则视为单元素列表；若无 category_name 但有 task_label，用 task_label[0] 作为 label，category_type 视为"行为"。`
            );
        }

        // 2. 焦点窗口时间线（如果有）
        if (activeWindowText) {
            contents.push(
                `\n【焦点窗口时间线（本10分钟内用户切换的应用窗口）】\n` +
                `格式: "完整焦点窗口名(应用名-窗口标题)" 开始时间-结束时间\n` +
                `${activeWindowText}\n` +
                `说明: 此信息反映用户实际使用的应用及时长，可辅助判断应用切换和任务边界。`
            );
        }

        // 3. 过去的10min总结（如果有）
        if (history10min.length > 0) {
            const historyText = this._formatHistorySummaries(history10min, '10min');
            contents.push(`\n【过去${history10min.length}个10分钟的AI总结】\n${historyText}`);
        }

        // 4. 最近2min总结
        if (recent2min.length > 0) {
            const recentText = this._formatHistorySummaries(recent2min, '2min');
            contents.push(`\n【最近${recent2min.length}个2分钟的AI总结】\n${recentText}`);
        }

        return contents;
    }

    /**
     * 构建 1 小时级别的请求内容
     * 输入: 最近6条10min总结 + 更早6条10min总结 + 可选焦点窗口信息
     * @param {Array<Object>} recent10min - 最近6条10min总结
     * @param {Array<Object>} earlier10min - 更早6条10min总结
     * @param {string} [activeWindowText] - 焦点窗口时间线文本（已格式化）
     * @returns {Array} Gemini contents 数组
     */
    build1h(recent10min, earlier10min, activeWindowText = '') {
        const contents = [];

        // 1. System Prompt
        contents.push(this._get1hPrompt());

        // 1.5 注入 Todo 任务/行为目录
        const todoText1h = this._buildTodoContextText();
        if (todoText1h) {
            contents.push(
                `\n【用户任务与行为目录】\n` +
                `${todoText1h}\n` +
                `归类规则: 从10min总结的 activity_timeline 中聚合，time_distribution 的 label 使用任务名或行为名。旧数据中若无 category_type 字段，视为"行为"类型。`
            );
        }

        // 2. 焦点窗口时间线（如果有）
        if (activeWindowText) {
            contents.push(
                `\n【焦点窗口时间线（本小时内用户切换的应用窗口）】\n` +
                `格式: "完整焦点窗口名(应用名-窗口标题)" 开始时间-结束时间\n` +
                `${activeWindowText}\n` +
                `说明: 此信息反映用户实际使用的应用及时长，可辅助判断主要活动和时间分布。`
            );
        }

        // 3. 更早的10min总结（如果有）
        if (earlier10min.length > 0) {
            const earlierText = this._formatHistorySummaries(earlier10min, '10min');
            contents.push(`\n【更早${earlier10min.length}个10分钟的AI总结】\n${earlierText}`);
        }

        // 4. 最近的10min总结
        if (recent10min.length > 0) {
            const recentText = this._formatHistorySummaries(recent10min, '10min');
            contents.push(`\n【最近${recent10min.length}个10分钟的AI总结】\n${recentText}`);
        }

        return contents;
    }

    /**
     * 格式化历史总结为文本
     * @param {Array<Object>} summaries - 总结数组
     * @param {string} granularity - 粒度标识
     * @returns {string} 格式化的文本
     */
    _formatHistorySummaries(summaries, granularity) {
        return summaries.map((s, i) => {
            const timeSpan = this._formatSummaryTimeSpan(s, granularity);
            // 将总结对象转为可读文本，排除 timestamp 和 granularity 字段
            const fields = Object.entries(s)
                .filter(([key]) => !['timestamp', 'granularity'].includes(key))
                .map(([key, value]) => `  ${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
                .join('\n');
            return `--- [${granularity} #${i + 1}] ${timeSpan} ---\n${fields}`;
        }).join('\n\n');
    }

    /**
     * 计算并格式化单条历史总结的时间跨度
     * @param {Object} summary - 单条总结
     * @param {string} granularity - 粒度标识
     * @returns {string} 时间跨度（如 15:29:48-15:31:48）
     */
    _formatSummaryTimeSpan(summary, granularity) {
        if (!summary.timestamp) {
            return '未知';
        }

        const endTime = new Date(summary.timestamp);
        if (Number.isNaN(endTime.getTime())) {
            return '未知';
        }

        const minutes = this._getGranularityMinutes(granularity);
        const startTime = new Date(endTime.getTime() - minutes * 60 * 1000);

        const startStr = this._formatClockTime(startTime);
        const endStr = this._formatClockTime(endTime);
        return `${startStr}-${endStr}`;
    }

    /**
     * 根据粒度获取时长分钟数
     * @param {string} granularity - 粒度
     * @returns {number} 分钟数
     */
    _getGranularityMinutes(granularity) {
        const mapping = {
            '2min': 2,
            '10min': 10,
            '1h': 60
        };
        return mapping[granularity] || 0;
    }

    /**
     * 格式化时间为 HH:MM:SS
     * @param {Date} date - 时间对象
     * @returns {string} HH:MM:SS
     */
    _formatClockTime(date) {
        return date.toLocaleTimeString('zh-CN', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }

    /**
     * 获取 2 分钟级别的 system prompt
     * 来源: task/2.ai总结板块.md 的 Prompt(2分钟) 部分
     * @returns {string}
     */
    _get2minPrompt() {
        return `你是工作屏幕总结助手。输入包括当前2分钟内的截图(按时间顺序)与过去数个2分钟的AI文字总结。
请严格基于证据总结,不得猜测或编造;证据不足则写"不确定"。
输出需简洁、可聚合,突出"动作+对象+变化",并明确区分浏览与操作。

区分规则:
- 浏览内容: 仅查看/阅读/滚动/播放,没有输入/执行/提交等操作。
- 操作动作: 输入、编辑、执行命令、点击按钮/菜单、保存/提交/创建/删除等。
- 若出现对话框/弹窗/表单,优先记录其中的确认/提交/保存/重命名/权限等操作。

活动归类规则:
- 如果提供了【用户任务与行为目录】,必须将活动归类到其中的任务或行为。
- 一个2分钟时段内可能涉及多个活动,因此 category_type 和 category_name 均为列表,按主次顺序排列（最主要的活动在前）。
- category_type: 每个元素为"任务"/"行为"/"新建任务"/"新建行为"。
- category_name: 每个元素为对应的主任务名称或行为名称,与 category_type 一一对应。
- subtask_name: 每个元素为对应的子任务名称或空字符串,与 category_type 一一对应。仅当 category_type 为"任务"且活动明确对应某个子任务时填写,否则为空字符串。
- 如果没有提供任务/行为目录,这三个字段仍需填写,category_type 填"新建任务"或"新建行为",自行命名。
- 新建行为的命名需适度具体,如"使用ChatGPT查询技术问题"合适,"浏览网站"太宽泛,"搜索2025年JS框架对比"太具体。
- 大多数情况下只有1个活动,但如果确实在2分钟内切换了明显不同的活动,可以列出2-3个（不超过3个）。

活动持续时间统计规则:
- 查看过去AI总结中的 category_name 字段（列表第一个元素即主活动）,找到当前主活动的归类名称。
- 从最近的历史总结往前回溯,统计该名称在 category_name[0] 中连续出现的2分钟段数,加上当前这2分钟,得到 duration_minutes。
- 如果没有历史总结,或当前是全新活动,duration_minutes 为 2。
- duration_minutes 必须为正整数。

字段说明:
- interaction_mode: 浏览/操作/混合/不确定。
- browse_content: 浏览的页面/文档/列表/视频/聊天内容等,没有则写"不确定"。
- operate_action: 本分钟发生的实际操作动作,没有则写"不确定"。
- core_action: 本分钟最关键动作,优先选取操作动作;若仅浏览则写浏览动作。

请严格按以下JSON格式输出,不要输出任何其他内容:
{
  "category_type": ["任务", "行为"],
  "category_name": ["主任务名", "行为名"],
  "subtask_name": ["子任务名或空字符串", ""],
  "task_status": "开始/继续/切换/结束/不确定",
  "interaction_mode": "浏览/操作/混合/不确定",
  "browse_content": "浏览内容或不确定",
  "operate_action": "操作动作或不确定",
  "core_action": "核心动作描述",
  "context": "应用/窗口/文件/网页/关键词",
  "content_change": "新增/修改/删除/无明确变化",
  "progress": "完成/推进/无明显进展",
  "blockers": "无/具体问题",
  "next_intent": "下一步意图或不确定",
  "confidence": "高/中/低",
  "duration_minutes": 2
}`;
    }

    /**
     * 获取 10 分钟级别的 system prompt
     * @returns {string}
     */
    _get10minPrompt() {
        return `你是工作屏幕总结助手。输入包括最近10分钟内每2分钟的AI文字总结,以及过去数个10分钟级别总结。
请严格基于输入证据总结,不得猜测或编造;证据不足则写"不确定"。
输出需去重、聚焦变化与进展,并串联成清晰的任务轨迹。
请从2min总结中优先提炼实际操作(operate_action/interaction_mode=操作或混合);若字段缺失,从 core_action/content_change 推断。
浏览内容仅作为背景,不要被短暂切换、纯浏览或噪声干扰。
若出现对话框/弹窗/表单的确认/提交/保存/重命名等操作,必须计入关键进展。

活动时间轴构建规则:
- 从输入的每条2min总结中提取 timestamp（ISO 时间）、category_type（列表）、category_name（列表）、subtask_name（列表）。
- 每条2min总结的 category_name 是一个列表,可能包含1~3个活动名称,category_type 和 subtask_name 与之一一对应。
- 对列表中的每个活动分别生成时间轴条目: activity_timeline 的 label 使用 category_name 中的元素, category_type 使用对应的 category_type 元素。
- 如果对应的 subtask_name 非空,将其收集到该 activity_timeline 条目的 subtasks 数组中（去重）。
- 每条2min总结代表一个2分钟时间段,其结束时间为 timestamp 对应的 HH:MM,起始时间为结束时间减去2分钟。
- 将相同 category_name 的连续或相邻时间段合并为一条记录,输出 start_time 和 end_time（均为 HH:MM 格式）。
- 计算每条记录的 minutes = end_time - start_time（分钟数）。
- 过滤掉累计 < 3 分钟的零散活动,不要输出到 activity_timeline 中。
- 按 start_time 升序排列。
- 如果活动中间有间断（超过4分钟无同 category_name 记录）,应拆分为两条独立记录。
- 兼容旧数据: 如果2min总结中 category_type/category_name 是字符串而非列表,视为单元素列表处理。如果2min总结中没有 category_name 但有 task_label,用 task_label[0] 作为 label,category_type 视为"行为"。

请严格按以下JSON格式输出,不要输出任何其他内容:
{
  "task_main": "按任务/行为归类合并的主线描述",
  "activity_timeline": [
    {"label": "主任务名或行为名", "category_type": "任务/行为", "start_time": "10:00", "end_time": "10:08", "minutes": 8, "subtasks": ["子任务1"]},
    {"label": "行为名", "category_type": "行为", "start_time": "10:04", "end_time": "10:10", "minutes": 6, "subtasks": []}
  ],
  "key_progress": "仅保留新增/变化/结果",
  "key_objects": "应用/文件/模块/网页/关键词",
  "content_change": "新增/修改/删除/无明确变化",
  "blockers": "无/具体问题",
  "next_step": "下一步或不确定",
  "confidence": "高/中/低"
}`;
    }

    /**
     * 获取 1 小时级别的 system prompt
     * @returns {string}
     */
    _get1hPrompt() {
        return `你是工作屏幕总结助手。输入包括最近数个10分钟级别总结,以及更早的10分钟级别总结。
请严格基于输入证据总结,不得猜测或编造;证据不足则写"不确定"。
输出需突出阶段性成果、关键决策、重要风险,并总结整体走向。
请以10min总结中的实际操作为主线,过滤纯浏览/短暂切换的噪声;零散浏览可归入 miscellaneous。
若10min中包含对话框/表单关键操作,应体现在 achievements 或 task_chain 中。

活动时间分布统计规则:
- 从输入的各10min总结中提取 activity_timeline 字段（每条含 label、category_type、start_time、end_time、minutes、subtasks）。
- 将相同 label 的 minutes 累加，同时合并 subtasks（去重）。
- time_distribution: 按累计分钟数降序列出主要活动（累计>=5分钟），保留 category_type 和 subtasks。
- miscellaneous: 将累计<5分钟的零散活动集中归类列出。
- 如果输入的10min总结中没有 activity_timeline 字段,则根据 task_main 等文本信息尽力推断。

请严格按以下JSON格式输出,不要输出任何其他内容:
{
  "achievements": ["成果1", "成果2"],
  "task_chain": "按时间顺序串联的任务链条",
  "time_distribution": [
    {"label": "主任务名或行为名", "category_type": "任务/行为", "minutes": 35, "subtasks": ["子任务1"]},
    {"label": "行为名", "category_type": "行为", "minutes": 15, "subtasks": []}
  ],
  "miscellaneous": [
    {"label": "零散活动", "category_type": "行为", "minutes": 3, "subtasks": []}
  ],
  "key_output": "代码/文档/配置/结论",
  "blockers": "无/具体问题",
  "next_direction": "下一阶段方向或不确定",
  "confidence": "高/中/低"
}`;
    }
}

module.exports = PromptBuilder;
