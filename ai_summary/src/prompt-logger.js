/**
 * Prompt 日志记录器
 * 将每次构建的 prompt 内容按日期和粒度分开存储，便于后续查看。
 *
 * 存储结构:
 *   {baseDir}/prompt-logs/{YYYY-MM-DD}/{粒度}/HH-mm.txt
 *
 * 例如:
 *   ~/Documents/work_monitor/summaries/prompt-logs/2026-02-10/2min/10-02.txt
 *   ~/Documents/work_monitor/summaries/prompt-logs/2026-02-10/10min/10-10.txt
 *   ~/Documents/work_monitor/summaries/prompt-logs/2026-02-10/1h/11-00.txt
 */

const fs = require('fs');
const path = require('path');

class PromptLogger {
    /**
     * 创建 Prompt 日志记录器
     * @param {Object} config - 总结配置
     * @param {string} config.directory - 总结输出目录（将在其下创建 prompt-logs 子目录）
     * @param {Logger} logger - 日志模块
     */
    constructor(config, logger) {
        this.logger = logger;

        // 基础目录: {summary.directory}/prompt-logs/
        const baseDir = path.isAbsolute(config.directory)
            ? config.directory
            : path.resolve(process.cwd(), config.directory);
        this.logDir = path.join(baseDir, 'prompt-logs');
    }

    /**
     * 记录 prompt 内容
     * @param {string} granularity - 粒度 ('2min' | '10min' | '1h')
     * @param {Date} timestamp - 时间戳
     * @param {Array} contents - Gemini contents 数组（包含文本和图片 Part）
     */
    log(granularity, timestamp, contents) {
        try {
            const dir = this._getLogDir(granularity, timestamp);
            this._ensureDir(dir);

            const timeStr = this._formatTime(timestamp);
            const filePath = path.join(dir, `${timeStr}.txt`);

            // 将 contents 数组序列化为可读文本
            const textContent = this._serializeContents(contents, granularity, timestamp);

            fs.writeFileSync(filePath, textContent, 'utf8');
            this.logger.debug(`[PromptLog] 已记录: ${granularity}/${this._formatDate(timestamp)}/${timeStr}.txt`);
        } catch (err) {
            // prompt 日志记录失败不影响主流程，仅打印警告
            this.logger.warn(`[PromptLog] 记录失败: ${err.message}`);
        }
    }

    /**
     * 获取指定粒度的日志目录
     * @param {string} granularity - 粒度
     * @param {Date} date - 日期
     * @returns {string} 目录路径
     * @private
     */
    _getLogDir(granularity, date) {
        const dateStr = this._formatDate(date);
        return path.join(this.logDir, dateStr, granularity);
    }

    /**
     * 将 Gemini contents 数组序列化为可读文本
     * 图片 Part 用占位符 [图片: image/jpeg] 替代
     * @param {Array} contents - Gemini contents 数组
     * @param {string} granularity - 粒度
     * @param {Date} timestamp - 时间戳
     * @returns {string} 可读文本
     * @private
     */
    _serializeContents(contents, granularity, timestamp) {
        const header = `=== Prompt Log ===\n` +
            `粒度: ${granularity}\n` +
            `时间: ${timestamp.toISOString()}\n` +
            `本地时间: ${timestamp.toLocaleString('zh-CN')}\n` +
            `${'='.repeat(50)}\n\n`;

        const parts = contents.map((part, index) => {
            if (typeof part === 'string') {
                return part;
            }
            // 对象类型：可能是图片 Part（inlineData）
            if (part && part.inlineData) {
                const mimeType = part.inlineData.mimeType || 'unknown';
                const dataLen = part.inlineData.data ? part.inlineData.data.length : 0;
                return `[图片: ${mimeType}, base64长度: ${dataLen}]`;
            }
            // 其他对象类型，JSON 序列化
            try {
                return JSON.stringify(part, null, 2);
            } catch {
                return `[无法序列化的内容 #${index}]`;
            }
        });

        return header + parts.join('\n\n');
    }

    /**
     * 格式化日期为 YYYY-MM-DD
     * @param {Date} date
     * @returns {string}
     * @private
     */
    _formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * 格式化时间为 HH-mm
     * @param {Date} date
     * @returns {string}
     * @private
     */
    _formatTime(date) {
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${hours}-${minutes}`;
    }

    /**
     * 确保目录存在
     * @param {string} dirPath
     * @private
     */
    _ensureDir(dirPath) {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }
}

module.exports = PromptLogger;
