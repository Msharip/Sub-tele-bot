const TelegramBot = require('node-telegram-bot-api');
const mysql = require('mysql2/promise');
const cron = require('node-cron');
require('rate-limiter-flexible');
const NodeCache = require("node-cache");
const moment = require('moment-timezone');
const { exec } = require('child_process');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  port: process.env.DB_PORT,
  waitForConnections: true,
  connectionLimit: 26,
  queueLimit: 0
};

const token = process.env.TOKEN4;
const bot = new TelegramBot(token, {
  polling: {
    interval: 2000,
    autoStart: true,
    params: {
      timeout: 10
    }
  }
});

bot.on('polling_error', (error) => {
  console.error(`Polling error: ${error.message}`);
  if (error.response && error.response.statusCode === 502) {
    setTimeout(() => {
      bot.startPolling();
    }, 10000);
  } else if (error.response && error.response.statusCode === 429) {
    const retryAfter = error.response.headers['retry-after'] || 30;
    setTimeout(() => {
      bot.startPolling();
    }, retryAfter * 1000);
  } else {
    setTimeout(() => {
      bot.startPolling();
    }, 5000);
  }
});


function restartDyno() {
  exec('heroku restart -a sub-dzrt-bot', (err, stdout, stderr) => {
    if (err) {
      console.error(`Error restarting Dyno: ${err.message}`);
      return;
    }
    console.log(`Dyno restarted: ${stdout}`);
  });
}

bot.on('polling_error', (error) => {
  console.error(`Polling error: ${error.message}`);
  console.log('Restarting Dyno due to polling error...');
  restartDyno();
});


const pool = mysql.createPool(dbConfig);
const activeUsers = new Map();
const userClicks = new Map();
const rateLimitMap = new Map();
const userSubscriptions = new Map();
const userMessagesCache = new NodeCache({ stdTTL: 86400 });
const temporaryMessages = new Map(); // لتخزين الرسائل المؤقتة

async function deleteActivationCode(connection, code, userId) {
  const insertQuery = `
    INSERT INTO activated_codes (chat_id, activation_code, activation_date)
    VALUES (?, ?, ?)
  `;
  await connection.execute(insertQuery, [userId, code, moment().tz('Asia/Riyadh').format('YYYY-MM-DD HH:mm:ss')]);

  const deleteQuery = 'DELETE FROM activationcodes WHERE activation_code = ?';
  await connection.execute(deleteQuery, [code]);
}

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
      const startDate = moment().tz('Asia/Riyadh').format('YYYY-MM-DD');
      let expiryDate = moment().tz('Asia/Riyadh');
      if (duration < 0) {
        expiryDate.subtract(Math.abs(duration), 'days');
      } else {
        expiryDate.add(duration, 'months');
      }

      const insertQuery = `
        INSERT INTO users (id, activated, subscriptionType, startDate, expiryDate)
        VALUES (?, ?, ?, ?, ?)
      `;
      await connection.execute(insertQuery, [userId, true, `${Math.abs(duration)} ${duration < 0 ? 'يوم' : 'أشهر'}`, startDate, expiryDate.format('YYYY-MM-DD')]);
      await deleteActivationCode(connection, code, userId);
      await connection.commit();
      callback(userId, `**تم تفعيل اشتراكك بنجاح لمدة ${Math.abs(duration)} ${duration < 0 ? 'يوم' : 'أشهر'}.** 🎉`);
    }

    await connection.execute('UPDATE users SET activated = true WHERE id = ?', [userId]);
    userSubscriptions.set(userId, true);
    cache.set(userId, true);
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Error activating subscription:', err);
    callback(userId, '⚠️ حدث خطأ أثناء تفعيل الاشتراك.');
  } finally {
    if (connection) connection.release();
  }
}

