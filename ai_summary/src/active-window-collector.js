/**
 * 焦点窗口数据采集器
 * 封装 ActiveWindowMonitor，持续采集窗口切换事件，
 * 提供按时间范围查询历史和格式化为 prompt 文本的能力。
 *
 * 数据格式示例: "cursor" 10:02:56-10:03:17
 */

// 优先使用 ai_summary 内置监控器（打包后可用），
// 如不存在再回退到开发目录的 active_window 实现（向后兼容）。
let ActiveWindowMonitor;
try {
    ActiveWindowMonitor = require('./active-window-monitor');
} catch (innerErr) {
    ActiveWindowMonitor = require('../../active_window/src/active-window-monitor');
}

class ActiveWindowCollector {
    /**
     * 创建焦点窗口采集器
     * @param {Object} options - 配置选项
     * @param {number} [options.interval=1000] - 轮询间隔（毫秒）
     * @param {number} [options.maxHistorySize=5000] - 最大历史记录数（覆盖约 80 分钟的窗口切换）
     * @param {Logger} logger - 日志模块
     */
    constructor(options = {}, logger) {
        this.logger = logger;
        this._monitor = new ActiveWindowMonitor({
            interval: options.interval || 1000,
            maxHistorySize: options.maxHistorySize || 5000
        });

        // 内部时间线存储：按时间顺序记录每次窗口变化的起止时间
        // 格式: [{ app: string, title: string, startTime: number, endTime: number }]
        this._timeline = [];
        this._maxTimelineSize = options.maxHistorySize || 5000;
        this._currentEntry = null;

        // 绑定事件
        this._monitor.on('poll', (windowInfo) => this._onPoll(windowInfo));
        this._monitor.on('change', (data) => this._onChange(data));
        this._monitor.on('error', (err) => {
            this.logger.debug(`[焦点窗口] 获取失败: ${err.message}`);
        });
    }

    /**
     * 启动采集
     */
    start() {
        this._monitor.start();
        this.logger.info('[焦点窗口] 采集器已启动');
    }

    /**
     * 停止采集
     */
    stop() {
        // 关闭当前条目
        this._closeCurrentEntry();
        this._monitor.stop();
        this.logger.info('[焦点窗口] 采集器已停止');
    }

    /**
     * 轮询回调：更新当前条目的结束时间
     * @param {Object} windowInfo - 窗口信息 { app, title, timestamp }
     * @private
     */
    _onPoll(windowInfo) {
        if (this._currentEntry) {
            this._currentEntry.endTime = windowInfo.timestamp;
        } else {
            // 首次轮询，创建初始条目
            this._currentEntry = {
                app: windowInfo.app,
                title: windowInfo.title,
                startTime: windowInfo.timestamp,
                endTime: windowInfo.timestamp
            };
        }
    }

    /**
     * 窗口变化回调：关闭上一个条目，开启新条目
     * @param {Object} data - { current: WindowInfo, previous: WindowInfo }
     * @private
     */
    _onChange(data) {
        this._closeCurrentEntry();

        // 开启新条目
        this._currentEntry = {
            app: data.current.app,
            title: data.current.title,
            startTime: data.current.timestamp,
            endTime: data.current.timestamp
        };
    }

    /**
     * 关闭并保存当前条目到时间线
     * @private
     */
    _closeCurrentEntry() {
        if (this._currentEntry) {
            this._timeline.push({ ...this._currentEntry });
            if (this._timeline.length > this._maxTimelineSize) {
                this._timeline.shift();
            }
            this._currentEntry = null;
        }
    }

