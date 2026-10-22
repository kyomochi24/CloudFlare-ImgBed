export async function onRequest(context) {
  const { request } = context;
  const pathname = new URL(request.url).pathname;
  const blockedPath = ['/api', '/upload', '/dav'].some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (blockedPath || !['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) {
    return new Response(JSON.stringify({ error: '图床正在更新维护，请稍后重试。已有图片链接仍可访问。' }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Retry-After': '300'
      }
    });
  }
  return context.next();
}
