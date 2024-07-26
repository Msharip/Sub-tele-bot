const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mysql = require('mysql2/promise');
const cron = require('node-cron');
require('rate-limiter-flexible');
const NodeCache = require("node-cache");
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  port: process.env.DB_PORT,
  waitForConnections: true,  // الانتظار للاتصالات عند الوصول إلى الحد الأقصى
  connectionLimit: 25,       // الحد الأقصى لعدد الاتصالات في التجمع
  queueLimit: 0              // عدم وجود حد لطول قائمة الانتظار
};
const token = process.env.TOKEN4;
const bot = new TelegramBot(token, { polling: { interval: 2000 } }); // 2 ثانية
const pool = mysql.createPool(dbConfig);
const activeUsers = new Map();
const userClicks = new Map();
const rateLimitMap = new Map(); // لتتبع آخر وقت تلقى فيه المستخدم أمر /start
const userSubscriptions = new Map(); // لتخزين حالة الاشتراك مؤقتًا

// تفعيل اشتراك المستخدم
async function activateUserSubscription(userId, code, duration, callback) {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [existingUsers] = await connection.execute('SELECT * FROM users WHERE id = ?', [userId]);

    const user = existingUsers.length > 0 ? existingUsers[0] : null;

    if (user) {
      await extendUserSubscription(connection, userId, code, duration, callback);
    } else {
      const startDate = new Date().toISOString().split('T')[0];
      let expiryDate = new Date();
      if (duration < 0) {
        expiryDate.setDate(expiryDate.getDate() - duration);
      } else {
        expiryDate.setMonth(expiryDate.getMonth() + duration);
      }

      const insertQuery = `
        INSERT INTO users (id, activated, subscriptionType, startDate, expiryDate)
        VALUES (?, ?, ?, ?, ?)
      `;
      await connection.execute(insertQuery, [userId, true, `${Math.abs(duration)} ${duration < 0 ? 'يوم' : 'أشهر'}`, startDate, expiryDate.toISOString().split('T')[0]]);
      await deleteActivationCode(connection, code);
      await connection.commit();
      callback(`**تم تفعيل اشتراكك بنجاح لمدة ${Math.abs(duration)} ${duration < 0 ? 'يوم' : 'أشهر'}.** 🎉`);
    }

    await connection.execute('UPDATE users SET activated = true WHERE id = ?', [userId]);
    userSubscriptions.set(userId, true); // تحديث حالة الاشتراك في الذاكرة المؤقتة
    cache.set(userId, true); // تحديث التخزين المؤقت
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Error activating subscription:', err);
    callback('⚠️ حدث خطأ أثناء تفعيل الاشتراك.');
  } finally {
    if (connection) connection.release();
  }
}