async function extendUserSubscription(connection, userId, code, duration, callback) {
  try {
    const [existingUsers] = await connection.execute('SELECT * FROM users WHERE id = ?', [userId]);
    const user = existingUsers.length > 0 ? existingUsers[0] : null;

    if (!user) {
      callback(userId, 'ليس لديك اشتراك حاليًا ⚠️');
      return;
    }

    let expiryDate = moment(user.expiryDate).tz('Asia/Riyadh');
    let totalDuration = '';

    if (user.subscriptionType.includes('يوم')) {
      if (duration > 0) {
        expiryDate = moment().tz('Asia/Riyadh').add(duration, 'months');
        totalDuration = `${duration} أشهر`;
      } else {
        expiryDate.subtract(Math.abs(duration), 'days');
        const totalDays = user.subscriptionType.match(/\d+/) ? parseInt(user.subscriptionType.match(/\d+/)[0]) - Math.abs(duration) : Math.abs(duration);
        totalDuration = `${totalDays} يوم`;
      }
    } else {
      if (duration < 0) {
        expiryDate.subtract(Math.abs(duration), 'days');
        const totalMonths = user.subscriptionType.match(/\d+/) ? parseInt(user.subscriptionType.match(/\d+/)[0]) + Math.floor(Math.abs(duration) / 30) : Math.abs(duration);
        totalDuration = `${totalMonths} أشهر`;
      } else {
        expiryDate.add(duration, 'months');
        const totalMonths = user.subscriptionType.match(/\d+/) ? parseInt(user.subscriptionType.match(/\d+/)[0]) + duration : duration;
        totalDuration = `${totalMonths} أشهر`;
      }
    }

    const updateQuery = `
      UPDATE users SET expiryDate = ?, subscriptionType = ? WHERE id = ?
    `;
    await connection.execute(updateQuery, [expiryDate.format('YYYY-MM-DD'), totalDuration, userId]);
    await deleteActivationCode(connection, code, userId);
    await connection.commit();
    callback(userId, `**تم تمديد اشتراكك بنجاح لمدة ${Math.abs(duration)} ${duration < 0 ? 'يوم' : 'أشهر'}.**\n\n الآن مجموع الاشتراك هو ${totalDuration} 🎉`);
    cache.set(userId, true);
  } catch (err) {
    console.error('Error extending subscription:', err);
    callback(userId, '⚠️ حدث خطأ أثناء تمديد الاشتراك.');
  }
}
const cache = new NodeCache({ stdTTL: 7200 });

async function isUserSubscribed(userId) {
  const cachedActivation = cache.get(userId);
  if (cachedActivation !== undefined) {
    return cachedActivation;
  }
  let connection;
  try {
    connection = await pool.getConnection();
    const [results] = await connection.execute('SELECT activated FROM users WHERE id = ?', [userId]);
    if (results.length > 0) {
      const user = results[0];
      const isActivated = user.activated === 1;
      cache.set(userId, isActivated);
      return isActivated;
    } else {
      cache.set(userId, false);
      return false;
    }
  } catch (err) {
    console.error('Error checking activation status:', err);
    return false;
  } finally {
    if (connection) connection.release();
  }
}

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

const userMessagesMap = new Map();

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

const mainKeyboard = (isSubscribed) => ({
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
});

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const currentTime = new Date().getTime();
  const lastStartTime = rateLimitMap.get(userId) || 0;
  const timeLimit = 30000;
  if (currentTime - lastStartTime < timeLimit) {
    bot.sendMessage(chatId, '⚠️ تجنب ارسال امر - /start - متكرر\n\n تم ايقاف الامر موقتا لمده من الوقت');
    return;
  }
  rateLimitMap.set(userId, currentTime);
  userClicks.set(userId, 0);
  if (userMessagesMap.has(userId)) {
    const previousMessages = userMessagesMap.get(userId);
    previousMessages.forEach(messageId => {
      bot.deleteMessage(chatId, messageId).catch((error) => {
      });
    });
    userMessagesMap.delete(userId);
  }
  const isSubscribed = await isUserSubscribed(userId);
  bot.sendMessage(chatId, welcomeMessage, {
    reply_markup: mainKeyboard(isSubscribed),
    parse_mode: 'Markdown'
  }).then((sentMessage) => {
    userMessagesMap.set(userId, [sentMessage.message_id]);
    userMessagesCache.set(userId, [sentMessage.message_id]);
  });
});

bot.on('callback_query', async (callbackQuery) => {
  const msg = callbackQuery.message;
  const data = callbackQuery.data;
  const userId = callbackQuery.from.id;
  const chatId = msg.chat.id;

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

    // تخزين الرسالة في الذاكرة المؤقتة
    const messages = temporaryMessages.get(userId) || [];
    messages.push(msg.message_id);
    temporaryMessages.set(userId, messages);
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

    // تخزين الرسالة في الذاكرة المؤقتة
    const messages = temporaryMessages.get(userId) || [];
    messages.push(msg.message_id);
    temporaryMessages.set(userId, messages);
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
    updateMessage(welcomeMessage, mainKeyboard(isSubscribed), msg);
  }
});

