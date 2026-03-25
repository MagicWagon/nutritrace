import nodemailer from 'nodemailer';
import db from './db.js';

/** Seed app_config from env vars at startup (env vars take priority) */
export function seedSmtpFromEnv() {
  const map = {
    SMTP_HOST:   'smtp_host',
    SMTP_PORT:   'smtp_port',
    SMTP_SECURE: 'smtp_secure',
    SMTP_USER:   'smtp_user',
    SMTP_PASS:   'smtp_pass',
    SMTP_FROM:   'smtp_from',
  };
  const upsert = db.prepare(
    'INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  for (const [envKey, dbKey] of Object.entries(map)) {
    if (process.env[envKey] != null) upsert.run(dbKey, process.env[envKey]);
  }
}

/** Read SMTP config from app_config table (env vars already seeded at startup) */
function getSmtpConfig() {
  const rows = db.prepare('SELECT key, value FROM app_config WHERE key LIKE ?').all('smtp_%');
  const cfg = {};
  for (const { key, value } of rows) cfg[key] = value;
  return cfg;
}

/** Build a nodemailer transporter from stored config, or throw if not configured */
function createTransport() {
  const cfg = getSmtpConfig();
  if (!cfg.smtp_host) throw new Error('Email not configured. Ask your admin to set up SMTP in Settings.');
  return nodemailer.createTransport({
    host:   cfg.smtp_host,
    port:   parseInt(cfg.smtp_port || '587'),
    secure: cfg.smtp_secure === 'true',
    auth:   cfg.smtp_user ? { user: cfg.smtp_user, pass: cfg.smtp_pass || '' } : undefined,
  });
}

export async function sendMail({ to, subject, html, text }) {
  const cfg = getSmtpConfig();
  const from = cfg.smtp_from || cfg.smtp_user || 'NutriTrace <noreply@nutritrace.app>';
  const transport = createTransport();
  await transport.sendMail({ from, to, subject, html, text });
}

export async function testSmtp() {
  const transport = createTransport();
  await transport.verify();
}

export function isEmailConfigured() {
  const cfg = getSmtpConfig();
  return !!cfg.smtp_host;
}

// ── Email templates ────────────────────────────────────────────────────────

export async function sendPasswordReset(email, resetUrl) {
  await sendMail({
    to: email,
    subject: 'Reset your NutriTrace password',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#00C47A">NutriTrace</h2>
        <p>You requested a password reset. Click the button below to set a new password.</p>
        <p>
          <a href="${resetUrl}" style="display:inline-block;background:#00C47A;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
            Reset Password
          </a>
        </p>
        <p style="color:#888;font-size:13px">This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>
        <p style="color:#888;font-size:12px">Or copy this URL: ${resetUrl}</p>
      </div>
    `,
    text: `Reset your NutriTrace password:\n${resetUrl}\n\nThis link expires in 1 hour.`,
  });
}

export async function sendInvite(email, inviteUrl, inviterName) {
  await sendMail({
    to: email,
    subject: `You've been invited to NutriTrace`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#00C47A">NutriTrace</h2>
        <p>${inviterName ? `<strong>${inviterName}</strong> has` : 'You have been'} invited you to join NutriTrace.</p>
        <p>Click the button below to set up your account.</p>
        <p>
          <a href="${inviteUrl}" style="display:inline-block;background:#00C47A;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
            Accept Invitation
          </a>
        </p>
        <p style="color:#888;font-size:13px">This invite expires in 7 days.</p>
        <p style="color:#888;font-size:12px">Or copy this URL: ${inviteUrl}</p>
      </div>
    `,
    text: `You've been invited to NutriTrace:\n${inviteUrl}\n\nThis invite expires in 7 days.`,
  });
}
