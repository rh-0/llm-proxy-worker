// 使用cloudflare将cc switch请求转发相应的ai api提供商
// 轮训使用多个api key
// 环境变量 AIP_KEY, REDIS_URL(redis的url), REDIS_TOKEN(redis的token)
// redis官网: https://console.upstash.com/


export default {
    async fetch(request, env, ctx) {
        const apiKey = JSON.parse(env.AIP_KEY);

        // 打印传入参数
        const bodyText = request.method !== 'GET' && request.method !== 'HEAD' ? await request.clone().text() : '';
        console.log(`传入参数: method=${request.method},URL=${request.url},body=${bodyText}`);

        // 修改 url
        const modifyUrl = modifyURL(request);

        // 克隆请求并针对目标API对其进行修改
        const cleanedHeaders = new Headers();
        for (const [key, value] of request.headers) {
            // 跳过Cloudflare特定的标头和我们要清理的其他标头
            if (!key.toLowerCase().startsWith('cf-') && !['x-real-ip', 'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-forwarded-port', 'x-forwarded-scheme', 'x-forwarded-ssl', 'cdn-loop'].includes(key.toLowerCase())) {
                cleanedHeaders.set(key, value);
            }
        }
        // 处理CORS前请求
        if (request.method === 'OPTIONS') {
            return handleCORS(request);
        }
        try {
            await waitLock(env);
            // 延迟4秒
            await new Promise(r => setTimeout(r, 4000));
            let count = await getNextKeyIndex(env);
            // 使用AIP_KEY数组中的值依次替换
            const selectApiKey = apiKey[count % apiKey.length];
            cleanedHeaders.set('Authorization', `Bearer ${selectApiKey}`);

            // 发送请求
            const modifiedRequest = new Request(modifyUrl.toString(), {
                method: request.method, headers: cleanedHeaders, body: request.body, redirect: 'follow'
            });
            console.log(`发送的请求标头: ${JSON.stringify(Object.fromEntries(cleanedHeaders.entries()), null, 2)}`);
            const response = await fetch(modifiedRequest);
            // 克隆一份专门用于打印日志，避免消费原始响应流
            const clonedResponse = response.clone();
            console.log(`收到 response 的状态: ${clonedResponse.status}`);
            console.log(`收到 response 的内容: ${await clonedResponse.text()}`);

            // 使用CORS标头创建新响应
            const modifiedResponse = new Response(response.body, {
                status: response.status, statusText: response.statusText, headers: response.headers
            });

            // 添加CORS标头
            modifiedResponse.headers.set('Access-Control-Allow-Origin', request.headers.get('Origin') || '*');
            modifiedResponse.headers.set('Access-Control-Allow-Credentials', 'true');

            return modifiedResponse;
        } catch (error) {
            console.error(`将请求代理到时出错: `, error);
            return new Response(`将请求代理到时出错: ${error.message}`, {status: 500});
        } finally {
            await releaseLock(env);
        }
    }
};

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

// 修改URL为 https://api.cerebras.ai
function modifyURL(request) {
    const originalUrl = new URL(request.url);
    const modifyUrl = new URL('https://api.cerebras.ai');
    modifyUrl.pathname = originalUrl.pathname;
    modifyUrl.search = originalUrl.search;
    console.log(`原始URL: ${originalUrl.toString()}`);
    console.log(`目标URL: ${modifyUrl.toString()}`);
    return modifyUrl;
}

// 连接redis
async function redisCommand(env, command) {
    const response = await fetch(env.REDIS_URL, {
        method: "POST", headers: {
            "Authorization": `Bearer ${env.REDIS_TOKEN}`, "Content-Type": "application/json"
        }, body: JSON.stringify(command)
    });
    return response.json();
}

// 上锁
async function acquireLock(env) {
    const result = await redisCommand(env, ["SET", "ai_lock", Date.now(), "NX", "EX", 10]);
    return result.result === "OK";
}

// 等待锁
async function waitLock(env) {
    while (true) {
        const ok = await acquireLock(env);
        if (ok) {
            return;
        }
        await new Promise(r => setTimeout(r, 1000));
    }
}

// 解锁
async function releaseLock(env) {
    await redisCommand(env, ["DEL", "ai_lock"]);

}

// 原子递增函数
async function getNextKeyIndex(env) {
    // INCR 会自动加 1 并返回新值，不需要先 GET
    const result = await redisCommand(env, ["INCR", "count"]);
    // INCR 返回的是字符串数字，需要转为整数
    return parseInt(result.result);
}
