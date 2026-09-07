// Zapis leadów (formularz w raporcie audytu) i anonimowych zdarzeń użycia
// do Supabase (centrum dowodzenia). Klucz anon + RLS "insert only" — bez tajnych kluczy.
// Żadnych cookies; identyfikator sesji generuje przeglądarka i żyje do zamknięcia karty.

const SUPABASE_URL = process.env.LEADS_SUPABASE_URL || 'https://jpkxaoohshlnylddncxf.supabase.co';
const SUPABASE_KEY = process.env.LEADS_SUPABASE_KEY || 'sb_publishable_WskY-0na7Q3KKtNLdChcbw_tf7gBtGF';
const NOTIFY = process.env.LEADS_NOTIFY_WEBHOOK || ''; // opcjonalnie: n8n/Make — POST z leadem
const SALT = process.env.IP_SALT || 'opisy-z-base';

const crypto = require('crypto');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*'); // raport HTML otwierany lokalnie ma origin "null"
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}
const s = (v, max) => (v == null ? '' : String(v)).trim().slice(0, max);

async function insert(table, row) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error('supabase ' + r.status + ' ' + (await r.text()).slice(0, 200));
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
  if (!b || typeof b !== 'object') { res.status(400).json({ ok: false, error: 'bad body' }); return; }
  if (b.hp) { res.status(200).json({ ok: true }); return; } // honeypot — bot, udajemy sukces

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip_hash = ip ? crypto.createHash('sha256').update(SALT + ip).digest('hex').slice(0, 16) : null;
  const user_agent = s(req.headers['user-agent'], 300);

  try {
    if (b.type === 'lead') {
      const email = s(b.email, 200), telefon = s(b.telefon, 60);
      if (!email && !telefon) { res.status(400).json({ ok: false, error: 'Podaj e-mail albo telefon' }); return; }
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { res.status(400).json({ ok: false, error: 'Nieprawidłowy e-mail' }); return; }
      const row = {
        nazwa_firmy: s(b.firma, 200) || null,
        osoba: s(b.osoba, 200) || null,
        email: email || null,
        telefon: telefon || null,
        wiadomosc: s(b.wiadomosc, 4000) || null,
        zrodlo: 'opisy-z-base',
        status: 'Nowy',
        source_page: s(b.page, 300) || 'raport-audytu',
        kalkulator: b.audyt && typeof b.audyt === 'object' ? b.audyt : null,
        utm: { session: s(b.session, 64), channel: s(b.channel, 120), ua: user_agent, ip_hash, zgoda_kontakt: !!b.zgoda },
      };
      await insert('hot_leads', row);
      if (NOTIFY) { fetch(NOTIFY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row) }).catch(() => {}); }
      res.status(200).json({ ok: true });
      return;
    }
    if (b.type === 'event') {
      const ev = s(b.event, 40);
      if (!ev) { res.status(400).json({ ok: false }); return; }
      await insert('opisy_events', {
        session_id: s(b.session, 64) || null,
        event: ev,
        channel: s(b.channel, 120) || null,
        channel_type: s(b.channel_type, 40) || null,
        lang: s(b.lang, 8) || null,
        scope: s(b.scope, 20) || null,
        products: Number.isFinite(+b.products) ? Math.round(+b.products) : null,
        summary: b.summary && typeof b.summary === 'object' ? b.summary : null,
        page: s(b.page, 200) || null,
        user_agent,
        ip_hash,
      });
      res.status(200).json({ ok: true });
      return;
    }
    res.status(400).json({ ok: false, error: 'unknown type' });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
};
