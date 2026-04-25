const express = require('express');
const path = require('path');
const app = express();
app.use(express.json({ limit: '50mb' }));

// ملفات ثابتة من public
app.use(express.static(path.join(__dirname, 'public')));

// Routes صريحة للصفحات
app.get('/additives.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'additives.html'));
});
app.get('/report.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'report.html'));
});
app.get('/codex_data.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'codex_data.json'));
});

// ================================================================
// ===== نظام عداد الفحوصات =====
// ================================================================

// قاعدة بيانات بسيطة في الذاكرة
// (تُعاد عند إعادة تشغيل السيرفر — كافية للمرحلة الحالية)
const usageDB = {
  // بالـ IP: { daily: [{timestamp}], total: number }
  byIP: {},
  // إجماليات
  stats: {
    total_checks: 0,
    today_checks: 0,
    last_reset: new Date().toDateString()
  }
};

// الحد اليومي للزوار غير المسجلين
const FREE_DAILY_LIMIT = 5;

// دالة تنظيف الإحصائيات اليومية
function resetDailyIfNeeded() {
  const today = new Date().toDateString();
  if (usageDB.stats.last_reset !== today) {
    usageDB.stats.today_checks = 0;
    usageDB.stats.last_reset = today;
    // تنظيف السجلات القديمة لكل IP
    for (const ip in usageDB.byIP) {
      const now = Date.now();
      usageDB.byIP[ip].daily = usageDB.byIP[ip].daily.filter(
        t => now - t < 24 * 60 * 60 * 1000
      );
    }
  }
}

// API للحصول على معلومات الاستخدام
app.get('/api/usage', (req, res) => {
  resetDailyIfNeeded();
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || req.socket.remoteAddress;
  const userUsage = usageDB.byIP[ip] || { daily: [], total: 0 };
  const now = Date.now();
  const todayCount = userUsage.daily.filter(
    t => now - t < 24 * 60 * 60 * 1000
  ).length;

  res.json({
    today: todayCount,
    limit: FREE_DAILY_LIMIT,
    remaining: Math.max(0, FREE_DAILY_LIMIT - todayCount),
    total: userUsage.total || 0,
    canCheck: todayCount < FREE_DAILY_LIMIT
  });
});

// API إحصائيات عامة (للـ dashboard لاحقاً)
app.get('/api/stats', (req, res) => {
  resetDailyIfNeeded();
  res.json({
    total_checks: usageDB.stats.total_checks,
    today_checks: usageDB.stats.today_checks,
    active_ips: Object.keys(usageDB.byIP).length
  });
});

// ================================================================
// ===== Rate Limiting + Usage Counter =====
// ================================================================

const requests = {};

app.use((req, res, next) => {
  if (req.path !== '/api/analyze') return next();

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || req.socket.remoteAddress;
  const now = Date.now();

  // Rate limiting (10 طلبات/ساعة — للحماية من الاستخدام المفرط)
  if (!requests[ip]) requests[ip] = [];
  requests[ip] = requests[ip].filter(t => now - t < 60 * 60 * 1000);
  if (requests[ip].length >= 10) {
    return res.status(429).json({
      error: 'تجاوزت الحد المسموح — حاول بعد ساعة',
      type: 'rate_limit'
    });
  }

  // عداد الفحوصات اليومية
  resetDailyIfNeeded();
  if (!usageDB.byIP[ip]) usageDB.byIP[ip] = { daily: [], total: 0 };
  const todayChecks = usageDB.byIP[ip].daily.filter(
    t => now - t < 24 * 60 * 60 * 1000
  ).length;

  if (todayChecks >= FREE_DAILY_LIMIT) {
    return res.status(429).json({
      error: `وصلت للحد اليومي المجاني (${FREE_DAILY_LIMIT} فحوصات/يوم)`,
      type: 'daily_limit',
      today: todayChecks,
      limit: FREE_DAILY_LIMIT,
      reset_in: '24 ساعة'
    });
  }

  // تسجيل الطلب
  requests[ip].push(now);
  req._ip = ip;
  next();
});

// ================================================================
// ===== API التحليل الرئيسي =====
// ================================================================

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

    // تسجيل الاستخدام بعد نجاح التحليل
    if (response.ok && req._ip) {
      const ip = req._ip;
      const now = Date.now();
      usageDB.byIP[ip].daily.push(now);
      usageDB.byIP[ip].total = (usageDB.byIP[ip].total || 0) + 1;
      usageDB.stats.total_checks++;
      usageDB.stats.today_checks++;

      // إضافة معلومات الاستخدام للرد
      const todayCount = usageDB.byIP[ip].daily.filter(
        t => now - t < 24 * 60 * 60 * 1000
      ).length;
      data._usage = {
        today: todayCount,
        limit: FREE_DAILY_LIMIT,
        remaining: Math.max(0, FREE_DAILY_LIMIT - todayCount)
      };
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'خطأ في السيرفر: ' + err.message });
  }
});

// الصفحة الرئيسية
app.get('*', (req, res) => {
  if (req.path.includes('.')) return res.status(404).send('Not found');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`FoodCheck running on port ${PORT}`));
