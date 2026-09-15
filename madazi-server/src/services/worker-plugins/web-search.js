/**
 * web_search 插件
 * 联网搜索（DuckDuckGo HTML API，免费无 key）
 */
export default {
  name: 'web_search',
  description: '★ 联网搜索。当需要查最新文档、API 用法、库版本信息、错误解决方案时使用。返回搜索结果摘要（标题+摘要+URL）。搜索英文关键词效果更好。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词，如 "react useEffect cleanup" 或 "npm express body-parser"' },
      max_results: { type: 'number', description: '返回结果数量，默认5，最多10' },
    },
    required: ['query'],
  },
  async execute(args, ctx) {
    const query = args.query || '';
    if (!query) return JSON.stringify({ error: 'query 不能为空' });
    const maxResults = Math.min(args.max_results || 5, 10);
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
        signal: AbortSignal.timeout(10000),
      });
      const html = await resp.text();
      // 解析 DuckDuckGo HTML 结果
      const results = [];
      const linkRegex = /<a[^>]+class="result__a"[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
      const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      const links = [...html.matchAll(linkRegex)];
      const snippets = [...html.matchAll(snippetRegex)];
      for (let i = 0; i < Math.min(links.length, maxResults); i++) {
        let href = links[i][1];
        // DuckDuckGo 重定向：提取实际 URL
        const uddg = href.match(/uddg=([^&]+)/);
        if (uddg) href = decodeURIComponent(uddg[1]);
        const title = links[i][2].replace(/<[^>]*>/g, '').trim();
        const snippet = snippets[i] ? snippets[i][1].replace(/<[^>]*>/g, '').trim() : '';
        results.push({ title, url: href, snippet });
      }
      return JSON.stringify({ query, results, count: results.length });
    } catch (e) {
      return JSON.stringify({ error: `搜索失败: ${e.message}` });
    }
  },
};