    /**
     * 获取指定时间范围内的焦点窗口时间线
     * @param {number} startMs - 起始时间戳（毫秒）
     * @param {number} endMs - 结束时间戳（毫秒），默认为当前时间
     * @returns {Array<Object>} 时间范围内的窗口条目
     */
    getTimelineInRange(startMs, endMs = Date.now()) {
        // 临时关闭当前条目以包含它（然后恢复）
        const results = [];

        // 从已关闭的条目中筛选
        for (const entry of this._timeline) {
            // 条目与查询范围有交集即包含
            if (entry.endTime >= startMs && entry.startTime <= endMs) {
                results.push({
                    ...entry,
                    // 裁剪到查询范围内
                    startTime: Math.max(entry.startTime, startMs),
                    endTime: Math.min(entry.endTime, endMs)
                });
            }
        }

        // 包含当前正在进行的条目
        if (this._currentEntry && this._currentEntry.startTime <= endMs) {
            const entry = {
                ...this._currentEntry,
                endTime: Math.min(this._currentEntry.endTime, endMs)
            };
            if (entry.endTime >= startMs) {
                results.push({
                    ...entry,
                    startTime: Math.max(entry.startTime, startMs)
                });
            }
        }

        return results;
    }

    /**
     * 将时间线条目格式化为 prompt 文本
     * 输出格式: "完整焦点窗口名" HH:MM:SS-HH:MM:SS
     * 相邻同焦点窗口名的条目会合并
     * @param {Array<Object>} timeline - 时间线条目
     * @returns {string} 格式化的焦点窗口信息文本
     */
    formatForPrompt(timeline) {
        if (!timeline || timeline.length === 0) {
            return '';
        }

        // 合并相邻同应用的条目
        const merged = this._mergeConsecutiveEntries(timeline);

        // 格式化为文本
        const lines = merged.map(entry => {
            const startStr = this._formatTimestamp(entry.startTime);
            const endStr = this._formatTimestamp(entry.endTime);
            const windowName = this._buildFullWindowName(entry);
            const escapedWindowName = this._escapeQuotedText(windowName);
            return `"${escapedWindowName}" ${startStr}-${endStr}`;
        });

        return lines.join('\n');
    }

    /**
     * 合并相邻同焦点窗口名的条目
     * @param {Array<Object>} timeline - 时间线条目
     * @returns {Array<Object>} 合并后的条目
     * @private
     */
    _mergeConsecutiveEntries(timeline) {
        if (timeline.length === 0) return [];

        const merged = [{ ...timeline[0] }];

        for (let i = 1; i < timeline.length; i++) {
            const current = timeline[i];
            const last = merged[merged.length - 1];

            // 同应用名且同窗口标题，且时间间隔 ≤ 2 秒，视为连续
            const isSameWindow = current.app === last.app && current.title === last.title;
            if (isSameWindow && (current.startTime - last.endTime) <= 2000) {
                last.endTime = current.endTime;
            } else {
                merged.push({ ...current });
            }
        }

        return merged;
    }

    /**
     * 构建完整焦点窗口名
     * 格式: 应用名 - 窗口标题（标题为空时仅应用名）
     * @param {Object} entry - 时间线条目
     * @returns {string} 完整焦点窗口名
     * @private
     */
    _buildFullWindowName(entry) {
        const app = (entry.app || '').trim() || '未知应用';
        const title = (entry.title || '').trim();

        if (!title) {
            return app;
        }

        // 避免 "应用名 - 应用名" 这种重复
        if (title === app) {
            return app;
        }

        return `${app} - ${title}`;
    }

    /**
     * 转义引号内文本，防止破坏 prompt 行格式
     * @param {string} text - 原始文本
     * @returns {string} 转义后的文本
     * @private
     */
    _escapeQuotedText(text) {
        return String(text)
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * 将毫秒时间戳格式化为 HH:MM:SS
     * @param {number} timestampMs - 毫秒时间戳
     * @returns {string} HH:MM:SS 格式字符串
     * @private
     */
    _formatTimestamp(timestampMs) {
        const date = new Date(timestampMs);
        const h = String(date.getHours()).padStart(2, '0');
        const m = String(date.getMinutes()).padStart(2, '0');
        const s = String(date.getSeconds()).padStart(2, '0');
        return `${h}:${m}:${s}`;
    }

    /**
     * 获取采集器状态
     * @returns {Object}
     */
    getStatus() {
        const monitorStatus = this._monitor.getStatus();
        return {
            ...monitorStatus,
            timelineSize: this._timeline.length,
            hasCurrentEntry: this._currentEntry !== null
        };
    }

    /**
     * 是否正在运行
     * @returns {boolean}
     */
    isRunning() {
        return this._monitor.isRunning();
    }
}

module.exports = ActiveWindowCollector;
