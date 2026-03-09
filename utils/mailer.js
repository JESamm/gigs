const nodemailer = require('nodemailer');

let transporter = null;

/**
 * Initialize the email transporter.
 * Uses SMTP settings from .env if available, otherwise creates an Ethereal test account.
 */
async function initMailer() {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    // Production / real SMTP
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
    console.log(`✉️  Mailer ready (SMTP: ${process.env.SMTP_HOST})`);
  } else {
    // Development — use Ethereal fake SMTP (emails viewable at ethereal.email)
    try {
      const testAccount = await nodemailer.createTestAccount();
      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass
        }
      });
      console.log(`✉️  Mailer ready (Ethereal test mode)`);
      console.log(`   Preview emails at: https://ethereal.email/login`);
      console.log(`   User: ${testAccount.user}  Pass: ${testAccount.pass}`);
    } catch (err) {
      console.warn('⚠️  Could not create Ethereal test account. Emails will be logged to console.');
      transporter = null;
    }
  }
}

/**
 * Send an email. Fails silently (logs error) so auth flow is never blocked.
 */
async function sendMail({ to, subject, html }) {
  const from = process.env.SMTP_FROM || '"GigConnect" <noreply@gigconnect.com>';

  if (!transporter) {
    console.log(`📧 [console-only] To: ${to} | Subject: ${subject}`);
    return null;
  }

  try {
    const info = await transporter.sendMail({ from, to, subject, html });
    const preview = nodemailer.getTestMessageUrl(info);
    if (preview) {
      console.log(`📧 Email sent → Preview: ${preview}`);
    } else {
      console.log(`📧 Email sent to ${to} (${info.messageId})`);
    }
    return info;
  } catch (err) {
    console.error('📧 Email send failed:', err.message);
    return null;
  }
}

// ─── Email templates ────────────────────────────────────

function sendWelcomeEmail(user) {
  const roleLabel = user.role === 'student' ? 'Student' : 'Employer';
  return sendMail({
    to: user.email,
    subject: 'Welcome to GigConnect! 🎉 Your account has been created',
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
        <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px;text-align:center;">
          <h1 style="color:white;margin:0;font-size:28px;">⚡ GigConnect</h1>
        </div>
        <div style="padding:32px;">
          <h2 style="color:#1f2937;margin-top:0;">Welcome, ${user.full_name}! 👋</h2>
          <p style="color:#4b5563;font-size:16px;line-height:1.6;">
            Your <strong>${roleLabel}</strong> account has been successfully created.
          </p>
          <div style="background:#f0f0ff;border-radius:8px;padding:16px;margin:20px 0;">
            <p style="margin:0;color:#4b5563;font-size:14px;">
              <strong>Email:</strong> ${user.email}<br>
              <strong>Role:</strong> ${roleLabel}<br>
              <strong>Date:</strong> ${new Date().toLocaleDateString('en-US', { dateStyle: 'full' })}
            </p>
          </div>
          <p style="color:#4b5563;font-size:16px;line-height:1.6;">
            ${user.role === 'student'
              ? 'Start browsing gigs and apply to opportunities that match your skills!'
              : 'Post your first gig and connect with talented students!'}
          </p>
          <div style="text-align:center;margin:28px 0;">
            <a href="http://localhost:3000/#/home" style="background:#6366f1;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;">
              Get Started
            </a>
          </div>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
          <p style="color:#9ca3af;font-size:13px;">
            🔒 <strong>Security notice:</strong> If you did not create this account, please ignore this email or contact our support team immediately.
          </p>
        </div>
        <div style="background:#f9fafb;padding:16px;text-align:center;">
          <p style="color:#9ca3af;font-size:12px;margin:0;">© 2026 GigConnect. All rights reserved.</p>
        </div>
      </div>
    `
  });
}

function sendLoginAlertEmail(user, ipAddress) {
  return sendMail({
    to: user.email,
    subject: '🔐 New Login to Your GigConnect Account',
    html: `
      <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
        <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px;text-align:center;">
          <h1 style="color:white;margin:0;font-size:28px;">⚡ GigConnect</h1>
        </div>
        <div style="padding:32px;">
          <h2 style="color:#1f2937;margin-top:0;">New Login Detected 🔐</h2>
          <p style="color:#4b5563;font-size:16px;line-height:1.6;">
            Hello <strong>${user.full_name}</strong>, we noticed a new sign-in to your GigConnect account.
          </p>
          <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:16px;margin:20px 0;">
            <p style="margin:0;color:#92400e;font-size:14px;">
              <strong>📍 Login Details:</strong><br>
              <strong>Account:</strong> ${user.email}<br>
              <strong>IP Address:</strong> ${ipAddress || 'Unknown'}<br>
              <strong>Time:</strong> ${new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}
            </p>
          </div>
          <p style="color:#4b5563;font-size:16px;line-height:1.6;">
            If this was you, no action is needed. If you didn't sign in, please change your password immediately and contact our support team.
          </p>
          <div style="text-align:center;margin:28px 0;">
            <a href="http://localhost:3000/#/profile" style="background:#ef4444;color:white;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;">
              Secure My Account
            </a>
          </div>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
          <p style="color:#9ca3af;font-size:13px;">
            🔒 This is an automated security alert from GigConnect. We send this whenever your account is accessed from a new session.
          </p>
        </div>
        <div style="background:#f9fafb;padding:16px;text-align:center;">
          <p style="color:#9ca3af;font-size:12px;margin:0;">© 2026 GigConnect. All rights reserved.</p>
        </div>
      </div>
    `
  });
}

module.exports = { initMailer, sendMail, sendWelcomeEmail, sendLoginAlertEmail };
