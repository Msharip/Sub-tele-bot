#Sub Bot — بوت اشتراكات 

بوت تيليغرام مخصص لإدارة اشتراكات المستخدمين، يتيح للمستخدمين تفعيل اشتراكاتهم وتمديدها والوصول إلى قنوات تنبيه المنتجات.

---

##المميزات

- ✅ تفعيل الاشتراك برمز تفعيل خاص
- 🔄 تمديد الاشتراك الحالي تلقائيًا
- 📊 عرض حالة الاشتراك وعدد الأيام المتبقية
- 🔔 الوصول إلى قنوات التنبيه لكل نكهة بشكل منفصل
- ⏰ عرض أوقات توفر المنتجات لآخر 5 أيام
-  عرض معرف المستخدم
-  Rate Limiting لحماية البوت من الإساءة
- 🧹 حذف تلقائي للإشعارات القديمة يوميًا
-  Cache ذكي لتقليل الضغط على قاعدة البيانات

---

## التقنيات المستخدمة

| التقنية | الاستخدام |
|---|---|
| Node.js | بيئة التشغيل |
| Express.js | خادم Webhook |
| node-telegram-bot-api | التعامل مع Telegram API |
| MySQL2 | قاعدة البيانات |
| node-cache | التخزين المؤقت |
| moment-timezone | إدارة التواريخ بتوقيت الرياض |
| dotenv | إدارة المتغيرات البيئية |

---

## ⚙️ المتطلبات

- Node.js v16+
- MySQL Database
- بوت تيليغرام (من [@BotFather](https://t.me/BotFather))
- خادم مع Public URL لـ Webhook (مثل Heroku أو Railway)

---

## طريقة التثبيت

```bash
# استنساخ المشروع
git clone https://github.com/Msharip/sub-dzrt-bot.git
cd sub-dzrt-bot

# تثبيت الحزم
npm install
```

---

## 🔐 إعداد المتغيرات البيئية

```env
TOKEN4=your_telegram_bot_token
WEBHOOK_URL=https://your-deployment-url.com

DB_HOST=your_database_host
DB_USER=your_database_user
DB_PASSWORD=your_database_password
DB_DATABASE=your_database_name
DB_PORT=3306

PORT=3000
```

---

## 🗃️ قاعدة البيانات

يحتاج البوت إلى الجداول التالية:

**`users`** — بيانات المستخدمين والاشتراكات:
```sql
CREATE TABLE users (
  id BIGINT PRIMARY KEY,
  activated BOOLEAN DEFAULT false,
  subscriptionType VARCHAR(50),
  startDate DATE,
  expiryDate DATE
);
```

**`activationcodes`** — رموز التفعيل:
```sql
CREATE TABLE activationcodes (
  activation_code VARCHAR(100) PRIMARY KEY,
  duration_in_months INT
);
```

**`activated_codes`** — سجل الرموز المستخدمة:
```sql
CREATE TABLE activated_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  chat_id BIGINT,
  activation_code VARCHAR(100),
  activation_date DATETIME,
  duration INT
);
```

**`product_notifications`** — أوقات إشعارات المنتجات:
```sql
CREATE TABLE product_notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  notification_time DATETIME
);
```

---

## ▶️ تشغيل البوت

```bash
node index.js
```

---

## 📋 أوامر البوت

| الأمر / الزر | الوظيفة |
|---|---|
| `/start` | عرض القائمة الرئيسية |
| تفعيل الاشتراك 🔑 | إدخال رمز لتفعيل اشتراك جديد |
| تمديد الاشتراك 🔄 | إدخال رمز لتمديد اشتراك حالي |
| حالة الاشتراك 📊 | عرض الأيام المتبقية |
| قنوات التنبيهات 🔔 | روابط قنوات كل نكهة |
| اوقات المنتجات ⏰ | عرض أول وقت توفر خلال 5 أيام |
| معرف المستخدم 🆔 | عرض الـ Chat ID |

---
---

## 📄 الرخصة

هذا المشروع خاص وغير مرخص للاستخدام العام.
