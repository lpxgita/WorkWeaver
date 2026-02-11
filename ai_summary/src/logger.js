/**
 * 日志模块
 * 支持多级别日志输出到控制台和文件
 * 与 auto_screenshot 的日志模块保持一致的接口
 */

const fs = require('fs');
const path = require('path');

// 日志级别定义
const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
};

class Logger {
    /**
     * 创建日志实例
     * @param {Object} options - 日志配置
     * @param {string} options.level - 日志级别 (debug/info/warn/error)
     * @param {string|null} options.file - 日志文件路径，null 则不写文件
     * @param {boolean} options.console - 是否输出到控制台
     */
    constructor(options = {}) {
        this.level = options.level || 'info';
        this.levelValue = LOG_LEVELS[this.level] || LOG_LEVELS.info;
        this.enableConsole = options.console !== false;
        this.filePath = options.file || null;
        this.fileStream = null;

        if (this.filePath) {
            this._initFileStream();
        }
    }

    /**
     * 初始化文件写入流
     */
    _initFileStream() {
        try {
            const logDir = path.dirname(this.filePath);
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            this.fileStream = fs.createWriteStream(this.filePath, { flags: 'a' });
        } catch (err) {
            console.error(`[Logger] 无法创建日志文件: ${err.message}`);
            this.fileStream = null;
        }
    }

    /**
     * 格式化时间戳
     * @returns {string} 格式化的时间字符串
     */
    _formatTimestamp() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }

    /**
     * 格式化日志消息
     * @param {string} level - 日志级别
     * @param {string} message - 日志消息
     * @param {Array} args - 额外参数
     * @returns {string} 格式化的日志字符串
     */
    _formatMessage(level, message, args) {
        const timestamp = this._formatTimestamp();
        const levelStr = level.toUpperCase().padEnd(5);
        let formattedMessage = `[${timestamp}] [${levelStr}] ${message}`;

        if (args.length > 0) {
            formattedMessage += ' ' + args.map(arg =>
                typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
            ).join(' ');
        }

        return formattedMessage;
    }

    /**
     * 输出日志
     * @param {string} level - 日志级别
     * @param {string} message - 日志消息
     * @param {Array} args - 额外参数
     */
    _log(level, message, ...args) {
        if (LOG_LEVELS[level] < this.levelValue) {
            return;
        }

        const formattedMessage = this._formatMessage(level, message, args);

        if (this.enableConsole) {
            const consoleFn = level === 'error' ? console.error :
                              level === 'warn' ? console.warn : console.log;
            consoleFn(formattedMessage);
        }

        if (this.fileStream) {
            this.fileStream.write(formattedMessage + '\n');
        }
    }

    debug(message, ...args) { this._log('debug', message, ...args); }
    info(message, ...args) { this._log('info', message, ...args); }
    warn(message, ...args) { this._log('warn', message, ...args); }
    error(message, ...args) { this._log('error', message, ...args); }

    /**
     * 关闭日志流
     */
    close() {
        if (this.fileStream) {
            this.fileStream.end();
            this.fileStream = null;
        }
    }
}

module.exports = Logger;
