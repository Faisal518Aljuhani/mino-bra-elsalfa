const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

async function sendVerificationEmail(toEmail, username, token) {
  const link = `${process.env.APP_BASE_URL}/api/auth/verify/${token}`;
  await transporter.sendMail({
    from: `"مين برا السالفة - نسخة فيصل" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: 'تفعيل حسابك في لعبة مين برا السالفة',
    html: `
      <div style="font-family: Tahoma, Arial; direction: rtl; text-align: right;">
        <h2>أهلاً ${username} 👋</h2>
        <p>عشان تفعّل حسابك، اضغط على الرابط:</p>
        <p><a href="${link}" style="background:#2b6cb0;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;">تفعيل الحساب</a></p>
        <p>لو الزر ما اشتغل، انسخ هذا الرابط: ${link}</p>
        <p>الرابط صالح لمدة 30 دقيقة فقط.</p>
      </div>`
  });
}

async function sendResetEmail(toEmail, username, token) {
  const link = `${process.env.APP_BASE_URL}/reset-password.html?token=${token}`;
  await transporter.sendMail({
    from: `"مين برا السالفة" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: 'إعادة تعيين كلمة المرور',
    html: `
      <div style="font-family: Tahoma, Arial; direction: rtl; text-align: right;">
        <h2>مرحباً ${username}</h2>
        <p>اضغط الرابط عشان تغيّر كلمة المرور (صالح 30 دقيقة):</p>
        <p><a href="${link}">${link}</a></p>
        <p>لو ما طلبت هذا، تجاهل الرسالة.</p>
      </div>`
  });
}

module.exports = { sendVerificationEmail, sendResetEmail };
