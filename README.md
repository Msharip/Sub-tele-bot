# Sub Bot — بوت إدارة اشتراكات

بوت تيليغرام مبني لإدارة اشتراكات، يتحكم بالوصول لقنوات تنبيه منتجات عالية الطلب تنفد بسرعة كبيرة.

> مشروع خاص — معروض كنموذج عمل فقط

---

## فكرة المشروع

المستخدمون يشترون رمزًا من الموقع الالكتروني الخاص بي، يُدخلونه في البوت، فيحصلون على وصول لقنوات تنبيه مخصصة تُعلمهم فور توفر المنتجات. البوت يتحكم بكل شيء: التفعيل، التمديد، الصلاحيات، وعرض الإحصائيات.

---

## التقنيات المستخدمة

**Node.js · Express.js · Telegram Bot API · MySQL2 · node-cache · moment-timezone**

---

## شرح الكود — ميزة بميزة

### 1. Webhook بدلًا من Polling
```js
bot.setWebHook(`${url}/bot${token}`);
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});
```
البوت لا يسأل تيليغرام باستمرار — بل تيليغرام هو من يُرسل التحديثات للسيرفر فور وصولها. أسرع وأخف على الموارد، ومناسب للنشر على Heroku.

---

### 2. Connection Pool لقاعدة البيانات
```js
const pool = mysql.createPool({ connectionLimit: 26, ... });
```
بدل فتح اتصال جديد مع كل طلب، يوجد pool من 26 اتصال جاهز. يُقلل التأخير ويمنع تحميل قاعدة البيانات عند التزامن.

---

### 3. نظام Cache ذكي بمستويين
```js
const cache = new NodeCache({ stdTTL: 7200 });        // حالة الاشتراك — ساعتان
const productCache = new NodeCache({ stdTTL: 43200 }); // أوقات المنتجات — 12 ساعة
const userMessagesCache = new NodeCache({ stdTTL: 86400 }); // رسائل المستخدمين — يوم
```
ثلاث ذواكر مؤقتة بأوقات انتهاء مختلفة حسب طبيعة البيانات. حالة الاشتراك تُحفظ ساعتين لتجنب الاستعلام من قاعدة البيانات مع كل رسالة.

---

### 4. منطق التفعيل — ثلاث حالات مختلفة
```js
// حالة 1: مستخدم جديد → INSERT
// حالة 2: مستخدم منتهي اشتراكه → UPDATE من البداية
// حالة 3: مستخدم نشط → تمديد فوق الاشتراك الحالي
if (user) {
  if (moment(user.expiryDate).isBefore(startDate)) {
    // تجديد
  } else {
    await extendUserSubscription(...);
  }
} else {
  // مستخدم جديد
}
```
الكود يتعامل مع كل حالة بمنطق مستقل — لا يعيد الكتابة على اشتراك نشط بالخطأ.

---

### 5. رموز التفعيل تدعم الأيام والأشهر
```js
if (duration < 0) {
  expiryDate.add(Math.abs(duration), 'days');
  subscriptionType = `${Math.abs(duration)} يوم`;
} else {
  expiryDate.add(duration, 'months');
  subscriptionType = `${duration} أشهر`;
}
```
رقم سالب = أيام، رقم موجب = أشهر. حيلة بسيطة تجعل نفس الجدول يدعم نوعين من الاشتراكات.

---

### 6. Database Transaction لضمان سلامة البيانات
```js
await connection.beginTransaction();
// ... تحديث المستخدم + حذف الرمز
await connection.commit();
// في حال خطأ:
await connection.rollback();
```
التفعيل وحذف الرمز يحدثان معًا أو لا يحدثان أبدًا — لا يمكن استخدام رمز مرتين حتى لو انقطع الاتصال في المنتصف.

---

### 7. التمديد يحسب الإجمالي بذكاء
```js
let existingMonths = parseInt(user.subscriptionType.split(' ')[0], 10);
totalDuration = `${existingMonths + duration} أشهر`;
```
لو المستخدم عنده شهرين ومدّد بشهر، البوت يحسب ويعرض "3 أشهر" — لا يبدأ من صفر.

---

### 8. Rate Limiting لمنع الإساءة
```js
const timeLimit = 30000; // 30 ثانية
if (currentTime - lastStartTime < timeLimit) {
  bot.sendMessage(chatId, '⚠️ تجنب ارسال امر /start متكرر');
  return;
}
```
المستخدم لا يستطيع إرسال `/start` أكثر من مرة كل 30 ثانية — يحمي البوت من الإغراق.

