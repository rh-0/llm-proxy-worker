// Cloudflare Worker：转发到 requesty，多 Key 轮询
// 环境变量：
//   AIP_KEY      - JSON 数组字符串，如 ["sk-or-1","sk-or-2"]
//   CLIENT_KEYS  - JSON 数组字符串，客户端可使用的 Key，如 ["my-client-key-1","my-client-key-2"] 简单鉴权
//   REDIS_URL    - Upstash Redis REST URL
//   REDIS_TOKEN  - Upstash Redis token
// redis官网: https://console.upstash.com/


export default {
    async fetch(request, env, ctx) {
        // ---------- 简单鉴权：没有合法客户端 Key → 直接拒绝 ----------
        const clientKeys = parseJsonArray(env.CLIENT_KEYS);
        if (!clientKeys.length) {
            console.error("CLIENT_KEYS 未配置或为空");
            return new Response("服务器配置错误: CLIENT_KEYS", { status: 500 });
        }

        const authHeader = request.headers.get("Authorization") || "";
        const clientKey = extractBearer(authHeader);

        if (!clientKey || !clientKeys.includes(clientKey)) {
            return withCORS(
            request,
            new Response(JSON.stringify({ error: "Unauthorized" }), {
                status: 401,
                headers: { "Content-Type": "application/json" },
            })
            );
        }

        const apiKey = JSON.parse(env.AIP_KEY);

        // 打印传入参数
        // const bodyText = request.method !== 'GET' && request.method !== 'HEAD' ? await request.clone().text() : '';
        // console.log(`传入参数: method=${request.method},URL=${request.url},body=${bodyText}`);

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
            // await waitLock(env);
            // 延迟1秒 1000
            // await new Promise(r => setTimeout(r, 1));
            let count = await getNextKeyIndex(env);
            // 使用AIP_KEY数组中的值依次替换
            const selectApiKey = apiKey[count % apiKey.length];
            cleanedHeaders.set('Authorization', `Bearer ${selectApiKey}`);

            // 发送请求
            const modifiedRequest = new Request(modifyUrl.toString(), {
                method: request.method, headers: cleanedHeaders, body: request.body, redirect: 'follow'
            });
            // console.log(`发送的请求标头: ${JSON.stringify(Object.fromEntries(cleanedHeaders.entries()), null, 2)}`);
            const response = await fetch(modifiedRequest);
            const headers = new Headers(response.headers);
            headers.set('Access-Control-Allow-Origin', request.headers.get('Origin') || '*');
            headers.set('Access-Control-Allow-Credentials', 'true');
            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers
            });
        } catch (error) {
            console.error(`代理出错: `, error);
            return new Response(`代理出错: ${error.message}`, {status: 500});
        } finally {
            // await releaseLock(env);
        }
    }
};

// 处理 CORS 预检请求
function handleCORS(request) {
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

// 修改URL为 https://router.requesty.ai
function modifyURL(request) {
    const originalUrl = new URL(request.url);
    const modifyUrl = new URL('https://router.requesty.ai');
    modifyUrl.pathname = originalUrl.pathname;
    modifyUrl.search = originalUrl.search;
    // console.log(`原始URL: ${originalUrl.toString()}`);
    // console.log(`目标URL: ${modifyUrl.toString()}`);
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
    const result = await redisCommand(env, ["SET", "cloudflare:requesty:ai_lock", Date.now(), "NX", "EX", 10]);
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
    await redisCommand(env, ["DEL", "cloudflare:requesty:ai_lock"]);

}

// 原子递增函数
async function getNextKeyIndex(env) {
    // INCR 会自动加 1 并返回新值，不需要先 GET
    const result = await redisCommand(env, ["INCR", "cloudflare:requesty:count"]);
    // INCR 返回的是字符串数字，需要转为整数
    return parseInt(result.result);
}

function parseJsonArray(raw) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : [];
  } catch {
    return [];
  }
}

function extractBearer(authHeader) {
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return m ? m[1].trim() : "";
}

function withCORS(request, response) {
  const headers = new Headers(response.headers);
  const c = corsHeaders(request);
  for (const [k, v] of Object.entries(c)) headers.set(k, v);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function corsHeaders(request) {
  return {
    "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      request.headers.get("Access-Control-Request-Headers") ||
      "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "4096",
  };
}