// تمديد اشتراك المستخدم
async function extendUserSubscription(connection, userId, code, duration, callback) {
  try {
    const [existingUsers] = await connection.execute('SELECT * FROM users WHERE id = ?', [userId]);
    const user = existingUsers.length > 0 ? existingUsers[0] : null;

    if (!user) {
      callback('ليس لديك اشتراك حاليًا ⚠️');
      return;
    }

    let expiryDate = new Date(user.expiryDate);
    let totalDuration = '';

    if (user.subscriptionType.includes('يوم')) {
      if (duration > 0) {
        expiryDate = new Date();
        expiryDate.setMonth(expiryDate.getMonth() + duration);
        totalDuration = `${duration} أشهر`;
      } else {
        expiryDate.setDate(expiryDate.getDate() - duration);
        const totalDays = user.subscriptionType.match(/\d+/) ? parseInt(user.subscriptionType.match(/\d+/)[0]) - duration : Math.abs(duration);
        totalDuration = `${totalDays} يوم`;
      }
    } else {
      if (duration < 0) {
        expiryDate.setDate(expiryDate.getDate() - duration);
        const totalMonths = user.subscriptionType.match(/\d+/) ? parseInt(user.subscriptionType.match(/\d+/)[0]) + Math.floor(duration / 30) : Math.abs(duration);
        totalDuration = `${totalMonths} أشهر`;
      } else {
        expiryDate.setMonth(expiryDate.getMonth() + duration);
        const totalMonths = user.subscriptionType.match(/\d+/) ? parseInt(user.subscriptionType.match(/\d+/)[0]) + duration : duration;
        totalDuration = `${totalMonths} أشهر`;
      }
    }

    const updateQuery = `
      UPDATE users SET expiryDate = ?, subscriptionType = ? WHERE id = ?
    `;
    await connection.execute(updateQuery, [expiryDate.toISOString().split('T')[0], totalDuration, userId]);
    await deleteActivationCode(connection, code);
    await connection.commit();
    callback(`**تم تمديد اشتراكك بنجاح لمدة ${Math.abs(duration)} ${duration < 0 ? 'يوم' : 'أشهر'}.**\n\n الآن مجموع الاشتراك هو ${totalDuration} 🎉`);
    cache.set(userId, true); // تحديث التخزين المؤقت
  } catch (err) {
    console.error('Error extending subscription:', err);
    callback('⚠️ حدث خطأ أثناء تمديد الاشتراك.');
  }
}
// حذف كود التفعيل
async function deleteActivationCode(connection, code) {
  const deleteQuery = 'DELETE FROM activationcodes WHERE activation_code = ?';
  await connection.execute(deleteQuery, [code]);
}
const cache = new NodeCache({ stdTTL: 7200 }); // مدة التخزين المؤقت ساعتين (7200 ثانية)

