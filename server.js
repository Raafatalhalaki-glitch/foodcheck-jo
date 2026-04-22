const express = require('express');
const path = require('path');
const app = express();

app.use(express.json({ limit: '50mb' }));

// ── Static files من مجلد public ──
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes صريحة للملفات الحساسة ──
app.get('/additives.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'additives.html'));
});

// ── حماية codex_data.json من الوصول المباشر ──
app.get('/codex_data.json', (req, res) => {
  res.status(403).json({ error: 'Forbidden' });
});

// ── API داخلي آمن للبيانات — يُستخدم من الكود فقط ──
app.get('/api/codex', (req, res) => {
  const ref = req.headers['referer'] || '';
  const host = req.headers['host'] || '';
  // السماح فقط من نفس الموقع
  if (!ref.includes(host) && !ref.includes('tpc-foodcheck.com') && !ref.includes('localhost')) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.sendFile(path.join(__dirname, 'public', 'codex_data.json'));
});

// ── Rate limiting ──
const requests = {};
app.use((req, res, next) => {
  if (req.path !== '/api/analyze') return next();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();
  if (!requests[ip]) requests[ip] = [];
  requests[ip] = requests[ip].filter(t => now - t < 60 * 60 * 1000);
  if (requests[ip].length >= 10) {
    return res.status(429).json({ error: 'تجاوزت الحد المسموح — حاول بعد ساعة' });
  }
  requests[ip].push(now);
  next();
});

// ── API endpoint ──
app.post('/api/analyze', async (req, res) => {
  try {
    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'مفتاح API غير مضبوط' });
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'خطأ في السيرفر: ' + err.message });
  }
});

// ── Catch-all ──
app.get('*', (req, res) => {
  if (path.extname(req.path)) {
    return res.status(404).send('Not found');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FoodCheck running on port ${PORT}`));
