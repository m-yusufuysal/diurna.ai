'use strict';
/* E-posta gönderimi: SMTP tanımlıysa ve nodemailer kuruluysa gerçek gönderim; aksi hâlde “giden kutusu” önizleme dosyası (uygulama içinde görüntülenir). */
const fs = require('fs'), path = require('path');
const store = require('./store'); const U = require('./util'); const billing = require('./billing');
let nm = null; try { nm = require('nodemailer'); } catch { }
async function send({ to, subject, html, text, kind }) {
  const s = store.settings().smtp || {}; const id = Date.now() + '-' + U.uid().slice(0, 4);
  const rec = { id, to, subject, kind: kind || 'notification', at: new Date().toISOString(), mode: 'outbox', error: null };
  if (nm && s.host) {
    try {
      const tr = nm.createTransport({ host: s.host, port: +s.port || 587, secure: !!s.secure, auth: s.user ? { user: s.user, pass: s.pass } : undefined, connectionTimeout: 10000 });
      await tr.sendMail({ from: s.from, to, subject, html, text }); rec.mode = 'smtp';
    } catch (e) { rec.error = e.message; rec.mode = 'outbox'; }
  }
  fs.writeFileSync(path.join(store.outboxDir(), id + '.html'), html || ('<pre>' + U.esc(text) + '</pre>'));
  const idx = path.join(store.outboxDir(), 'index.json'); let list = []; try { list = JSON.parse(fs.readFileSync(idx, 'utf8')); } catch { }
  list.unshift(rec); fs.writeFileSync(idx, JSON.stringify(list.slice(0, 200)));
  billing.meter('emails', 1); return rec;
}
function outbox() { try { return JSON.parse(fs.readFileSync(path.join(store.outboxDir(), 'index.json'), 'utf8')); } catch { return []; } }
function outboxHtml(id) { if (!/^[\w-]+$/.test(id)) return null; try { return fs.readFileSync(path.join(store.outboxDir(), id + '.html'), 'utf8'); } catch { return null; } }
module.exports = { send, outbox, outboxHtml, hasNodemailer: !!nm };
