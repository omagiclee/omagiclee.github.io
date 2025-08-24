+++
date = '2025-01-27T10:00:00+08:00'
draft = false
title = 'CDN 配置测试'
description = '测试自定义 CDN 配置是否正确加载'
categories = ['test']
tags = ['cdn', 'mermaid', 'test']
+++

# CDN 配置测试

## 环境信息

- **Hugo 环境**：{{ hugo.Environment }}
- **配置的 CDN**：{{ .Site.Params.cdn }}
- **CDN 数据源**：{{ .Site.Params.cdn.data }}

## 强制加载 Mermaid 11.10.1

<script>
(function() {
    console.log('🔧 开始强制加载 Mermaid 11.10.1...');
    
    // 移除所有现有的 Mermaid 脚本
    const existingScripts = document.querySelectorAll('script[src*="mermaid"]');
    console.log('找到现有 Mermaid 脚本数量:', existingScripts.length);
    existingScripts.forEach(script => {
        console.log('移除脚本:', script.src);
        script.remove();
    });
    
    // 等待一下确保移除完成
    setTimeout(function() {
        // 加载指定版本的 Mermaid
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/mermaid@11.10.1/dist/mermaid.min.js';
        script.onload = function() {
            console.log('✅ Mermaid 11.10.1 加载成功');
            if (typeof mermaid !== 'undefined') {
                console.log('Mermaid 版本:', mermaid.version);
                // 重新初始化所有 Mermaid 图表
                mermaid.initialize({ 
                    startOnLoad: true,
                    theme: 'default'
                });
                
                // 查找所有 Mermaid 图表并重新渲染
                const mermaidElements = document.querySelectorAll('.mermaid');
                console.log('找到 Mermaid 图表数量:', mermaidElements.length);
                mermaidElements.forEach(element => {
                    try {
                        mermaid.init(undefined, element);
                    } catch (error) {
                        console.error('渲染图表失败:', error);
                    }
                });
            }
        };
        script.onerror = function() {
            console.error('❌ 加载 Mermaid 11.10.1 失败');
        };
        document.head.appendChild(script);
    }, 100);
})();
</script>

## Mermaid 测试

{{< mermaid >}}
graph TD
    A[开始] --> B{CDN 配置}
    B -->|正确| C[✅ 加载成功]
    B -->|错误| D[❌ 加载失败]
    C --> E[显示图表]
    D --> F[检查配置]
{{< /mermaid >}}

## 版本检测

<script>
document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
        const versionInfo = document.getElementById('version-info');
        
        if (typeof mermaid !== 'undefined') {
            // 尝试多种方式获取版本
            let version = '未知';
            if (mermaid.version) {
                version = mermaid.version;
            } else if (mermaid.default && mermaid.default.version) {
                version = mermaid.default.version;
            } else if (window.mermaid && window.mermaid.version) {
                version = window.mermaid.version;
            }
            
            // 检查 mermaid 对象的属性
            const mermaidProps = Object.keys(mermaid).join(', ');
            
            // 检查页面上的脚本标签
            const mermaidScripts = Array.from(document.querySelectorAll('script[src*="mermaid"]'))
                .map(script => script.src)
                .join('<br>');
            
            versionInfo.innerHTML = `
                <div style="background: #d4edda; padding: 15px; border-radius: 5px; margin: 10px 0;">
                    <h3>✅ Mermaid 加载成功</h3>
                    <p><strong>版本：</strong> ${version}</p>
                    <p><strong>状态：</strong> 正常运行</p>
                    <p><strong>Mermaid 属性：</strong> ${mermaidProps}</p>
                    <p><strong>类型：</strong> ${typeof mermaid}</p>
                    <p><strong>页面中的 Mermaid 脚本：</strong></p>
                    <div style="background: #f8f9fa; padding: 10px; border-radius: 3px; font-family: monospace; font-size: 12px;">
                        ${mermaidScripts || '无'}
                    </div>
                </div>
            `;
        } else {
            versionInfo.innerHTML = `
                <div style="background: #f8d7da; padding: 15px; border-radius: 5px; margin: 10px 0;">
                    <h3>❌ Mermaid 未加载</h3>
                    <p><strong>可能的原因：</strong></p>
                    <ul>
                        <li>CDN 配置未生效</li>
                        <li>网络连接问题</li>
                        <li>版本号错误</li>
                    </ul>
                </div>
            `;
        }
    }, 3000); // 增加延迟时间，确保强制加载完成
});
</script>

<div id="version-info">
    <p>正在检测 Mermaid 版本...</p>
</div>

## 网络请求检查

请在浏览器开发者工具的 Network 面板中查看是否有以下请求：

- `mermaid@11.10.1/dist/mermaid.min.js`
- 或者 `lib/mermaid/mermaid.min.js` (本地文件)

## 配置详情

**当前配置：**
- CDN 类型：`custom`
- 配置文件：`assets/data/cdn/custom.yml`
- Mermaid 版本：`11.10.1`
- 环境：`production`

## 控制台输出

请在浏览器控制台中查看以下信息：

1. `🔧 开始强制加载 Mermaid 11.10.1...`
2. `找到现有 Mermaid 脚本数量: [数量]`
3. `移除脚本: [脚本URL]`
4. `✅ Mermaid 11.10.1 加载成功`
5. `Mermaid 版本: 11.10.1`
6. `找到 Mermaid 图表数量: [数量]`

如果看到这些信息，说明强制加载成功。