// دالة للتحقق من حالة التفعيل
async function isUserSubscribed(userId) {
  // إذا كانت حالة التفعيل مخزنة وصالحة، قم بإعادتها مباشرة
  const cachedActivation = cache.get(userId);
  if (cachedActivation !== undefined) {
    return cachedActivation;
  }

  // تحقق من قاعدة البيانات إذا لم تكن الحالة مخزنة
  let connection;
  try {
    connection = await pool.getConnection();
    const [results] = await connection.execute('SELECT activated FROM users WHERE id = ?', [userId]);
    if (results.length > 0) {
      const user = results[0];
      const isActivated = user.activated === 1;
      cache.set(userId, isActivated); // تحديث حالة التفعيل في الذاكرة المؤقتة
      return isActivated;
    } else {
      cache.set(userId, false); // إذا لم يكن هناك سجل للمستخدم
      return false;
    }
  } catch (err) {
    console.error('Error checking activation status:', err);
    return false;
  } finally {
    if (connection) connection.release();
  }
}
// لوحة مفاتيح قنوات التنبيهات
const notificationChannelsKeyboard = {
  inline_keyboard: [
    [
      { text: 'سي سايد 🌊', url: 'https://t.me/+5sBd8-LCYR9hMDBk' },
      { text: 'ايسي رش ❄️', url: 'https://t.me/+gqDbjTPNS9NiMjJk' }
    ],
    [
      { text: 'هيلة 🌾', url: 'https://t.me/+iPjCEuLjIadkMmU0' },
      { text: 'هيلاند بيريز 🍇', url: 'https://t.me/+-l3iURW1JJQ2MDBk' }
    ],
    [
      { text: 'تمرة 🌴', url: 'https://t.me/+T62d0ZHKjfY2NTlk' },
      { text: 'سمرة 🌟', url: 'https://t.me/+MSFh3FWe_vs5MjY0' }
    ],
    [
      { text: 'جاردن منت 🍃', url: 'https://t.me/+Sul2NHCi-s9jNGM8' },
      { text: 'منت فيوجن 🍃', url: 'https://t.me/+G3R8OkjZk2w1ZWE8' }
    ],
    [
      { text: 'بيربل ميست 🌺', url: 'https://t.me/+b529gE_uouxiOThk' },
      { text: 'ايدجي منت ☘ ', url: 'https://t.me/+P34lacNg8gZiOTlk' }
    ],
    [
      { text: 'جميع المنتجات 🛒', url: 'https://t.me/+3imWhRxXVngxMWE0' }
    ],
    [
      { text: 'رجوع 🔙', callback_data: 'start' }
    ]
  ]
};
// لوحة مفاتيح الدعم الفني والعودة
const userMessagesMap = new Map();
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const currentTime = new Date().getTime();
  const lastStartTime = rateLimitMap.get(userId) || 0;
  // تحديد فترة السماح بالمللي ثانية (مثلاً 20 ثانية)
  const timeLimit = 20000;
  if (currentTime - lastStartTime < timeLimit) {
    bot.sendMessage(chatId, '⚠️ تجنب ارسال امر - /start - متكرر\n\n تم ايقاف الامر موقتا لمده من الوقت');
    return;
  }
  // تحديث آخر وقت تلقى فيه المستخدم أمر /start
  rateLimitMap.set(userId, currentTime);
  userClicks.set(userId, 0);
  // حذف الرسائل السابقة
  if (userMessagesMap.has(userId)) {
    const previousMessages = userMessagesMap.get(userId);
    previousMessages.forEach(messageId => {
      bot.deleteMessage(chatId, messageId).catch((error) => {
        console.error('Error deleting previous message:', error);
      });
    });
    userMessagesMap.delete(userId);
  }
  const isSubscribed = await isUserSubscribed(userId);
  const mainKeyboard = {
    inline_keyboard: isSubscribed ? [
      [
        { text: 'قنوات التنبيهات 🔔', callback_data: 'notification_channels_command' },
        { text: 'تمديد الاشتراك 🔄', callback_data: 'activate_subscription_command' }
      ],
      [
        { text: 'اوقات المنتجات ⏰', callback_data: 'product_availability_command' },
        { text: 'حالة الاشتراك 📊', callback_data: 'subscription_status_command' }
      ],
      [
        { text: 'الدعم الفني 📩', url: 'https://t.me/MZZ_2' },
        { text: 'معرف المستخدم 🆔', callback_data: 'chat_id_command' }
      ],
      [
        { text: 'المتجر 🛒', url: 'www.dzrtgg.com' }
      ]
    ] : [
      [
        { text: 'معرف المستخدم 🆔', callback_data: 'chat_id_command' },
        { text: 'تفعيل الاشتراك 🔑', callback_data: 'activate_subscription_command' }
      ],
      [
        { text: 'الدعم الفني 📩', url: 'https://t.me/MZZ_2' },
        { text: 'القروب العام 📢', url: 'https://t.me/+hrIusgChjeMwY2Zk' }
      ],
      [
        { text: 'المتجر 🛒', url: 'www.dzrtgg.com' }
      ]
    ]
  };

  const welcomeMessage = `
⚡ **انضم إلى البوت الأسرع والأكثر تقدمًا** ⚡

قروب دزرت فوري العام 👇🏻:
[قروب دزرت فوري](https://t.me/+hrIusgChjeMwY2Zk)

- قم بزيارة متجرنا الآن
- أكمل عملية الشراء
- استخدم الرمز لتفعيل الاشتراك
- وبإمكانك تمديد اشتراكك

👇🏻 **قم بزيارة المتجر والاشتراك!** 👇🏻
                           www.dzrtgg.com
`;
  bot.sendMessage(chatId, welcomeMessage, {
    reply_markup: mainKeyboard,
    parse_mode: 'Markdown'
  }).then((sentMessage) => {
    userMessagesMap.set(userId, [sentMessage.message_id]);
  });

  bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const callbackUserId = callbackQuery.from.id;
    if (callbackUserId !== userId) return;
    const updateMessage = (text, keyboard, msg) => {
      const isContentDifferent = msg.text !== text;
      const isKeyboardDifferent = JSON.stringify(msg.reply_markup) !== JSON.stringify(keyboard);
      if (isContentDifferent || isKeyboardDifferent) {
        bot.editMessageText(text, {
          chat_id: msg.chat.id,
          message_id: msg.message_id,
          reply_markup: keyboard,
          parse_mode: 'Markdown'
        }).catch((error) => {
          if (error.response.body.error_code === 400 && error.response.body.description.includes("message is not modified")) {
            // لا يوجد تغيير في الرسالة
          }
        });
      }
    };

    if (data === 'notification_channels_command') {
      const notificationChannelsText = `
⚡ **انضم إلى البوت الأسرع والأكثر تقدمًا** ⚡

قروب دزرت فوري العام 👇🏻:
[قروب دزرت فوري](https://t.me/+hrIusgChjeMwY2Zk)

- قم بزيارة متجرنا الآن
- أكمل عملية الشراء
- استخدم الرمز لتفعيل الاشتراك
- وبإمكانك تمديد اشتراكك

👇🏻 **قم بزيارة المتجر والاشتراك!** 👇🏻
                           www.dzrtgg.com
`;
      updateMessage(notificationChannelsText, notificationChannelsKeyboard, msg);
    } else if (data === 'activate_subscription_command') {
      const activationMessage = `
**قم بإدخال الرمز لتفعيل الاشتراك 🔑:**
`;
      const keyboard = {
        inline_keyboard: [
          [
            { text: 'رجوع 🔙', callback_data: 'start' }
          ]
        ]
      };
      updateMessage(activationMessage, keyboard, msg);
      activeUsers.set(userId, 'activating');
    } else if (data === 'subscription_status_command') {
      getSubscriptionStatus(userId, (response) => {
        const keyboard = {
          inline_keyboard: [
            [
              { text: 'تمديد الاشتراك 🔄', callback_data: 'activate_subscription_command' }
            ],
            [
              { text: 'رجوع 🔙', callback_data: 'start' }
            ]
          ]
        };
        updateMessage(response, keyboard, msg);
      });
    } else if (data === 'extend_subscription_command') {
      const extendMessage = `
**قم بإدخال الرمز لتمديد الاشتراك 🔄:**
`;
      const keyboard = {
        inline_keyboard: [
          [
            { text: 'رجوع 🔙', callback_data: 'subscription_status_command' }
          ]
        ]
      };
      updateMessage(extendMessage, keyboard, msg);
      activeUsers.set(userId, 'extending');
    } else if (data === 'support_command') {
      const supportMessage = ``;
      const keyboard = {
        inline_keyboard: [
          [
            { text: 'رجوع 🔙', callback_data: 'start' }
          ]
        ]
      };
      updateMessage(supportMessage, keyboard, msg);
    } else if (data === 'chat_id_command') {
      const chatIdMessage = `
━━━━━━━━━━━━━━━━━━━━
 **معرف المستخدم الخاص بك هو 🆔:** 
━━━━━━━━━━━━━━━━━━━━\n\n 🔹 اضغط هنا : \`${chatId}\`

 **اضغط على الرقم الخاص بك لكي يتم نسخه** 📋
`;
      const keyboard = {
        inline_keyboard: [
          [
            { text: 'رجوع 🔙', callback_data: 'start' }
          ]
        ]
      };
      updateMessage(chatIdMessage, keyboard, msg);
    } else if (data === 'product_availability_command') {
      const isSubscribed = await isUserSubscribed(userId);
      if (!isSubscribed) {
        bot.sendMessage(chatId, '⚠️ هذا الخيار متاح للمشتركين فقط.\n يرجى الاشتراك للوصول إلى هذه الميزة.');
        return;
      }
      getProductAvailability((response) => {
        const keyboard = {
          inline_keyboard: [
            [
              { text: 'رجوع 🔙', callback_data: 'start' }
            ]
          ]
        };
        updateMessage(response, keyboard, msg);
      });
    } else if (data === 'start') {
      const isSubscribed = await isUserSubscribed(userId);
      const mainKeyboard = {
        inline_keyboard: isSubscribed ? [
          [
            { text: 'قنوات التنبيهات 🔔', callback_data: 'notification_channels_command' },
            { text: 'تمديد الاشتراك 🔄', callback_data: 'activate_subscription_command' }
          ],
          [
            { text: 'اوقات المنتجات ⏰', callback_data: 'product_availability_command' },
            { text: 'حالة الاشتراك 📊', callback_data: 'subscription_status_command' }
          ],
          [
            { text: 'الدعم الفني 📩', url: 'https://t.me/MZZ_2' },
            { text: 'معرف المستخدم 🆔', callback_data: 'chat_id_command' }
          ],
          [
            { text: 'المتجر 🛒', url: 'www.dzrtgg.com' }
          ]
        ] : [
          [
            { text: 'معرف المستخدم 🆔', callback_data: 'chat_id_command' },
            { text: 'تفعيل الاشتراك 🔑', callback_data: 'activate_subscription_command' }
          ],
          [
            { text: 'الدعم الفني 📩', url: 'https://t.me/MZZ_2' },
            { text: 'القروب العام 📢', url: 'https://t.me/+hrIusgChjeMwY2Zk' }
          ],
          [
            { text: 'المتجر 🛒', url: 'www.dzrtgg.com' }
          ]
        ]
      };
      updateMessage(welcomeMessage, mainKeyboard, msg);
    }
  });
});

