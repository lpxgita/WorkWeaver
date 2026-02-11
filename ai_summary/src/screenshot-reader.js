/**
 * 截图读取器模块
 * 按时间范围检索截图文件并读取为 Buffer
 */

const fs = require('fs');
const path = require('path');

class ScreenshotReader {
    /**
     * 创建截图读取器实例
     * @param {Object} config - 截图数据源配置
     * @param {string} config.directory - 截图目录路径
     * @param {string} config.format - 截图格式 (jpeg/png)
     * @param {number} config.interval - 截图间隔（秒）
     * @param {Logger} logger - 日志模块
     */
    constructor(config, logger) {
        this.format = config.format || 'jpeg';
        this.interval = config.interval || 5;
        this.logger = logger;

        // 解析目录为绝对路径
        this.baseDirectory = path.isAbsolute(config.directory)
            ? config.directory
            : path.resolve(process.cwd(), config.directory);
    }

    /**
     * 获取当前日期字符串
     * @param {Date} date - 日期对象
     * @returns {string} YYYY-MM-DD 格式
     */
    _formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * 从文件名解析时间戳
     * 文件名格式: YYYY-MM-DD_HH-mm-ss_monitor.jpeg
     * @param {string} fileName - 文件名
     * @returns {Date|null} 解析后的时间，失败返回 null
     */
    _parseTimestamp(fileName) {
        // 匹配格式: 2026-02-05_14-30-05_1.jpeg
        const match = fileName.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})_\d+\.\w+$/);
        if (!match) {
            return null;
        }

        const [, dateStr, hours, minutes, seconds] = match;
        const [year, month, day] = dateStr.split('-').map(Number);
        return new Date(year, month - 1, day, Number(hours), Number(minutes), Number(seconds));
    }

    /**
     * 获取指定时间范围内的截图文件路径列表
     * @param {Date} startTime - 开始时间
     * @param {Date} endTime - 结束时间
     * @returns {Array<{path: string, timestamp: Date}>} 按时间排序的截图文件列表
     */
    getScreenshotsInRange(startTime, endTime) {
        const dateStr = this._formatDate(endTime);
        const dateDir = path.join(this.baseDirectory, dateStr);

        if (!fs.existsSync(dateDir)) {
            this.logger.warn(`截图目录不存在: ${dateDir}`);
            return [];
        }

        const files = fs.readdirSync(dateDir);
        const ext = this.format === 'png' ? '.png' : '.jpeg';

        const screenshots = [];
        for (const file of files) {
            if (!file.endsWith(ext)) {
                continue;
            }

            const timestamp = this._parseTimestamp(file);
            if (!timestamp) {
                continue;
            }

            // 检查是否在时间范围内
            if (timestamp >= startTime && timestamp <= endTime) {
                screenshots.push({
                    path: path.join(dateDir, file),
                    timestamp
                });
            }
        }

        // 按时间排序
        screenshots.sort((a, b) => a.timestamp - b.timestamp);
        return screenshots;
    }

    /**
     * 获取最近 N 分钟的截图
     * @param {number} minutes - 分钟数（默认1）
     * @returns {Array<{path: string, timestamp: Date}>} 截图文件列表
     */
    getRecentScreenshots(minutes = 1) {
        const now = new Date();
        const startTime = new Date(now.getTime() - minutes * 60 * 1000);
        return this.getScreenshotsInRange(startTime, now);
    }

    /**
     * 读取截图文件为 Buffer
     * @param {string} filePath - 文件路径
     * @returns {Buffer|null} 图像数据，读取失败返回 null
     */
    readAsBuffer(filePath) {
        try {
            return fs.readFileSync(filePath);
        } catch (err) {
            this.logger.error(`读取截图文件失败: ${filePath} - ${err.message}`);
            return null;
        }
    }

    /**
     * 获取最近截图并读取为 Buffer 数组
     * @param {number} minutes - 分钟数
     * @param {number} maxCount - 最大数量
     * @returns {Array<{buffer: Buffer, timestamp: Date}>} 图像数据数组
     */
    getRecentScreenshotBuffers(minutes = 1, maxCount = 12) {
        const screenshots = this.getRecentScreenshots(minutes);

        // 取最近的 maxCount 张
        const selected = screenshots.slice(-maxCount);
        const results = [];

        for (const shot of selected) {
            const buffer = this.readAsBuffer(shot.path);
            if (buffer) {
                results.push({
                    buffer,
                    timestamp: shot.timestamp
                });
            }
        }

        if (results.length < maxCount) {
            this.logger.warn(`截图数量不足: 期望 ${maxCount} 张，实际 ${results.length} 张`);
        }

        return results;
    }
}

module.exports = ScreenshotReader;
