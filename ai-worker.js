// 使用cloudflare将cc switch请求转发相应的ai api提供商
// LLM服务端点映射
//通过在URL路径前缀中指定服务提供商名称来路由请求：https://your-worker.workers.dev/{provider}/{original-api-path}
//https://groq.rhdm.site/groq/openai/v1/chat/completions
const LLM_ENDPOINTS = {
    'featherless': 'https://featherless.ai',
    'cerebras': 'https://api.cerebras.ai',
    'openrouter': 'https://openrouter.ai',
    'openai': 'https://api.openai.com',
    'anthropic': 'https://api.anthropic.com',
    'gemini': 'https://generativelanguage.googleapis.com',
    'groq': 'https://api.groq.com',
    'sambanova': 'https://api.sambanova.ai',
    'azure': 'https://YOUR_AZURE_RESOURCE_NAME.openai.azure.com', // Add more providers as needed
};

addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
    // Add logging
    const bodyText = request.method !== 'GET' && request.method !== 'HEAD' ? await request.clone().text() : '';
    console.log(`传入参数: method=${request.method},URL=${request.url},body=${bodyText}`);

    // 处理CORS前请求
    if (request.method === 'OPTIONS') {
        return handleCORS(request);
    }

    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(part => part);

    // 检查第一个路径段是否与我们的任何LLM提供商匹配
    if (pathParts.length > 0 && LLM_ENDPOINTS[pathParts[0]]) {
        const provider = pathParts[0];
        const targetEndpoint = LLM_ENDPOINTS[provider];
        console.log(`代理请求到 ${provider} at ${targetEndpoint}`);

        // 从路径中删除提供程序前缀
        let newPathname = '/' + pathParts.slice(1).join('/');

        // 创建新的目标URL
        const targetUrl = new URL(targetEndpoint);
        targetUrl.pathname = newPathname;
        targetUrl.search = url.search;

        // 克隆请求并针对目标API对其进行修改
        const cleanedHeaders = new Headers();
        for (const [key, value] of request.headers) {
            // 跳过Cloudflare特定的标头和我们要清理的其他标头
            if (!key.toLowerCase().startsWith('cf-') && !['x-real-ip', 'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-forwarded-port', 'x-forwarded-scheme', 'x-forwarded-ssl', 'cdn-loop'].includes(key.toLowerCase())) {
                cleanedHeaders.set(key, value);
            }
        }
        // 发送请求
        const modifiedRequest = new Request(targetUrl.toString(), {
            method: request.method, headers: cleanedHeaders, body: request.body, redirect: 'follow'
        });
        console.log(`目标URL: ${targetUrl.toString()}`);
        console.log(`发送的请求标头: ${JSON.stringify(Object.fromEntries(cleanedHeaders.entries()), null, 2)}`);

        // 将请求转发到相应的LLM API
        try {
            console.log('转发带有已清理标头的请求:',
                JSON.stringify(Object.fromEntries(cleanedHeaders.entries()), null, 2));
            const response = await fetch(modifiedRequest);
            console.log(`收到的响应及其状态: ${response.status}`);

            // 使用CORS标头创建新响应
            const modifiedResponse = new Response(response.body, {
                status: response.status, statusText: response.statusText, headers: response.headers
            });

            // 添加CORS标头
            modifiedResponse.headers.set('Access-Control-Allow-Origin', request.headers.get('Origin') || '*');
            modifiedResponse.headers.set('Access-Control-Allow-Credentials', 'true');

            return modifiedResponse;
        } catch (error) {
            console.error(`Error proxying request to ${provider}:`, error);
            return new Response(`Error proxying request to ${provider}: ${error.message}`, {status: 500});
        }
    }

    // If no valid provider is specified in the path
    // console.log('Invalid provider path requested');
    return new Response('Invalid LLM provider path. Use /provider/api/path format.', {status: 400});
}

function handleCORS(request) {
    // 处理 CORS 预检请求
    const corsHeaders = {
        'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') || 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '4096'
    };

    return new Response(null, {
        status: 204, headers: corsHeaders
    });
}
