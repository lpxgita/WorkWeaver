'use strict';

const { execFile } = require('child_process');
const path = require('path');
const EventEmitter = require('events');

/**
 * 焦点窗口信息
 * @typedef {Object} WindowInfo
 * @property {string} app - 应用名称
 * @property {string} title - 窗口标题
 * @property {number} timestamp - 获取时间戳(ms)
 */

/**
 * 活跃窗口监控器
 * 使用 macOS 原生 AppleScript 实时获取当前焦点窗口信息。
 *
 * 注意：该实现放在 ai_summary 内，避免打包后跨模块路径依赖失效。
 *
 * 事件:
 * - 'change': 焦点窗口发生变化时触发，参数为 {current: WindowInfo, previous: WindowInfo}
 * - 'poll': 每次轮询获取窗口信息时触发，参数为 WindowInfo
 * - 'error': 获取窗口信息失败时触发
 * - 'start': 监控启动时触发
 * - 'stop': 监控停止时触发
 */
class ActiveWindowMonitor extends EventEmitter {
    /**
     * @param {Object} options - 配置选项
     * @param {number} [options.interval=1000] - 轮询间隔（毫秒），默认 1 秒
     * @param {number} [options.timeout=5000] - osascript 执行超时时间（毫秒），默认 5 秒
     */
    constructor(options = {}) {
        super();
        this._interval = options.interval || 1000;
        this._timeout = options.timeout || 5000;
        this._scriptPath = path.join(__dirname, 'get-active-window.scpt');
        this._timer = null;
        this._running = false;
        this._lastWindow = null;
        this._pollCount = 0;
        this._errorCount = 0;

        // 窗口变化历史记录
        this._history = [];
        this._maxHistorySize = options.maxHistorySize || 100;
    }

    /**
     * 获取一次当前焦点窗口信息
     * @returns {Promise<WindowInfo>} 窗口信息
     */
    async getActiveWindow() {
        return new Promise((resolve, reject) => {
            execFile('osascript', [this._scriptPath], {
                timeout: this._timeout,
                encoding: 'utf-8'
            }, (error, stdout) => {
                if (error) {
                    reject(new Error(`osascript 执行失败: ${error.message}`));
                    return;
                }

                try {
                    const rawOutput = stdout.trim();
                    const windowInfo = JSON.parse(rawOutput);

                    if (windowInfo.error) {
                        reject(new Error(`AppleScript 错误: ${windowInfo.error}`));
                        return;
                    }

                    resolve({
                        app: windowInfo.app || '',
                        title: windowInfo.title || '',
                        timestamp: Date.now()
                    });
                } catch (parseError) {
                    reject(new Error(`解析窗口信息失败: ${parseError.message}, 原始输出: ${stdout}`));
                }
            });
        });
    }

    /**
     * 启动持续监控
     * 按照设定的间隔轮询焦点窗口，窗口变化时触发 'change' 事件
     */
    start() {
        if (this._running) {
            return;
        }

        this._running = true;
        this._pollCount = 0;
        this._errorCount = 0;
        this.emit('start', { interval: this._interval });

        // 立即执行一次
        this._poll();

        // 启动定时轮询
        this._timer = setInterval(() => {
            this._poll();
        }, this._interval);
    }

    /**
     * 停止监控
     */
    stop() {
        if (!this._running) {
            return;
        }

        this._running = false;
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }

        this.emit('stop', {
            totalPolls: this._pollCount,
            totalErrors: this._errorCount,
            historySize: this._history.length
        });
    }

    /**
     * 内部轮询方法
     * @private
     */
    async _poll() {
        if (!this._running) {
            return;
        }

        this._pollCount++;

        try {
            const current = await this.getActiveWindow();
            this.emit('poll', current);

            // 检查窗口是否发生变化
            if (this._hasChanged(current)) {
                const previous = this._lastWindow;
                this._lastWindow = current;

                // 记录到历史
                this._addToHistory(current);

                this.emit('change', { current, previous });
            } else if (!this._lastWindow) {
                // 首次获取，记录但不触发 change
                this._lastWindow = current;
                this._addToHistory(current);
            }
        } catch (error) {
            this._errorCount++;
            this.emit('error', error);
        }
    }

    /**
     * 检查窗口是否发生变化
     * @param {WindowInfo} current - 当前窗口信息
     * @returns {boolean} 是否发生变化
     * @private
     */
    _hasChanged(current) {
        if (!this._lastWindow) {
            return false;
        }
        return this._lastWindow.app !== current.app ||
               this._lastWindow.title !== current.title;
    }

    /**
     * 添加到历史记录
     * @param {WindowInfo} windowInfo - 窗口信息
     * @private
     */
    _addToHistory(windowInfo) {
        this._history.push({ ...windowInfo });
        if (this._history.length > this._maxHistorySize) {
            this._history.shift();
        }
    }

    /**
     * 获取窗口变化历史
     * @returns {WindowInfo[]} 历史记录
     */
    getHistory() {
        return [...this._history];
    }

    /**
     * 获取当前监控状态
     * @returns {Object} 状态信息
     */
    getStatus() {
        return {
            running: this._running,
            interval: this._interval,
            pollCount: this._pollCount,
            errorCount: this._errorCount,
            historySize: this._history.length,
            currentWindow: this._lastWindow ? { ...this._lastWindow } : null
        };
    }

    /**
     * 清空历史记录
     */
    clearHistory() {
        this._history = [];
    }

    /**
     * 是否正在运行
     * @returns {boolean}
     */
    isRunning() {
        return this._running;
    }
}

module.exports = ActiveWindowMonitor;