---

### 9. State Machine لاستقبال الرموز
```js
const activeUsers = new Map(); // يحفظ "activating" أو "extending"

bot.on('message', async (msg) => {
  if (activeUsers.has(userId)) {
    const code = msg.text.trim();
    // معالجة الرمز...
    activeUsers.delete(userId);
  }
});
```
البوت يتذكر أن المستخدم في "وضع إدخال الرمز" عبر Map في الذاكرة. بعد معالجة الرمز يُحذف من الـ Map تلقائيًا.

---

### 10. تنظيف الرسائل القديمة
```js
previousMessages.forEach(messageId => {
  bot.deleteMessage(chatId, messageId).catch(() => {});
});
```
كل ما أرسل البوت رسالة قديمة يحذفها قبل إرسال الجديدة — المحادثة تبقى نظيفة.

---

### 11. أوقات المنتجات للمشتركين فقط
```js
const isSubscribed = await isUserSubscribed(userId);
if (!isSubscribed) {
  bot.sendMessage(chatId, '⚠️ هذا الخيار متاح للمشتركين فقط.');
  return;
}
```
ميزة "أوقات المنتجات" محمية — تُعرض أوقات أول توفر لكل منتج خلال آخر 5 أيام، للمشتركين حصرًا.

---

### 12. تنظيف تلقائي يومي
```js
setInterval(deleteOldNotifications, 24 * 60 * 60 * 1000);
```
كل 24 ساعة البوت يحذف سجلات الإشعارات الأقدم من 5 أيام — قاعدة البيانات لا تتضخم مع الوقت.

---

### 13. استعادة الجلسات عند إعادة التشغيل
```js
const restoreMessages = async () => {
  const users = userMessagesCache.keys();
  for (const userId of users) {
    // إعادة إرسال القائمة لكل مستخدم كان نشطًا
  }
};
restoreMessages();
```
عند إعادة تشغيل السيرفر، البوت يُرسل القائمة من جديد لكل مستخدم كان نشطًا — لا يُترك أحد بدون استجابة.

---

### 14. واجهة ديناميكية حسب حالة الاشتراك
```js
const mainKeyboard = (isSubscribed) => ({
  inline_keyboard: isSubscribed ? [
    // قنوات التنبيهات، تمديد، أوقات المنتجات، حالة الاشتراك ...
  ] : [
    // تفعيل الاشتراك، القروب العام ...
  ]
});
```
المشترك يرى قائمة مختلفة كليًا عن غير المشترك — الأزرار تتغير ديناميكيًا بناءً على حالته في قاعدة البيانات.

---

## 🗄️ قاعدة البيانات — الجداول وكيف يتعامل معها البوت

البوت يستخدم **4 جداول** في MySQL، كل جدول له دور محدد في دورة حياة الاشتراك.

---

### جدول `users` — قلب النظام
يحفظ كل مستخدم تفاعل مع البوت وسجل اشتراكه.

| العمود | النوع | الوصف |
|---|---|---|
| `id` | BIGINT | معرف المستخدم من تيليغرام — المفتاح الأساسي |
| `activated` | BOOLEAN | `1` = مشترك نشط، `0` = منتهي أو غير مشترك |
| `subscriptionType` | VARCHAR | نص يصف المدة مثل `"3 أشهر"` أو `"7 يوم"` |
| `startDate` | DATE | تاريخ بداية الاشتراك الحالي |
| `expiryDate` | DATE | تاريخ انتهاء الاشتراك — الأهم في النظام |

**كيف يقرأ منه البوت:**
```js
// للتحقق إذا المستخدم مشترك — يُستدعى مع كل تفاعل
SELECT activated FROM users WHERE id = ?

// لعرض حالة الاشتراك وحساب الأيام المتبقية
SELECT * FROM users WHERE id = ?
const remainingDays = Math.floor((new Date(user.expiryDate) - new Date()) / (1000 * 60 * 60 * 24));
```

**كيف يكتب فيه:**
```js
// مستخدم جديد — أول مرة يفعّل
INSERT INTO users (id, activated, subscriptionType, startDate, expiryDate)
VALUES (userId, true, '3 أشهر', '2024-01-01', '2024-04-01')

// مستخدم قديم منتهي — يجدد من صفر
UPDATE users SET activated=true, subscriptionType=?, startDate=?, expiryDate=? WHERE id=?

// مستخدم نشط — يمدد فوق اشتراكه الحالي
UPDATE users SET expiryDate=?, subscriptionType=? WHERE id=?
```

