/**
 * 配置管理模块
 * 负责读取和写入 config.yaml
 */

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

class ConfigManager {
    /**
     * 创建配置管理器
     * @param {string} configPath - config.yaml 路径
     */
    constructor(configPath) {
        this.configPath = configPath;
    }

    /**
     * 读取配置文件
     * @returns {Object} 解析后的配置对象
     */
    load() {
        try {
            const content = fs.readFileSync(this.configPath, 'utf8');
            return YAML.parse(content);
        } catch (err) {
            throw new Error(`读取配置失败: ${err.message}`);
        }
    }

    /**
     * 保存配置到文件
     * @param {Object} config - 配置对象
     */
    save(config) {
        try {
            const content = YAML.stringify(config, {
                indent: 2,
                lineWidth: 0 // 不自动换行
            });

            // 在顶部添加注释
            const header = '# Work Monitor - 统一配置文件\n# 详细说明见 config.example.yaml\n\n';
            fs.writeFileSync(this.configPath, header + content, 'utf8');
        } catch (err) {
            throw new Error(`保存配置失败: ${err.message}`);
        }
    }

    /**
     * 读取示例配置
     * @returns {string} 示例配置文件内容
     */
    loadExample() {
        try {
            const examplePath = path.join(path.dirname(this.configPath), 'config.example.yaml');
            return fs.readFileSync(examplePath, 'utf8');
        } catch (err) {
            return '# 示例配置文件未找到';
        }
    }

    /**
     * 检查配置文件是否存在
     * @returns {boolean}
     */
    exists() {
        return fs.existsSync(this.configPath);
    }
}

module.exports = ConfigManager;
