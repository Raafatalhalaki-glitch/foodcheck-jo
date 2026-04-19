const express = require('express');
const path = require('path');
const app = express();

app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => {
  if (req.path.endsWith('.json')) {
    res.setHeader('Content-Type', 'application/json');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiting بسيط
const requests = {};
app.use((req, res, next) => {
  if (req.path !== '/api/analyze') return next();
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const now = Date.now();
  if (!requests[ip]) requests[ip] = [];
  requests[ip] = requests[ip].filter(t => now - t < 60 * 60 * 1000); // آخر ساعة
  if (requests[ip].length >= 10) {
    return res.status(429).json({ error: 'تجاوزت الحد المسموح — حاول بعد ساعة' });
  }
  requests[ip].push(now);
  next();
});

// API endpoint
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

// كل الطلبات الثانية ترجع الموقع
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FoodCheck running on port ${PORT}`));
