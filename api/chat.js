// Vercel serverless function: same /api/chat proxy as serve.ps1, for free cloud hosting.
// Set POLLINATIONS_KEY in the Vercel project's environment variables for higher limits.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const key = process.env.POLLINATIONS_KEY;
  try {
    const upstream = await fetch(key ? 'https://gen.pollinations.ai/v1/chat/completions' : 'https://text.pollinations.ai/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key && { Authorization: `Bearer ${key}` }) },
      body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body),
    });
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    res.setHeader('Cache-Control', 'no-cache');
    const reader = upstream.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch {
    res.status(502).json({ error: 'upstream' });
  }
}