---

### جدول `activationcodes` — رموز التفعيل المتاحة
يحفظ الرموز الجاهزة للاستخدام. كل رمز يُستخدم مرة واحدة فقط ثم يختفي.

| العمود | النوع | الوصف |
|---|---|---|
| `activation_code` | VARCHAR | الرمز الذي يُدخله المستخدم — مفتاح أساسي |
| `duration_in_months` | INT | المدة: رقم موجب = أشهر، رقم سالب = أيام (مثال: `-7` يعني 7 أيام) |

**كيف يقرأ منه البوت:**
```js
// عند إدخال الرمز — يتحقق هل موجود وصالح
SELECT * FROM activationcodes WHERE activation_code = ?
```

**كيف يكتب فيه:**
```js
// بعد الاستخدام يُحذف فورًا لمنع إعادة الاستخدام
DELETE FROM activationcodes WHERE activation_code = ?
```

> الحذف والتسجيل في `activated_codes` يحدثان داخل **Transaction واحدة** — إما الاثنان معًا أو لا شيء.

---

### جدول `activated_codes` — أرشيف الرموز المستخدمة
سجل تاريخي لكل رمز تم استخدامه — للمراجعة والتدقيق من الإدارة.

| العمود | النوع | الوصف |
|---|---|---|
| `id` | INT | مفتاح تلقائي |
| `chat_id` | BIGINT | معرف المستخدم الذي استخدم الرمز |
| `activation_code` | VARCHAR | الرمز الذي استُخدم |
| `activation_date` | DATETIME | وقت الاستخدام بتوقيت الرياض |
| `duration` | INT | المدة التي كانت في الرمز |

**كيف يكتب فيه البوت:**
```js
// يُسجل الرمز قبل حذفه من activationcodes
INSERT INTO activated_codes (chat_id, activation_code, activation_date, duration)
VALUES (userId, 'ABC123', '2024-01-01 14:30:00', 3)
```
> البوت يكتب فيه فقط ولا يقرأ منه — هو للإدارة.

---

### جدول `product_notifications` — سجل أوقات توفر المنتجات
يُسجّل فيه بوت التنبيهات كل مرة يُكتشف فيها توفر منتج.

| العمود | النوع | الوصف |
|---|---|---|
| `id` | INT | مفتاح تلقائي |
| `notification_time` | DATETIME | الوقت الذي تم فيه اكتشاف توفر المنتج |

**كيف يقرأ منه البوت:**
```js
// لعرض أول وقت توفر في آخر 5 أيام — للمشتركين فقط
SELECT notification_time 
FROM product_notifications 
WHERE notification_time >= [تاريخ_قبل_5_أيام]
ORDER BY notification_time ASC
```

**التنظيف التلقائي كل 24 ساعة:**
```js
DELETE FROM product_notifications WHERE notification_time < [تاريخ_قبل_5_أيام]
```

---

### كيف يعرف البوت إذا المستخدم مشترك؟

```
المستخدم يضغط أي زر
        ↓
البوت يبحث في Cache أولاً (ساعتان صلاحية)
        ↓
   موجود في Cache؟
   نعم ✅ → يرجع النتيجة فورًا — بدون قاعدة بيانات
   لا  ❌ → يسأل قاعدة البيانات
              ↓
     SELECT activated FROM users WHERE id = ?
              ↓
     activated = 1  →  مشترك نشط ✅
     activated = 0  →  منتهي الاشتراك ❌
     لا نتيجة       →  غير مسجل أصلاً ❌
              ↓
     يحفظ النتيجة في Cache لساعتين
```

---

## 📸 شكل الواجهة

**للمشترك:**
```
[ قنوات التنبيهات 🔔 ]  [ تمديد الاشتراك 🔄 ]
[ اوقات المنتجات ⏰  ]  [ حالة الاشتراك 📊  ]
[ الدعم الفني 📩      ]  [ معرف المستخدم 🆔  ]
[          المتجر 🛒           ]
```

**لغير المشترك:**
```
[ معرف المستخدم 🆔 ]  [ تفعيل الاشتراك 🔑 ]
[ الدعم الفني 📩    ]  [ القروب العام 📢    ]
[        المتجر 🛒         ]
```
