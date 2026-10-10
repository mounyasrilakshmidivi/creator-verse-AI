/* Free AI layer: Pollinations.ai (no API key, no signup).
   Text  -> /api/chat (our tiny proxy in serve.ps1 or api/chat.js) with streaming,
            falling back to Pollinations' public endpoint if the proxy isn't there
   Image -> URL-based generation (the URL itself is the image) */
const AI = (() => {
  const PROXY_URL = '/api/chat';
  const FALLBACK_URL = 'https://gen.pollinations.ai/v1/chat/completions';
  const IMAGE_URL = 'https://image.pollinations.ai/prompt/';
  let proxyAvailable = location.protocol.startsWith('http');

  async function request(body, signal) {
    if (proxyAvailable) {
      const res = await fetch(PROXY_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
      });
      // Only a missing proxy (static hosting) switches to the public endpoint; a slow or failed upstream is retried instead.
      if (res.status !== 404 && res.status !== 405) return res;
      proxyAvailable = false;
    }
    // Static hosting / file:// fallback: public endpoint, no streaming
    return fetch(FALLBACK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, stream: false }), signal,
    });
  }

  // Whole replies (not streamed): the free upstream often stalls on streamed responses, which used to leave chats with no reply.
  const TIMEOUT_MS = 40000;
  async function chat(messages, { onToken, onThinking, signal } = {}) {
    const body = { model: 'openai', messages, stream: false, private: true };
    let res, lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
      signal?.addEventListener('abort', () => ac.abort(), { once: true });
      try { res = await request(body, ac.signal); }
      catch (err) {
        if (signal?.aborted) throw err;
        lastErr = err; res = null;  // timeout or network error: try again
        continue;
      } finally { clearTimeout(timer); }
      if (res.ok) break;
      // free tier is rate limited, so back off and retry
      if (res.status === 429 || res.status >= 500) {
        await new Promise(r => setTimeout(r, 2500 * (attempt + 1)));
        continue;
      }
      if (res.status === 402 || res.status === 401 || res.status === 403) {
        throw new Error('Free AI limit reached for now. Wait a bit, or add a free Pollinations key (see README).');
      }
      throw new Error(`AI service error (${res.status})`);
    }
    if (!res || !res.ok) throw new Error(lastErr && !res ? 'The free AI service did not answer in time. Please try again.' : 'The free AI service is busy. Please try again in a moment.');

    const type = res.headers.get('content-type') || '';
    if (!type.includes('event-stream') || !res.body) {
      const data = await res.json();
      const text = (data.choices?.[0]?.message?.content ?? '').trim();
      if (!text) throw new Error('The free AI service returned an empty reply. Please try again.');
      onToken?.(text, text);
      return text;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const delta = JSON.parse(payload).choices?.[0]?.delta || {};
          if (delta.reasoning) onThinking?.();
          if (delta.content) {
            full += delta.content;
            onToken?.(delta.content, full);
          }
        } catch { /* partial / keep-alive line */ }
      }
    }
    return full.trim();
  }

  function imageUrl(prompt, { width = 1024, height = 1024, seed } = {}) {
    seed = seed ?? Math.floor(Math.random() * 1e9);
    if (location.protocol.startsWith('http')) {
      return '/api/image?' + new URLSearchParams({ prompt, width, height, seed });
    }
    return IMAGE_URL + encodeURIComponent(prompt) + '?' + new URLSearchParams({ width, height, seed, nologo: 'true' });
  }

  // Resolves to a displayable URL, or throws an Error whose .code is 'limit' or 'busy'
  async function loadImage(url, tries = 3) {
    if (!url.startsWith('/api/')) {
      // direct mode (file://): let the <img> tag fetch it
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(url);
        img.onerror = () => reject(Object.assign(new Error('Image service is busy'), { code: 'busy' }));
        img.src = url;
      });
    }
    for (let i = 0; i < tries; i++) {
      const res = await fetch(url);
      if (res.ok && (res.headers.get('content-type') || '').startsWith('image')) {
        return URL.createObjectURL(await res.blob());
      }
      if (res.status === 402 || res.status === 401 || res.status === 403) {
        throw Object.assign(new Error('Free hourly image limit reached'), { code: 'limit' });
      }
      await new Promise(r => setTimeout(r, 3000 * (i + 1)));
    }
    throw Object.assign(new Error('Image service is busy'), { code: 'busy' });
  }

  // Pull a JSON array/object out of an LLM reply that might include extra prose or code fences
  function extractJSON(text) {
    const cleaned = text.replace(/```(?:json)?/gi, '');
    const start = cleaned.search(/[\[{]/);
    const end = Math.max(cleaned.lastIndexOf(']'), cleaned.lastIndexOf('}'));
    if (start === -1 || end === -1) throw new Error('No JSON found');
    return JSON.parse(cleaned.slice(start, end + 1));
  }

  return { chat, imageUrl, loadImage, extractJSON };
})();
