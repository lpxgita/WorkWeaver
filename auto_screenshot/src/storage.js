/**
 * 存储模块
 * 管理截图文件的目录创建、命名和保存
 */

const fs = require('fs');
const path = require('path');

class Storage {
    /**
     * 创建存储实例
     * @param {Object} config - 存储配置
     * @param {string} config.directory - 保存目录
     * @param {Object} config.naming - 命名配置
     * @param {boolean} config.organize_by_date - 是否按日期分目录
     * @param {string} format - 图片格式 (jpeg/png)
     */
    constructor(config, format = 'jpeg') {
        this.baseDirectory = config.directory;
        this.naming = config.naming || {
            pattern: '{date}_{time}_{monitor}',
            date_format: 'YYYY-MM-DD',
            time_format: 'HH-mm-ss'
        };
        this.organizeByDate = config.organize_by_date !== false;
        this.format = format === 'png' ? 'png' : 'jpeg';
        
        // 解析基础目录为绝对路径
        this.baseDirectory = path.isAbsolute(this.baseDirectory)
            ? this.baseDirectory
            : path.resolve(process.cwd(), this.baseDirectory);
    }

    /**
     * 获取当前日期字符串
     * @returns {string} 格式化的日期
     */
    getCurrentDate() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * 获取当前时间字符串
     * @returns {string} 格式化的时间
     */
    getCurrentTime() {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        return `${hours}-${minutes}-${seconds}`;
    }

    /**
     * 确保目录存在
     * @returns {string} 当前保存目录路径
     */
    ensureDirectory() {
        let targetDir = this.baseDirectory;
        
        // 如果按日期分目录，添加日期子目录
        if (this.organizeByDate) {
            targetDir = path.join(this.baseDirectory, this.getCurrentDate());
        }
        
        // 创建目录（如果不存在）
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        
        return targetDir;
    }

    /**
     * 生成文件名
     * @param {number} monitorIndex - 显示器索引 (从 1 开始)
     * @returns {string} 文件名（不含路径）
     */
    generateFileName(monitorIndex) {
        const date = this.getCurrentDate();
        const time = this.getCurrentTime();
        const monitor = String(monitorIndex);
        const timestamp = Date.now();
        
        // 替换命名模式中的变量
        let fileName = this.naming.pattern
            .replace('{date}', date)
            .replace('{time}', time)
            .replace('{monitor}', monitor)
            .replace('{timestamp}', timestamp);
        
        // 添加扩展名
        fileName += `.${this.format}`;
        
        return fileName;
    }

    /**
     * 生成完整文件路径
     * @param {number} monitorIndex - 显示器索引 (从 1 开始)
     * @returns {string} 完整文件路径
     */
    generateFilePath(monitorIndex) {
        const directory = this.ensureDirectory();
        const fileName = this.generateFileName(monitorIndex);
        return path.join(directory, fileName);
    }

    /**
     * 保存截图
     * @param {Buffer} imageBuffer - 图像数据
     * @param {string} filePath - 文件路径
     * @returns {Promise<void>}
     */
    async save(imageBuffer, filePath) {
        return new Promise((resolve, reject) => {
            fs.writeFile(filePath, imageBuffer, (err) => {
                if (err) {
                    reject(new Error(`保存文件失败: ${err.message}`));
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * 获取相对于基础目录的路径（用于日志显示）
     * @param {string} filePath - 完整文件路径
     * @returns {string} 相对路径
     */
    getRelativePath(filePath) {
        return path.relative(this.baseDirectory, filePath);
    }
}

module.exports = Storage;
