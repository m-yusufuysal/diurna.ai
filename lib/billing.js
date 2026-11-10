'use strict';
/* Sözleşme/koltuk görünümü ve kullanım ölçümü. Kart ödemesi YOKTUR: faturalar platform sahibince düzenlenir, havale/EFT ile ödenir (lib/platform.js). */
const store = require('./store');
const U = require('./util');
const PLANS = {
  starter: { id: 'starter', name: { tr: 'Başlangıç', en: 'Starter' }, perSeat: 49, minSeats: 6, maxSeats: 10, deckRange: '300–500', features: ['daily_bulletin', 'two_versions', 'archive', 'watchlists', 'email_reports'] },
  professional: { id: 'professional', name: { tr: 'Profesyonel', en: 'Professional' }, perSeat: 149, minSeats: 10, maxSeats: 20, deckRange: '1.500–3.000', features: ['daily_bulletin', 'two_versions', 'archive', 'watchlists', 'email_reports', 'customer_matching', 'trade_check', 'tasks', 'analytics', 'api', 'webhooks'] },
  enterprise: { id: 'enterprise', name: { tr: 'Kurumsal', en: 'Enterprise' }, perSeat: null, minSeats: 25, maxSeats: null, deckRange: { tr: 'Özel teklif', en: 'Custom quote' }, features: ['everything', 'dd_module', 'on_prem', 'sso', 'integration', 'sla'] },
};
function ensure(orgId) {
  const o = store.orgsAll().find(x => x.id === orgId) || {}; const c = o.contract || {};
  return { plan: o.plan || 'professional', seats: o.seats || 10, currency: c.currency || 'TRY', pricePerSeat: c.pricePerSeat ?? null, billingEmail: c.billingEmail || '', status: o.suspended ? 'suspended' : 'active', contract: c };
}
function monthKey(d = new Date()) { return d.toISOString().slice(0, 7); }
function meter(key, n = 1) { try { const u = store.usage(); const m = monthKey(); u[m] = u[m] || {}; u[m][key] = (u[m][key] || 0) + n; store.saveUsage(u); } catch { } }
function price(planId, seats) { const p = PLANS[planId]; return p.perSeat ? p.perSeat * seats : null; }
function monthly(orgId) { const b = ensure(orgId); return b.pricePerSeat ? b.pricePerSeat * b.seats : price(b.plan, b.seats); }
module.exports = { PLANS, ensure, meter, price, monthly, monthKey };
