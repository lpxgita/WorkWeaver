/**
 * 截图清理模块
 * 根据文件夹日期执行分级清理策略：
 * - >30 天的文件夹：直接删除
 * - 7~30 天的文件夹：每分钟仅保留 1 张截图
 * - <7 天的文件夹：不处理
 */

const fs = require('fs');
const path = require('path');

class ScreenshotCleaner {
    /**
     * 创建截图清理器
     * @param {string} baseDirectory - 截图存储根目录
     * @param {Logger} logger - 日志模块
     * @param {Object} options - 清理配置
     * @param {number} options.delete_after_days - 直接删除的天数阈值（默认 30）
     * @param {number} options.thin_after_days - 开始稀疏保留的天数阈值（默认 7）
     */
    constructor(baseDirectory, logger, options = {}) {
        this.baseDirectory = baseDirectory;
        this.logger = logger;
        this.deleteAfterDays = options.delete_after_days || 30;
        this.thinAfterDays = options.thin_after_days || 7;
    }

    /**
     * 执行清理任务
     * @returns {Promise<{deleted_folders: number, thinned_folders: number, removed_files: number}>}
     */
    async clean() {
        const stats = { deleted_folders: 0, thinned_folders: 0, removed_files: 0 };

        if (!fs.existsSync(this.baseDirectory)) {
            this.logger.info('[清理] 截图目录不存在，跳过清理');
            return stats;
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let entries;
        try {
            entries = fs.readdirSync(this.baseDirectory, { withFileTypes: true });
        } catch (err) {
            this.logger.error(`[清理] 读取截图目录失败: ${err.message}`);
            return stats;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            // 解析日期文件夹名（YYYY-MM-DD）
            const folderDate = this._parseDateFolder(entry.name);
            if (!folderDate) continue;

            const daysDiff = Math.floor((today.getTime() - folderDate.getTime()) / (1000 * 60 * 60 * 24));
            const folderPath = path.join(this.baseDirectory, entry.name);

            if (daysDiff >= this.deleteAfterDays) {
                // >30 天：直接删除整个文件夹
                try {
                    fs.rmSync(folderPath, { recursive: true, force: true });
                    stats.deleted_folders++;
                    this.logger.info(`[清理] 删除过期文件夹: ${entry.name} (${daysDiff} 天前)`);
                } catch (err) {
                    this.logger.error(`[清理] 删除文件夹失败 ${entry.name}: ${err.message}`);
                }
            } else if (daysDiff >= this.thinAfterDays) {
                // 7~30 天：每分钟仅保留 1 张截图
                const removed = this._thinFolder(folderPath, entry.name);
                if (removed > 0) {
                    stats.thinned_folders++;
                    stats.removed_files += removed;
                    this.logger.info(`[清理] 稀疏处理: ${entry.name} (${daysDiff} 天前)，删除 ${removed} 张多余截图`);
                }
            }
            // <7 天：不处理
        }

        this.logger.info(`[清理] 完成: 删除 ${stats.deleted_folders} 个过期文件夹, 稀疏处理 ${stats.thinned_folders} 个文件夹, 删除 ${stats.removed_files} 张多余截图`);
        return stats;
    }

    /**
     * 对单个文件夹执行稀疏处理：每分钟仅保留 1 张截图
     * @param {string} folderPath - 文件夹路径
     * @param {string} folderName - 文件夹名称（用于日志）
     * @returns {number} 删除的文件数
     */
    _thinFolder(folderPath, folderName) {
        let files;
        try {
            files = fs.readdirSync(folderPath).filter(f => {
                const ext = path.extname(f).toLowerCase();
                return ext === '.jpeg' || ext === '.jpg' || ext === '.png';
            });
        } catch (err) {
            this.logger.error(`[清理] 读取文件夹失败 ${folderName}: ${err.message}`);
            return 0;
        }

        if (files.length === 0) return 0;

        // 按文件名排序（文件名包含时间 HH-mm-ss，天然有序）
        files.sort();

        // 按分钟分组：提取 HH-mm 部分
        const minuteGroups = new Map();
        for (const file of files) {
            const minuteKey = this._extractMinuteKey(file);
            if (!minuteKey) {
                // 无法解析的文件名，保留不删除
                continue;
            }
            if (!minuteGroups.has(minuteKey)) {
                minuteGroups.set(minuteKey, []);
            }
            minuteGroups.get(minuteKey).push(file);
        }

        // 每分钟仅保留第一张（文件名排序最前），删除其余
        let removedCount = 0;
        for (const [, group] of minuteGroups) {
            if (group.length <= 1) continue;
            // 保留第一张，删除剩余
            for (let i = 1; i < group.length; i++) {
                const filePath = path.join(folderPath, group[i]);
                try {
                    fs.unlinkSync(filePath);
                    removedCount++;
                } catch (err) {
                    this.logger.error(`[清理] 删除文件失败 ${group[i]}: ${err.message}`);
                }
            }
        }

        return removedCount;
    }

    /**
     * 从文件名中提取分钟级别的 key（HH-mm）
     * 文件名格式：YYYY-MM-DD_HH-mm-ss_monitor.ext
     * @param {string} fileName - 文件名
     * @returns {string|null} 分钟 key，如 "14-30"
     */
    _extractMinuteKey(fileName) {
        // 匹配 _HH-mm-ss_ 或 _HH-mm-ss. 部分
        const match = fileName.match(/(\d{2}-\d{2})-\d{2}/);
        if (!match) return null;
        return match[1];
    }

    /**
     * 解析日期文件夹名称
     * @param {string} name - 文件夹名称（应为 YYYY-MM-DD 格式）
     * @returns {Date|null}
     */
    _parseDateFolder(name) {
        const match = name.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return null;
        const year = parseInt(match[1], 10);
        const month = parseInt(match[2], 10) - 1;
        const day = parseInt(match[3], 10);
        const date = new Date(year, month, day);
        // 验证日期有效性
        if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
            return null;
        }
        return date;
    }
}

module.exports = ScreenshotCleaner;
