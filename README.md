# 通用LLM代理 Cloudflare Worker

这是一个通用的LLM（大语言模型）代理Cloudflare Worker，可以将请求转发到多种AI服务提供商的API。通过简单的URL路径配置，您可以使用单个Worker代理所有主流LLM服务。

## 功能特点

- **统一接口**：使用一致的URL路径格式代理到不同的LLM服务
- **多服务支持**：内置支持OpenAI、Anthropic(Claude)、Google Gemini、Groq、SambaNova等
- **易于扩展**：只需添加新的端点配置即可支持更多服务
- **CORS支持**：自动处理跨域请求问题
- **无状态设计**：简洁高效的实现方式

## 如何使用

### 部署Worker

1. 在Cloudflare注册并创建Worker
2. 将`worker.js`文件内容复制到Worker编辑器中
3. 根据需要修改`LLM_ENDPOINTS`配置
4. 保存并部署

### 使用方法

通过在URL路径前缀中指定服务提供商名称来路由请求：

```
https://your-worker.workers.dev/{provider}/{original-api-path}
```

例如：

- OpenAI: `/openai/v1/chat/completions`
- Claude: `/anthropic/v1/messages`
- Gemini: `/gemini/v1beta/models/gemini-pro:generateContent`
- Groq: `/groq/chat/completions`

### API密钥

您需要在请求中包含各服务所需的API密钥。Worker只是转发请求，不会修改或添加认证信息。

## Worker代码说明

该Worker的工作原理：

1. **路由解析**：提取URL路径中的第一个段作为提供商标识符
2. **端点匹配**：根据提供商标识符查找对应的API端点
3. **请求转换**：重新构建目标URL并转发请求
4. **响应处理**：返回API响应并添加CORS头

Worker通过简单的配置对象`LLM_ENDPOINTS`来定义路由映射关系，每个键值对表示一个LLM服务及其端点。

## 自定义配置

您可以根据需要修改`LLM_ENDPOINTS`对象添加其他LLM服务：

```javascript
const LLM_ENDPOINTS = {
  'openai': 'https://api.openai.com',
  'anthropic': 'https://api.anthropic.com',
  'gemini': 'https://generativelanguage.googleapis.com',
  'groq': 'https://api.groq.com',
  'sambanova': 'https://api.sambanova.ai',
  'azure': 'https://YOUR_AZURE_RESOURCE_NAME.openai.azure.com',
  // 添加更多服务...
};
```

## 高级用法

对于需要特殊处理的API（如格式转换或参数调整），您可以扩展Worker代码添加额外处理逻辑。

## 注意事项

- 此Worker默认仅转发请求，不会缓存、修改或存储任何数据
- 确保您有权限访问相应的API并持有有效的API密钥
- 生产环境使用时，建议增加速率限制、请求验证等安全措施

## 贡献

欢迎通过Issues或Pull Requests贡献改进意见和代码。

## 许可

MIT
