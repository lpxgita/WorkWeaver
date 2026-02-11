/**
 * 截图比对器模块
 * 比较一组截图是否完全一致，用于检测屏幕无变化。
 * 使用 Buffer.equals() 进行逐字节精确比对。
 */

class ScreenshotComparer {
    /**
     * 创建截图比对器
     * @param {Logger} logger - 日志模块
     */
    constructor(logger) {
        this.logger = logger;
    }

    /**
     * 检查一组截图是否全部一致（屏幕无变化）
     * 比对策略: 将所有截图与第一张逐字节比较，全部相同则判定为无变化。
     * @param {Array<{buffer: Buffer, timestamp: Date}>} screenshots - 截图数据数组
     * @returns {boolean} true 表示所有截图完全一致（无变化）
     */
    allIdentical(screenshots) {
        if (!screenshots || screenshots.length <= 1) {
            // 只有 0 或 1 张截图无法判断变化，视为有变化（不跳过）
            return false;
        }

        const baseBuffer = screenshots[0].buffer;

        for (let i = 1; i < screenshots.length; i++) {
            if (!baseBuffer.equals(screenshots[i].buffer)) {
                return false;
            }
        }

        this.logger.info(`[截图比对] ${screenshots.length} 张截图完全一致，判定为无变化`);
        return true;
    }

    /**
     * 生成 2 分钟级别的"无变化"模板记录
     * 格式与正常 AI 总结的 JSON 字段保持一致，便于上层聚合读取。
     * @param {Array<{buffer: Buffer, timestamp: Date}>} screenshots - 截图数据数组
     * @param {string} [activeWindowText] - 焦点窗口时间线文本
     * @returns {Object} 无变化模板记录
     */
    buildNoChange2minRecord(screenshots, activeWindowText = '') {
        // 从最后一张截图获取上下文信息
        const lastShot = screenshots[screenshots.length - 1];
        const timeStr = lastShot.timestamp.toLocaleTimeString('zh-CN');

        return {
            no_change: true,
            skip_reason: '截图完全一致，屏幕无变化',
            category_type: ['行为'],
            category_name: ['屏幕无变化'],
            subtask_name: [''],
            task_status: '继续',
            interaction_mode: '无操作',
            browse_content: '不确定',
            operate_action: '无',
            core_action: '屏幕无变化',
            context: activeWindowText ? this._extractWindowNameFromWindowText(activeWindowText) : '不确定',
            content_change: '无明确变化',
            progress: '无明显进展',
            blockers: '无',
            next_intent: '不确定',
            confidence: '高',
            duration_minutes: 2,
            screenshots_compared: screenshots.length
        };
    }

    /**
     * 生成 10 分钟级别的"无变化"模板记录
     * @param {Array<Object>} recent2min - 最近的 2min 总结（全部为 no_change）
     * @returns {Object} 无变化模板记录
     */
    buildNoChange10minRecord(recent2min) {
        // 从 2min 记录中提取焦点窗口上下文
        const contexts = recent2min
            .map(s => s.context)
            .filter(c => c && c !== '不确定');
        const contextStr = contexts.length > 0
            ? [...new Set(contexts)].join(', ')
            : '不确定';

        return {
            no_change: true,
            skip_reason: '所有2min子级均为无变化，跳过API请求',
            task_main: '无活动 — 屏幕持续无变化',
            activity_timeline: [],
            key_progress: '无明显进展',
            key_objects: contextStr,
            content_change: '无明确变化',
            blockers: '无',
            next_step: '不确定',
            confidence: '高',
            no_change_2min_count: recent2min.length
        };
    }

    /**
     * 生成 1 小时级别的"无变化"模板记录
     * @param {Array<Object>} recent10min - 最近的 10min 总结（全部为 no_change）
     * @returns {Object} 无变化模板记录
     */
    buildNoChange1hRecord(recent10min) {
        return {
            no_change: true,
            skip_reason: '所有10min子级均为无变化，跳过API请求',
            achievements: [],
            task_chain: '无活动 — 屏幕持续无变化',
            time_distribution: [],
            miscellaneous: [],
            key_output: '无',
            blockers: '无',
            next_direction: '不确定',
            confidence: '高',
            no_change_10min_count: recent10min.length
        };
    }

    /**
     * 检查一组总结记录是否全部为"无变化"
     * @param {Array<Object>} summaries - 总结记录数组
     * @returns {boolean} true 表示全部为 no_change
     */
    allNoChange(summaries) {
        if (!summaries || summaries.length === 0) {
            return false;
        }
        return summaries.every(s => s.no_change === true);
    }

    /**
     * 从焦点窗口文本中提取完整焦点窗口名
     * @param {string} windowText - 格式如 "cursor" 10:02:56-10:03:17
     * @returns {string} 焦点窗口名或原始文本
     * @private
     */
    _extractWindowNameFromWindowText(windowText) {
        if (!windowText) return '不确定';
        // 提取第一行引号中的焦点窗口名
        const firstLine = windowText.split('\n')[0];
        const match = firstLine.match(/^"([^"]+)"/);
        return match ? match[1] : firstLine.trim();
    }
}

module.exports = ScreenshotComparer;
