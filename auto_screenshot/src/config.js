/**
 * 配置模块
 * 加载和验证 YAML 配置文件
 * 支持统一配置文件（work_monitor/config.yaml）和模块独立配置
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const YAML = require('yaml');

// 默认配置
const DEFAULT_CONFIG = {
    screenshot: {
        interval: 10,
        format: 'jpeg',
        quality: 80,
        dimension: 100,
        monitors: 'all'
    },
    storage: {
        directory: './screenshots',
        naming: {
            pattern: '{date}_{time}_{monitor}',
            date_format: 'YYYY-MM-DD',
            time_format: 'HH-mm-ss'
        },
        organize_by_date: true
    },
    schedule: {
        enabled: false,
        start_time: '08:00',
        end_time: '22:00',
        days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
        stop_times: []
    },
    logging: {
        level: 'info',
        file: './logs/screenshot.log',
        console: true
    }
};

class Config {
    /**
     * 从统一配置文件加载 auto_screenshot 所需配置
     * 统一配置字段映射:
     *   screenshot.* → screenshot.*（直接透传）
     *   storage.*    → storage.*（直接透传）
     *   schedule.*   → schedule.*（共享）
     *   logging.level/console/screenshot_file → logging.*
     * @param {string} configPath - 统一配置文件路径
     * @returns {Object} auto_screenshot 配置对象
     * @throws {Error} 配置文件不存在或格式错误
     */
    static loadUnified(configPath) {
        const absolutePath = path.isAbsolute(configPath)
            ? configPath
            : path.resolve(process.cwd(), configPath);

        if (!fs.existsSync(absolutePath)) {
            throw new Error(`统一配置文件不存在: ${absolutePath}`);
        }

        try {
            const content = fs.readFileSync(absolutePath, 'utf8');
            const unified = YAML.parse(content) || {};

            // 从统一配置提取 auto_screenshot 所需字段
            const extracted = {
                screenshot: unified.screenshot || {},
                storage: unified.storage || {},
                schedule: unified.schedule || {},
                logging: {
                    level: (unified.logging && unified.logging.level) || 'info',
                    console: unified.logging && unified.logging.console !== undefined
                        ? unified.logging.console : true,
                    file: (unified.logging && unified.logging.screenshot_file) || './logs/screenshot.log'
                }
            };

            // 合并默认配置并验证
            const mergedConfig = Config.mergeWithDefaults(extracted);
            return Config.validate(mergedConfig);
        } catch (err) {
            if (err.name === 'YAMLParseError') {
                throw new Error(`统一配置文件格式错误: ${err.message}`);
            }
            throw err;
        }
    }

    /**
     * 从模块独立配置文件加载（向后兼容）
     * @param {string} configPath - 配置文件路径
     * @returns {Object} 配置对象
     * @throws {Error} 配置文件不存在或格式错误
     */
    static load(configPath) {
        // 解析相对路径
        const absolutePath = path.isAbsolute(configPath) 
            ? configPath 
            : path.resolve(process.cwd(), configPath);

        // 检查文件是否存在
        if (!fs.existsSync(absolutePath)) {
            throw new Error(`配置文件不存在: ${absolutePath}`);
        }

        // 读取并解析 YAML
        try {
            const content = fs.readFileSync(absolutePath, 'utf8');
            const userConfig = YAML.parse(content) || {};
            
            // 合并默认配置
            const mergedConfig = Config.mergeWithDefaults(userConfig);
            
            // 验证配置
            return Config.validate(mergedConfig);
        } catch (err) {
            if (err.name === 'YAMLParseError') {
                throw new Error(`配置文件格式错误: ${err.message}`);
            }
            throw err;
        }
    }

    /**
     * 深度合并用户配置和默认配置
     * @param {Object} userConfig - 用户配置
     * @returns {Object} 合并后的配置
     */
    static mergeWithDefaults(userConfig) {
        return Config._deepMerge(DEFAULT_CONFIG, userConfig);
    }

    /**
     * 深度合并对象
     * @param {Object} target - 目标对象
     * @param {Object} source - 源对象
     * @returns {Object} 合并后的对象
     */
    static _deepMerge(target, source) {
        const result = { ...target };
        
        for (const key in source) {
            if (source[key] !== undefined) {
                if (
                    typeof source[key] === 'object' && 
                    source[key] !== null && 
                    !Array.isArray(source[key]) &&
                    typeof target[key] === 'object' &&
                    target[key] !== null
                ) {
                    result[key] = Config._deepMerge(target[key], source[key]);
                } else {
                    result[key] = source[key];
                }
            }
        }
        
        return result;
    }

    /**
     * 验证配置
     * @param {Object} config - 配置对象
     * @returns {Object} 验证后的配置
     * @throws {Error} 配置验证失败
     */
    static validate(config) {
        const errors = [];

        // 验证截图间隔
        if (typeof config.screenshot.interval !== 'number' || 
            config.screenshot.interval < 1 || 
            config.screenshot.interval > 3600) {
            errors.push('screenshot.interval 必须是 1-3600 之间的数字');
        }

        // 验证图片格式
        if (!['jpeg', 'png', 'jpg'].includes(config.screenshot.format)) {
            errors.push('screenshot.format 必须是 jpeg 或 png');
        }

        // 验证质量
        if (typeof config.screenshot.quality !== 'number' || 
            config.screenshot.quality < 1 || 
            config.screenshot.quality > 100) {
            errors.push('screenshot.quality 必须是 1-100 之间的数字');
        }

        // 验证尺寸
        if (![25, 50, 75, 100].includes(config.screenshot.dimension)) {
            errors.push('screenshot.dimension 必须是 25, 50, 75 或 100');
        }

        // 验证时间格式
        const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (config.schedule.enabled) {
            if (!timeRegex.test(config.schedule.start_time)) {
                errors.push('schedule.start_time 格式错误，应为 HH:MM');
            }
            if (!timeRegex.test(config.schedule.end_time)) {
                errors.push('schedule.end_time 格式错误，应为 HH:MM');
            }
        }

        // 验证停止时间列表
        if (config.schedule.stop_times !== undefined) {
            if (!Array.isArray(config.schedule.stop_times)) {
                errors.push('schedule.stop_times 必须是 HH:MM 字符串数组');
            } else {
                for (const time of config.schedule.stop_times) {
                    if (typeof time !== 'string' || !timeRegex.test(time)) {
                        errors.push(`schedule.stop_times 包含无效时间: ${time}`);
                    }
                }
            }
        }

        // 验证工作日
        const validDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        if (config.schedule.enabled && Array.isArray(config.schedule.days)) {
            for (const day of config.schedule.days) {
                if (!validDays.includes(day)) {
                    errors.push(`schedule.days 包含无效的工作日: ${day}`);
                }
            }
        }

        // 验证日志级别
        const validLevels = ['debug', 'info', 'warn', 'error'];
        if (!validLevels.includes(config.logging.level)) {
            errors.push('logging.level 必须是 debug, info, warn 或 error');
        }

        // 如果有错误，抛出异常
        if (errors.length > 0) {
            throw new Error(`配置验证失败:\n  - ${errors.join('\n  - ')}`);
        }

        // 展开所有路径中的 ~（跨平台兼容）
        Config._expandAllPaths(config);

        return config;
    }

    /**
     * 展开路径中的 ~ 为用户主目录（跨平台兼容）
     * Mac: ~ → /Users/username
     * Windows: ~ → C:\Users\username
     * @param {string} filePath - 可能包含 ~ 的路径
     * @returns {string} 展开后的路径
     */
    static _expandHome(filePath) {
        if (!filePath || typeof filePath !== 'string') {
            return filePath;
        }
        if (filePath === '~') {
            return os.homedir();
        }
        if (filePath.startsWith('~/') || filePath.startsWith('~\\')) {
            return path.join(os.homedir(), filePath.slice(2));
        }
        return filePath;
    }

    /**
     * 展开配置中所有路径字段的 ~
     * @param {Object} config - 配置对象
     * @returns {Object} 路径已展开的配置对象
     */
    static _expandAllPaths(config) {
        // 截图存储目录
        if (config.storage && config.storage.directory) {
            config.storage.directory = Config._expandHome(config.storage.directory);
        }
        // 日志文件路径
        if (config.logging && config.logging.file) {
            config.logging.file = Config._expandHome(config.logging.file);
        }
        return config;
    }

    /**
     * 获取默认配置
     * @returns {Object} 默认配置对象
     */
    static getDefaults() {
        return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }
}

module.exports = Config;
