/**
 * 截图引擎模块
 * 执行屏幕截图和图像处理
 */

const screenshot = require('screenshot-desktop');
const sharp = require('sharp');

class Screenshot {
    /**
     * 创建截图引擎实例
     * @param {Object} config - 截图配置
     * @param {string} config.format - 图片格式 (jpeg/png)
     * @param {number} config.quality - JPEG 质量 (1-100)
     * @param {number} config.dimension - 尺寸百分比 (25/50/75/100)
     * @param {string|Array} config.monitors - 显示器选择 ("all" 或索引数组)
     */
    constructor(config) {
        this.format = config.format === 'png' ? 'png' : 'jpg';
        this.quality = config.quality || 80;
        this.dimension = config.dimension || 100;
        this.monitors = config.monitors || 'all';
        
        // 缓存显示器列表
        this._displays = null;
    }

    /**
     * 获取显示器列表
     * @param {boolean} refresh - 是否刷新缓存
     * @returns {Promise<Array>} 显示器数组
     */
    async listDisplays(refresh = false) {
        if (!this._displays || refresh) {
            this._displays = await screenshot.listDisplays();
        }
        return this._displays;
    }

    /**
     * 获取要截图的显示器列表
     * @returns {Promise<Array>} 过滤后的显示器数组，包含索引
     */
    async getTargetDisplays() {
        const allDisplays = await this.listDisplays();
        
        // 添加索引信息
        const displaysWithIndex = allDisplays.map((display, index) => ({
            ...display,
            index: index + 1  // 从 1 开始的索引
        }));
        
        // 如果是 "all"，返回所有显示器
        if (this.monitors === 'all') {
            return displaysWithIndex;
        }
        
        // 如果是数组，返回指定索引的显示器
        if (Array.isArray(this.monitors)) {
            return displaysWithIndex.filter(d => 
                this.monitors.includes(d.index - 1) || 
                this.monitors.includes(d.index)
            );
        }
        
        return displaysWithIndex;
    }

    /**
     * 截取单个显示器
     * @param {Object} display - 显示器对象
     * @returns {Promise<Buffer>} 图像数据
     */
    async capture(display) {
        const options = {
            format: this.format,
            quality: this.quality,
            screen: display.id
        };
        
        return await screenshot(options);
    }

    /**
     * 处理图像（调整尺寸）
     * @param {Buffer} imageBuffer - 原始图像
     * @returns {Promise<Buffer>} 处理后的图像
     */
    async process(imageBuffer) {
        // 如果尺寸是 100%，不需要处理
        if (this.dimension >= 100) {
            return imageBuffer;
        }
        
        // 获取原始图像元数据
        const metadata = await sharp(imageBuffer).metadata();
        const newWidth = Math.round(metadata.width * (this.dimension / 100));
        
        // 调整尺寸
        const processedBuffer = await sharp(imageBuffer)
            .resize({ width: newWidth })
            .toBuffer();
        
        return processedBuffer;
    }

    /**
     * 截取所有配置的显示器
     * @returns {Promise<Array<{display: Object, buffer: Buffer}>>}
     */
    async captureAll() {
        const displays = await this.getTargetDisplays();
        const results = [];
        
        for (const display of displays) {
            try {
                // 截图
                let buffer = await this.capture(display);
                
                // 处理图像（调整尺寸）
                buffer = await this.process(buffer);
                
                results.push({
                    display,
                    buffer
                });
            } catch (err) {
                // 单个显示器截图失败不影响其他显示器
                console.error(`显示器 ${display.index} 截图失败: ${err.message}`);
            }
        }
        
        return results;
    }
}

module.exports = Screenshot;