bot.on('message', async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;

  if (activeUsers.has(userId) && (activeUsers.get(userId) === 'activating' || activeUsers.get(userId) === 'extending')) {
    const code = msg.text.trim();
    const action = activeUsers.get(userId);
    activeUsers.delete(userId);

    const callback = async (res) => {
      await bot.sendMessage(chatId, res, { parse_mode: 'Markdown' });

      if (!res.includes('⚠️')) {
        const fullResponse = `
اختر قناة المنتجات التي ترغب بها🔔
\n\n\n
واستمتع باسرع اشعارات لمنتجاتك المخصصة:
`;
        await bot.sendMessage(chatId, fullResponse, {
          reply_markup: notificationChannelsKeyboard,
          parse_mode: 'Markdown'
        });

        // حذف الرسائل السابقة بعد التفعيل أو التمديد بنجاح
        if (userMessagesMap.has(userId)) {
          const previousMessages = userMessagesMap.get(userId);
          previousMessages.forEach(messageId => {
            bot.deleteMessage(chatId, messageId).catch((error) => {
              console.error('Error deleting previous message:', error);
            });
          });
          userMessagesMap.delete(userId);
        }
      }
    };

    if (action === 'activating') {
      await activateSubscription(userId, code, callback);
    } else if (action === 'extending') {
      await activateSubscription(userId, code, callback);
    }
  }
});
// الحصول على حالة الاشتراك
async function getSubscriptionStatus(userId, callback) {
  let connection;
  try {
    connection = await pool.getConnection();
    const [results] = await connection.execute('SELECT * FROM users WHERE id = ?', [userId]);
    if (results.length === 0 || results[0].activated === 0) {
      callback('ليس لديك اشتراك حاليًا ⚠️');
      return;
    }
    const user = results[0];
    const subscriptionType = user.subscriptionType;
    const remainingDays = Math.floor((new Date(user.expiryDate) - new Date()) / (1000 * 60 * 60 * 24));
    callback(`
📊 **حالة الاشتراك:**\n\n🔹 **نوع الاشتراك:** ${subscriptionType}\n🔹 **مدة باقية للاشتراك:** ${remainingDays} يومًا
    `);
  } catch (err) {
    console.error('Error getting subscription status:', err);
    callback('⚠️ حدث خطأ أثناء التحقق من حالة الاشتراك.');
  } finally {
    if (connection) connection.release();
  }
}
// تفعيل الاشتراك
async function activateSubscription(userId, code, callback) {
  let connection;

        
  try {
    connection = await pool.getConnection();
    const [results] = await connection.execute('SELECT * FROM activationcodes WHERE activation_code = ?', [code]);
    if (results.length > 0) {
      const duration = results[0].duration_in_months;
      await activateUserSubscription(userId, code, duration, async (message) => {
        await callback(message);
        
        // حذف الرسائل السابقة بعد تفعيل الاشتراك بنجاح
        if (userMessagesMap.has(userId)) {
          const previousMessages = userMessagesMap.get(userId);
          previousMessages.forEach(messageId => {
            bot.deleteMessage(chatId, messageId).catch((error) => {
              console.error('Error deleting previous message:', error);
            });
          });
          userMessagesMap.delete(userId);
        }
      });
    } else {
      callback(' ⚠️ الرمز غير صالح اضغط على رجوع\n واعد ادخال الرمز مره اخرى');
    }
  } catch (err) {
    console.error('Error checking activation codes:', err);
    callback('حدث خطأ أثناء التحقق من الكود⚠️');
  } finally {
    if (connection) connection.release();
  }
}