bot.on('message', async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;

  if (activeUsers.has(userId) && (activeUsers.get(userId) === 'activating' || activeUsers.get(userId) === 'extending')) {
    const code = msg.text.trim();
    const action = activeUsers.get(userId);
    activeUsers.delete(userId);

    const callback = async (userId, res) => {
      if (!res.includes('⚠️')) {
        // حذف الرسائل المؤقتة بعد التفعيل أو التمديد بنجاح
        const temporaryMsgs = temporaryMessages.get(userId) || [];
        for (const messageId of temporaryMsgs) {
          await bot.deleteMessage(userId, messageId).catch((error) => {
          });
        }
        temporaryMessages.delete(userId);
      }

      if (!res.includes('⚠️')) {
        const fullResponse = `${res}\n\nاختر قناة المنتجات التي ترغب بها🔔\n\nواستمتع باسرع اشعارات لمنتجاتك المخصصة:`;
        await bot.sendMessage(userId, fullResponse, {
          reply_markup: notificationChannelsKeyboard,
          parse_mode: 'Markdown'
        });
      } else {
        // تعديل الرسالة الحالية
        const temporaryMsgs = temporaryMessages.get(userId);
        if (temporaryMsgs && temporaryMsgs.length > 0) {
          const messageId = temporaryMsgs[0];
          await bot.editMessageText(`⚠️ الرمز غير صالح اضغط على رجوع\n واعد ادخال الرمز مره اخرى`, {
            chat_id: userId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: 'رجوع 🔙', callback_data: 'start' }
                ]
              ]
            }
          }).catch((error) => {
            console.error(`Error editing message: ${error.message}`);
          });
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

async function activateSubscription(userId, code, callback) {
  let connection;

  try {
    connection = await pool.getConnection();
    const [results] = await connection.execute('SELECT * FROM activationcodes WHERE activation_code = ?', [code]);
    if (results.length > 0) {
      const duration = results[0].duration_in_months;
      await activateUserSubscription(userId, code, duration, async (userId, message) => {
        await callback(userId, message);
        
        if (userMessagesMap.has(userId)) {
          const previousMessages = userMessagesMap.get(userId);
          previousMessages.forEach(messageId => {
            bot.deleteMessage(userId, messageId).catch((error) => {
            });
          });
          userMessagesMap.delete(userId);
          userMessagesCache.set(userId, []); // تحديث الكاش بعد الحذف
        }
      });
    } else {
      callback(userId, ' ⚠️ الرمز غير صالح اضغط على رجوع\n واعد ادخال الرمز مره اخرى');
    }
  } catch (err) {
    console.error('Error checking activation codes:', err);
    callback(userId, 'حدث خطأ أثناء التحقق من الكود⚠️');
  } finally {
    if (connection) connection.release();
  }
}

const productCache = new NodeCache({ stdTTL: 43200 });

async function getProductAvailability(callback) {
  const cachedData = productCache.get("productAvailability");
  if (cachedData) {
    callback(cachedData);
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
      const formattedDate = notificationTime.toLocaleDateString('en-CA');

      if (!daysAdded.has(dayName)) {
        response += `${dayName}\nالساعة : ${formattedTime} 🕒 \n\n`;
        daysAdded.add(dayName);
      }
    });

    productCache.set("productAvailability", response);
    callback(response);
  } catch (err) {
    console.error('Error getting product availability:', err);
    callback('⚠️ حدث خطأ أثناء الحصول على معلومات توفر المنتجات.');
  } finally {
    if (connection) connection.release();
  }
}

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

setInterval(deleteOldNotifications, 24 * 60 * 60 * 1000);

console.log("Bot is running");

const restoreMessages = async () => {
  const users = userMessagesCache.keys();
  for (const userId of users) {
    const messageIds = userMessagesCache.get(userId);
    const isSubscribed = await isUserSubscribed(userId);

    for (const messageId of messageIds) {
      bot.sendMessage(userId, welcomeMessage, {
        reply_markup: mainKeyboard(isSubscribed),
        parse_mode: 'Markdown'
      }).then((sentMessage) => {
        userMessagesMap.set(userId, [sentMessage.message_id]);
        userMessagesCache.set(userId, [sentMessage.message_id]);
      });
    }
  }
};
restoreMessages();
