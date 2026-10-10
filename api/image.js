// Vercel serverless function: same /api/image proxy as serve.ps1.
export default async function handler(req, res) {
  const key = process.env.POLLINATIONS_KEY;
  const { prompt = '', width = 1024, height = 1024, seed = 0 } = req.query;
  const p = encodeURIComponent(String(prompt).slice(0, 1500));
  const params = `width=${+width}&height=${+height}&seed=${+seed}&nologo=true`;
  const url = key ? `https://gen.pollinations.ai/image/${p}?${params}` : `https://image.pollinations.ai/prompt/${p}?${params}`;
  try {
    const upstream = await fetch(url, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
    if (!upstream.ok) return res.status(upstream.status).json({ error: 'upstream', status: upstream.status });
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    res.status(502).json({ error: 'upstream' });
  }
}
