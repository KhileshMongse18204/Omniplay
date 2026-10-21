import nodemailer from 'nodemailer';
import type { Settings } from './settings.ts';

// SMTP transport built from admin settings. Sending happens in the worker ("send-email" job);
// the API only uses it for the "test connection" button.
export const createMailer = (s: Settings['security']['smtp']) =>
  nodemailer.createTransport({
    host: s.host, port: s.port, secure: s.secure,
    auth: s.user ? { user: s.user, pass: s.pass } : undefined,
    connectionTimeout: 10_000,
  });