// التعامل مع التجربة المجانية
// تفعيل التجربة المجانية
// جدولة إعادة تعيين العداد عند الساعة 10 ظهرًا


const productCache = new NodeCache({ stdTTL: 43200 }); // مدة التخزين المؤقت 43200 ثانية (12 ساعة)

async function getProductAvailability(callback) {
  // تحقق من وجود البيانات في الكاش
  const cachedData = productCache.get("productAvailability");
  if (cachedData) {
    callback(cachedData); // إعادة البيانات المخزنة في الكاش
    return;
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const fiveDaysAgo = new Date(new Date().setDate(new Date().getDate() - 5)).toISOString().slice(0, 19).replace('T', ' ');

    const [results] = await connection.execute(`
      SELECT notification_time 
      FROM product_notifications 
      WHERE notification_time >= ? 
      ORDER BY notification_time ASC
    `, [fiveDaysAgo]);

    if (results.length === 0) {
      callback('لا توجد معلومات متاحة حاليًا حول توفر المنتجات. ⚠️');
      return;
    }

    let response = `** وقت أول إشعار للخمس ايام السابقة :**\n\n`;
    let daysAdded = new Set();

    results.forEach((row) => {
      const notificationTime = new Date(row.notification_time);
      const dayName = notificationTime.toLocaleDateString('ar-SA', { weekday: 'long' });
      const formattedTime = notificationTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      const formattedDate = notificationTime.toLocaleDateString('en-CA'); // 2024-07-16

      if (!daysAdded.has(dayName)) {
        response += `${dayName}\nالساعة : ${formattedTime} 🕒 \n\n`;
        daysAdded.add(dayName);
      }
    });

    // حفظ النتائج في الكاش
    productCache.set("productAvailability", response);
    callback(response);
  } catch (err) {
    console.error('Error getting product availability:', err);
    callback('⚠️ حدث خطأ أثناء الحصول على معلومات توفر المنتجات.');
  } finally {
    if (connection) connection.release();
  }
}

// وظيفة لحذف الإشعارات القديمة
async function deleteOldNotifications() {
  let connection;
  try {
    connection = await pool.getConnection();
    const fiveDaysAgo = new Date(new Date().setDate(new Date().getDate() - 5)).toISOString().slice(0, 19).replace('T', ' ');

    const [result] = await connection.execute(`
      DELETE FROM product_notifications 
      WHERE notification_time < ?
    `, [fiveDaysAgo]);

    console.log(`${result.affectedRows} old notifications deleted.`);
  } catch (err) {
    console.error('Error deleting old notifications:', err);
  } finally {
    if (connection) connection.release();
  }
}

// استدعاء وظيفة حذف الإشعارات القديمة بشكل دوري (كل 24 ساعة)
setInterval(deleteOldNotifications, 24 * 60 * 60 * 1000);

const app = express();
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});