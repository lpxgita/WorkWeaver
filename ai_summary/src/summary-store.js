/**
 * 总结存储模块
 * 管理 AI 总结结果的持久化读写
 */

const fs = require('fs');
const path = require('path');

class SummaryStore {
    /**
     * 创建总结存储实例
     * @param {Object} config - 总结存储配置
     * @param {string} config.directory - 总结输出目录
     * @param {Logger} logger - 日志模块
     */
    constructor(config, logger) {
        this.logger = logger;

        // 解析目录为绝对路径
        this.baseDirectory = path.isAbsolute(config.directory)
            ? config.directory
            : path.resolve(process.cwd(), config.directory);
    }

    /**
     * 格式化日期
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
     * 格式化时间（用于文件名）
     * @param {Date} date - 日期对象
     * @returns {string} HH-mm 格式
     */
    _formatTime(date) {
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${hours}-${minutes}`;
    }

    /**
     * 确保目录存在
     * @param {string} dirPath - 目录路径
     */
    _ensureDir(dirPath) {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }

    /**
     * 获取指定粒度的存储目录
     * @param {string} granularity - 时间粒度 ('2min' | '10min' | '1h')
     * @param {Date} date - 日期对象
     * @returns {string} 目录路径
     */
    _getGranularityDir(granularity, date) {
        const dateStr = this._formatDate(date);
        return path.join(this.baseDirectory, dateStr, granularity);
    }

    /**
     * 保存总结结果
     * @param {string} granularity - 时间粒度 ('2min' | '10min' | '1h')
     * @param {Date} timestamp - 时间戳
     * @param {Object} data - 总结数据
     */
    save(granularity, timestamp, data) {
        const dir = this._getGranularityDir(granularity, timestamp);
        this._ensureDir(dir);

        const timeStr = this._formatTime(timestamp);
        const filePath = path.join(dir, `${timeStr}.json`);

        const record = {
            timestamp: timestamp.toISOString(),
            granularity,
            ...data
        };

        try {
            fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
            this.logger.info(`总结保存: ${granularity}/${this._formatDate(timestamp)}/${timeStr}.json`);
        } catch (err) {
            this.logger.error(`总结保存失败: ${err.message}`);
            throw err;
        }
    }

    /**
     * 获取最近 N 条指定粒度的总结
     * @param {string} granularity - 时间粒度 ('2min' | '10min' | '1h')
     * @param {number} count - 需要的数量
     * @returns {Array<Object>} 总结数组，按时间升序排列
     */
    getRecentSummaries(granularity, count) {
        const now = new Date();
        const dateStr = this._formatDate(now);
        const dir = this._getGranularityDir(granularity, now);

        if (!fs.existsSync(dir)) {
            this.logger.debug(`总结目录不存在: ${dir}`);
            return [];
        }

        // 读取所有 JSON 文件并按文件名排序
        const files = fs.readdirSync(dir)
            .filter(f => f.endsWith('.json'))
            .sort();

        // 取最近的 count 条
        const selected = files.slice(-count);
        const summaries = [];

        for (const file of selected) {
            try {
                const content = fs.readFileSync(path.join(dir, file), 'utf8');
                summaries.push(JSON.parse(content));
            } catch (err) {
                this.logger.error(`读取总结文件失败: ${file} - ${err.message}`);
            }
        }

        return summaries;
    }

    /**
     * 获取更早的 N 条总结（跳过最近的 skip 条）
     * @param {string} granularity - 时间粒度
     * @param {number} count - 需要的数量
     * @param {number} skip - 跳过最近的条数
     * @returns {Array<Object>} 总结数组，按时间升序排列
     */
    getEarlierSummaries(granularity, count, skip) {
        const now = new Date();
        const dir = this._getGranularityDir(granularity, now);

        if (!fs.existsSync(dir)) {
            return [];
        }

        const files = fs.readdirSync(dir)
            .filter(f => f.endsWith('.json'))
            .sort();

        // 跳过最近 skip 条，取之前的 count 条
        const endIndex = Math.max(0, files.length - skip);
        const startIndex = Math.max(0, endIndex - count);
        const selected = files.slice(startIndex, endIndex);

        const summaries = [];
        for (const file of selected) {
            try {
                const content = fs.readFileSync(path.join(dir, file), 'utf8');
                summaries.push(JSON.parse(content));
            } catch (err) {
                this.logger.error(`读取总结文件失败: ${file} - ${err.message}`);
            }
        }

        return summaries;
    }
}

module.exports = SummaryStore;
