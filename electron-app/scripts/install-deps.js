#!/usr/bin/env node

/**
 * 安装子模块的 node_modules 到打包资源中
 * 在打包前执行，确保 extraResources 包含完整的依赖
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..', '..');

const modules = ['auto_screenshot', 'ai_summary'];

for (const mod of modules) {
    const modDir = path.join(projectRoot, mod);
    const pkgFile = path.join(modDir, 'package.json');

    if (!fs.existsSync(pkgFile)) {
        console.log(`跳过 ${mod}：未找到 package.json`);
        continue;
    }

    console.log(`安装 ${mod} 依赖...`);
    try {
        execSync('npm install --production', {
            cwd: modDir,
            stdio: 'inherit'
        });
        console.log(`${mod} 依赖安装完成`);
    } catch (err) {
        console.error(`${mod} 依赖安装失败:`, err.message);
        process.exit(1);
    }
}

console.log('所有子模块依赖安装完成');
