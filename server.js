const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json({ limit: '50mb' }));

// ── تحميل البيانات ──
let CODEX = null;
try {
  const raw = fs.readFileSync(path.join(__dirname, 'public', 'codex_data.json'), 'utf8');
  CODEX = JSON.parse(raw);
  console.log('✅ Codex loaded');
} catch (e) {
  console.error('❌ Failed to load codex:', e.message);
}

// ── static ──
app.use(express.static(path.join(__dirname, 'public')));

// ── helper JSON extractor ──
function extractBalancedJson(text) {
  if (!text) return null;

  const cleaned = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  const start = cleaned.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;

      if (depth === 0) {
        return cleaned.slice(start, i + 1);
      }
    }
  }

  return null;
}

// ── API analyze ──
app.post('/api/analyze', async (req, res) => {
  try {
    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      return res.json({ ok: false, error: '❌ API key غير موجود' });
    }

    const systemPrompt = `
أنت مدقق بطاقات بيان غذائية.
أعد النتيجة بصيغة JSON فقط.
ابدأ بـ { وانتهِ بـ }.
ممنوع أي نص خارج JSON.
`;

    const payload = {
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4000,
      temperature: 0,
      system: systemPrompt,
      messages: req.body.messages || []
    };

    // ⏱️ timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeout);

    const data = await response.json();

    if (!response.ok) {
      return res.json({
        ok: false,
        error: data?.error?.message || '❌ API error',
        raw: data
      });
    }

    const rawText =
      data?.content?.map(x => x?.text || '').join('\n').trim() || '';

    const extracted = extractBalancedJson(rawText);

    // 🔥 أهم تعديل (ما يكسر النظام)
    if (!extracted) {
      console.log("⚠️ RAW AI:", rawText);

      return res.json({
        ok: true,
        parsed: {
          fallback: true,
          message: "⚠️ AI لم يرجع JSON - تم عرض النص الخام",
          ai_output: rawText
        },
        rawText
      });
    }

    let parsed;

    try {
      parsed = JSON.parse(extracted);
    } catch (e) {
      console.log("❌ JSON parse error:", e.message);

      return res.json({
        ok: true,
        parsed: {
          fallback: true,
          message: "⚠️ JSON غير صالح - عرض النص الخام",
          ai_output: rawText
        },
        rawText
      });
    }

    return res.json({
      ok: true,
      parsed,
      rawText
    });

  } catch (err) {
    return res.json({
      ok: false,
      error:
        err.name === 'AbortError'
          ? '⏱️ انتهى الوقت - حاول مرة ثانية'
          : '❌ Server error: ' + err.message
    });
  }
});

// ── fallback route ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── start ──
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
