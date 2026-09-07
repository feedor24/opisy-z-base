/* Audyt treści kanału — liczony w przeglądarce z danych eksportu.
   computeAudit(items, ctx) → obiekt z metrykami i score
   buildReport(audit, ctx)  → samodzielny HTML raportu (do pobrania)
   items: [{sku, ean, name, nameSrc, desc, descSrc, assign}]
   ctx:   {channelLabel, channelType, lang, scope, inventoryName, date, trackUrl}
*/
(function (global) {
  const TITLE_LIMITS = { allegro: 75, ebay: 80, amazon: 200, kaufland: 256, kauflandpl: 256, kauflandfr: 256, temupl: 200, temu: 200, olx: 70, inpsa: 100, merxu: 200, emag: 255, shopee: 120 };
  const CHANNEL_NAMES = { allegro: 'Allegro', ebay: 'eBay', amazon: 'Amazon', kaufland: 'Kaufland', kauflandpl: 'Kaufland PL', kauflandfr: 'Kaufland FR', temupl: 'Temu', olx: 'OLX', inpsa: 'InPost Fresh', merxu: 'Merxu' };

  const stripHtml = h => String(h || '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  const norm = t => stripHtml(t).toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const median = arr => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
  const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
  const RE_URL = /(https?:\/\/|www\.)[^\s<"]+/i, RE_MAIL = /[\w.+-]+@[\w-]+\.[\w.]+/, RE_PHONE = /(?:\+?48[\s-]?)?(?:\d[\s-]?){9}\b/;
  const STOP = new Set(['dla', 'oraz', 'and', 'the', 'und', 'für', 'mit', 'des', 'les', 'pour', 'avec', 'zestaw', 'set', 'typ', 'model', 'szt']);

  function computeAudit(items, ctx) {
    const n = items.length;
    const limit = TITLE_LIMITS[ctx.channelType] || 200;
    const per = items.map(it => {
      const nameT = String(it.name || '').trim();
      const descRaw = String(it.desc || '');
      const descT = stripHtml(descRaw);
      const len = descT.length;
      const hasHtml = /<[a-z][\s\S]*>/i.test(descRaw);
      const structured = /<(h[1-6]|ul|ol|li|p|br|table|strong|b)\b/i.test(descRaw) || /\n/.test(descRaw.trim());
      const issues = [];
      if (!nameT) issues.push('brak nazwy');
      if (nameT.length > limit) issues.push('nazwa > ' + limit + ' zn.');
      if (nameT && nameT.length < 20) issues.push('nazwa krótka (<20 zn.)');
      const letters = nameT.replace(/[^\p{L}]/gu, '');
      if (letters.length >= 8 && letters === letters.toUpperCase()) issues.push('nazwa WIELKIMI LITERAMI');
      if (nameT && it.sku && nameT.toUpperCase() === String(it.sku).toUpperCase()) issues.push('nazwa = SKU');
      if (!len) issues.push('brak opisu');
      else if (len < 300) issues.push('opis krótki (<300 zn.)');
      if (len >= 800 && !structured) issues.push('ściana tekstu (bez akapitów/nagłówków)');
      if (RE_URL.test(descT)) issues.push('link w opisie');
      if (RE_MAIL.test(descT)) issues.push('e-mail w opisie');
      if (RE_PHONE.test(descT) && /tel|kontakt|zadzwo|call/i.test(descT)) issues.push('telefon w opisie');
      if (!it.ean) issues.push('brak EAN');
      if (it.nameSrc !== 'marketplace' && it.descSrc !== 'marketplace') issues.push('bez treści pod kanał');
      // słowo kluczowe z nazwy w opisie
      const kw = norm(nameT).split(' ').filter(w => w.length >= 4 && !STOP.has(w))[0] || '';
      const kwInDesc = kw ? norm(descT).includes(kw) : false;
      if (kw && len >= 100 && !kwInDesc) issues.push('nazwa produktu nie pojawia się w opisie');
      return { sku: it.sku, name: nameT, len, nameLen: nameT.length, hasHtml, structured, issues, descKey: len ? norm(descT).slice(0, 400) : '', nameKey: norm(nameT), kwInDesc, kw, nameSrc: it.nameSrc, descSrc: it.descSrc, assign: it.assign };
    });

    // duplikaty
    const descCount = new Map(), nameCount = new Map();
    per.forEach(p => { if (p.descKey.length > 40) descCount.set(p.descKey, (descCount.get(p.descKey) || 0) + 1); if (p.nameKey) nameCount.set(p.nameKey, (nameCount.get(p.nameKey) || 0) + 1); });
    per.forEach(p => { if (p.descKey.length > 40 && descCount.get(p.descKey) > 1) p.issues.push('opis zduplikowany'); if (p.nameKey && nameCount.get(p.nameKey) > 1) p.issues.push('nazwa zduplikowana'); });
    const dupDescGroups = [...descCount.values()].filter(v => v > 1).length;
    const dupDescItems = per.filter(p => p.issues.includes('opis zduplikowany')).length;
    const dupNameItems = per.filter(p => p.issues.includes('nazwa zduplikowana')).length;

    const count = f => per.filter(f).length;
    const lens = per.map(p => p.len);
    const m = {
      n, limit,
      nameChannel: count(p => p.nameSrc === 'marketplace'), descChannel: count(p => p.descSrc === 'marketplace'),
      nameLang: count(p => p.nameSrc === 'język'), descLang: count(p => p.descSrc === 'język'),
      nameBase: count(p => p.nameSrc === 'bazowy'), descBase: count(p => p.descSrc === 'bazowy'),
      anyChannel: count(p => p.nameSrc === 'marketplace' || p.descSrc === 'marketplace'),
      descEmpty: count(p => !p.len), descShort: count(p => p.len > 0 && p.len < 300),
      descMid: count(p => p.len >= 300 && p.len < 1000), descGood: count(p => p.len >= 1000 && p.len < 3000), descLong: count(p => p.len >= 3000),
      descAvg: avg(lens.filter(Boolean)), descMedian: median(lens.filter(Boolean)),
      html: count(p => p.hasHtml), structured: count(p => p.len >= 300 && p.structured), wall: count(p => p.issues.includes('ściana tekstu (bez akapitów/nagłówków)')),
      nameAvg: avg(per.map(p => p.nameLen).filter(Boolean)), nameOver: count(p => p.nameLen > limit), nameShort: count(p => p.nameLen > 0 && p.nameLen < 20),
      nameCaps: count(p => p.issues.includes('nazwa WIELKIMI LITERAMI')), nameSku: count(p => p.issues.includes('nazwa = SKU')), nameEmpty: count(p => !p.nameLen),
      contact: count(p => p.issues.some(i => /link|e-mail|telefon/.test(i))),
      dupDescItems, dupDescGroups, dupNameItems,
      noEan: count(p => p.issues.includes('brak EAN')),
      kwOk: count(p => p.kw && p.len >= 100 && p.kwInDesc), kwTotal: count(p => p.kw && p.len >= 100),
      assignCat: count(p => /kategoria/.test(p.assign || '')),
      clean: count(p => !p.issues.length),
    };
    // score 0–100
    const sCover = n ? Math.round(m.descChannel / n * 100) : 0;                       // treści pod kanał
    const sDesc = n ? Math.round(count(p => p.len >= 300) / n * 70 + (m.structured / Math.max(1, count(p => p.len >= 300))) * 30) : 0; // długość + struktura
    const sName = n ? Math.round(100 - (m.nameOver + m.nameCaps + m.nameSku + m.nameEmpty + m.nameShort) / n * 100) : 0;
    const sComp = n ? Math.round(100 - m.contact / n * 100 - Math.min(50, m.dupDescItems / n * 100)) : 0;
    const sData = n ? Math.round(100 - m.noEan / n * 100) : 0;
    const sSeo = m.kwTotal ? Math.round(m.kwOk / m.kwTotal * 100) : 0;
    const clamp = v => Math.max(0, Math.min(100, v));
    const areas = [
      { key: 'cover', label: 'Treści pod kanał', score: clamp(sCover), weight: .3, desc: m.descChannel + ' z ' + n + ' opisów napisanych pod ten kanał' },
      { key: 'desc', label: 'Jakość opisów', score: clamp(sDesc), weight: .25, desc: count(p => p.len >= 300) + ' opisów ≥ 300 zn., ' + m.structured + ' z akapitami/nagłówkami' },
      { key: 'name', label: 'Tytuły ofert', score: clamp(sName), weight: .15, desc: (m.nameOver + m.nameCaps + m.nameSku + m.nameEmpty + m.nameShort) + ' tytułów z problemem (limit ' + limit + ' zn.)' },
      { key: 'seo', label: 'SEO / słowa kluczowe', score: clamp(sSeo), weight: .1, desc: m.kwOk + ' z ' + m.kwTotal + ' opisów zawiera główne słowo z tytułu' },
      { key: 'comp', label: 'Zgodność z regulaminami', score: clamp(sComp), weight: .1, desc: m.contact + ' z danymi kontaktowymi, ' + m.dupDescItems + ' zduplikowanych opisów' },
      { key: 'data', label: 'Dane produktowe', score: clamp(sData), weight: .1, desc: m.noEan + ' produktów bez EAN' },
    ];
    const total = Math.round(areas.reduce((a, x) => a + x.score * x.weight, 0));

    const good = [], fix = [];
    const add = (cond, arr, txt) => { if (cond) arr.push(txt); };
    add(pct(m.descChannel, n) >= 80, good, pct(m.descChannel, n) + '% opisów jest pisanych pod ten kanał — to najlepszy fundament, jaki może mieć katalog.');
    add(pct(m.descChannel, n) < 80, fix, (n - m.descChannel) + ' produktów (' + pct(n - m.descChannel, n) + '%) leci na opisie bazowym albo tłumaczeniu, nie na treści pisanej pod ten kanał.');
    add(m.descEmpty === 0, good, 'Żaden produkt nie jest bez opisu.');
    add(m.descEmpty > 0, fix, m.descEmpty + ' produktów nie ma żadnego opisu — te oferty praktycznie nie sprzedają.');
    add(m.descShort > 0, fix, m.descShort + ' opisów ma mniej niż 300 znaków — za mało, żeby odpowiedzieć na pytania kupującego i żeby algorytm marketplace\'u miał co indeksować.');
    add(m.descAvg >= 800, good, 'Średnia długość opisu to ' + m.descAvg + ' znaków — solidny poziom.');
    add(m.descAvg > 0 && m.descAvg < 800, fix, 'Średnia długość opisu to tylko ' + m.descAvg + ' znaków. Dobre oferty w większości kategorii mają 800–2 000.');
    add(m.wall > 0, fix, m.wall + ' opisów to „ściana tekstu" bez akapitów, nagłówków ani list — na telefonie nikt tego nie przeczyta.');
    add(m.structured > 0 && pct(m.structured, count(p => p.len >= 300)) >= 80, good, 'Opisy mają strukturę (akapity, nagłówki, listy) — dobrze się je czyta na telefonie.');
    add(m.nameOver > 0, fix, m.nameOver + ' tytułów przekracza orientacyjny limit ' + limit + ' znaków dla tego kanału — będą ucięte albo odrzucone.');
    add(m.nameOver === 0 && m.nameEmpty === 0, good, 'Wszystkie tytuły mieszczą się w limicie ' + limit + ' znaków.');
    add(m.nameCaps > 0, fix, m.nameCaps + ' tytułów jest WIELKIMI LITERAMI — marketplace\'y to karzą, a kupujący to omijają.');
    add(m.nameSku > 0, fix, m.nameSku + ' tytułów to sam kod produktu zamiast nazwy.');
    add(m.nameShort > 0, fix, m.nameShort + ' tytułów ma mniej niż 20 znaków — brakuje w nich cech, po których ludzie szukają.');
    add(m.dupDescItems > 0, fix, m.dupDescItems + ' produktów dzieli identyczny opis z innymi (' + m.dupDescGroups + ' grup) — duplikaty obniżają widoczność całej grupy.');
    add(m.dupDescItems === 0 && n > 1, good, 'Brak zduplikowanych opisów.');
    add(m.dupNameItems > 0, fix, m.dupNameItems + ' produktów ma identyczny tytuł z innym produktem.');
    add(m.contact > 0, fix, m.contact + ' opisów zawiera link, e-mail albo telefon — na Allegro i Amazonie to podstawa do zablokowania oferty.');
    add(m.contact === 0, good, 'Żaden opis nie zawiera danych kontaktowych ani linków — zgodnie z regulaminami marketplace\'ów.');
    add(m.noEan > 0, fix, m.noEan + ' produktów nie ma EAN — Amazon, Kaufland i coraz częściej Allegro tego wymagają.');
    add(m.noEan === 0, good, 'Wszystkie produkty mają EAN.');
    add(m.kwTotal > 0 && pct(m.kwOk, m.kwTotal) < 70, fix, 'W ' + (m.kwTotal - m.kwOk) + ' opisach nie pojawia się główne słowo z tytułu — kupujący i wyszukiwarka nie znajdą potwierdzenia, że to ten produkt.');
    add(m.kwTotal > 0 && pct(m.kwOk, m.kwTotal) >= 70, good, pct(m.kwOk, m.kwTotal) + '% opisów powtarza główne słowo kluczowe z tytułu.');

    const worst = per.filter(p => p.issues.length).sort((a, b) => b.issues.length - a.issues.length || a.sku.localeCompare(b.sku)).slice(0, 25);
    return { n, m, areas, total, good, fix, worst, ctx };
  }

  /* ---------- raport HTML ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = n => Number(n || 0).toLocaleString('pl-PL');

  function buildReport(a, ctx) {
    const m = a.m, n = a.n;
    const grade = a.total >= 80 ? ['Bardzo dobrze', '#047857'] : a.total >= 60 ? ['Dobrze, jest co poprawić', '#B45309'] : a.total >= 40 ? ['Słabo — treści hamują sprzedaż', '#C2410C'] : ['Krytycznie', '#B91C1C'];
    const ring = (score, color) => { const r = 54, c = 2 * Math.PI * r, o = c * (1 - score / 100); return '<svg viewBox="0 0 128 128" width="128" height="128"><circle cx="64" cy="64" r="' + r + '" fill="none" stroke="#E2E8F0" stroke-width="12"/><circle cx="64" cy="64" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + o.toFixed(1) + '" transform="rotate(-90 64 64)"/><text x="64" y="72" text-anchor="middle" font-family="Manrope,Inter,system-ui" font-weight="800" font-size="34" fill="#0F172A">' + score + '</text></svg>'; };
    const bar = (label, val, total, color) => '<div class="bar"><div class="bl"><span>' + esc(label) + '</span><b>' + fmt(val) + ' <small>(' + pct(val, total) + '%)</small></b></div><div class="bt"><i style="width:' + pct(val, total) + '%;background:' + color + '"></i></div></div>';
    const areaColor = s => s >= 80 ? '#10B981' : s >= 60 ? '#F59E0B' : '#DC2626';
    const dist = [['bez opisu', m.descEmpty, '#DC2626'], ['1–299 zn.', m.descShort, '#F59E0B'], ['300–999 zn.', m.descMid, '#A78BFA'], ['1 000–2 999 zn.', m.descGood, '#7C3AED'], ['3 000+ zn.', m.descLong, '#4F46E5']];
    const src = [['pod kanał', m.descChannel, '#4F46E5'], ['tłumaczenie', m.descLang, '#10B981'], ['bazowy', m.descBase, '#F59E0B'], ['brak', m.descEmpty, '#DC2626']];
    const chName = esc(ctx.channelLabel);
    const trackUrl = ctx.trackUrl || 'https://opisy-z-base.vercel.app/api/track';
    const audytJson = JSON.stringify({ score: a.total, n, channel: ctx.channelLabel, lang: ctx.lang, areas: Object.fromEntries(a.areas.map(x => [x.key, x.score])), descChannelPct: pct(m.descChannel, n), descAvg: m.descAvg, descEmpty: m.descEmpty, descShort: m.descShort, nameOver: m.nameOver, dup: m.dupDescItems, noEan: m.noEan, contact: m.contact });

    return '<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Audyt treści — ' + chName + ' — ' + esc(ctx.date) + '</title>' +
'<style>' +
':root{--ink:#0F172A;--soft:#334155;--muted:#64748B;--line:#E2E8F0;--surface:#F8FAFC;--primary:#4F46E5;--accent:#7C3AED}' +
'*{box-sizing:border-box;margin:0;padding:0}body{font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:#fff;line-height:1.55;font-size:15px}' +
'.wrap{max-width:960px;margin:0 auto;padding:40px 28px 80px}h1,h2,h3{font-family:Manrope,Inter,system-ui,sans-serif;letter-spacing:-.02em}h1{font-size:30px;font-weight:800;line-height:1.15}h2{font-size:21px;font-weight:800;margin:44px 0 14px}h3{font-size:16px;font-weight:700;margin-bottom:6px}' +
'.top{display:flex;justify-content:space-between;align-items:center;gap:16px;border-bottom:1px solid var(--line);padding-bottom:18px;margin-bottom:28px;flex-wrap:wrap}.brand{font-family:Manrope,Inter,sans-serif;font-weight:800;font-size:20px;display:flex;align-items:center;gap:8px}.brand small{font-family:Inter,sans-serif;font-weight:500;color:var(--muted);font-size:13px;border-left:1px solid #CBD5E1;padding-left:8px;margin-left:2px}' +
'.meta{color:var(--muted);font-size:13px;text-align:right}.eyebrow{font-size:11.5px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:10px}' +
'.hero{display:grid;grid-template-columns:auto 1fr;gap:28px;align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:26px;margin-top:22px}.hero .g{font-weight:700;font-size:18px}.hero p{color:var(--soft);margin-top:6px;max-width:60ch}' +
'.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:18px}.kpi{border:1px solid var(--line);border-radius:14px;padding:14px 16px}.kpi .v{font-family:Manrope,Inter,sans-serif;font-weight:800;font-size:26px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}.kpi .l{font-size:12.5px;color:var(--muted);margin-top:2px}' +
'.areas{display:grid;gap:10px}.area{display:grid;grid-template-columns:200px 1fr auto;gap:14px;align-items:center;border:1px solid var(--line);border-radius:12px;padding:12px 16px}.area .t{font-weight:600}.area .d{font-size:13px;color:var(--muted)}.area .s{font-family:Manrope,Inter,sans-serif;font-weight:800;font-size:22px;font-variant-numeric:tabular-nums}.area .bt{height:8px;background:var(--line);border-radius:4px;overflow:hidden}.area .bt i{display:block;height:100%}' +
'.two{display:grid;grid-template-columns:1fr 1fr;gap:20px}.card{border:1px solid var(--line);border-radius:16px;padding:20px}.bar{margin-bottom:10px}.bl{display:flex;justify-content:space-between;font-size:13.5px;margin-bottom:4px}.bl b{font-variant-numeric:tabular-nums}.bl small{color:var(--muted);font-weight:500}.bt{height:9px;background:var(--line);border-radius:5px;overflow:hidden}.bt i{display:block;height:100%}' +
'.list{list-style:none;display:grid;gap:10px}.list li{display:flex;gap:10px;align-items:flex-start;color:var(--soft)}.list li::before{content:"";flex-shrink:0;width:22px;height:22px;border-radius:50%;margin-top:1px;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center}.good li::before{content:"✓";background:#ECFDF5;color:#047857}.fix li::before{content:"!";background:#FEF2F2;color:#B91C1C}' +
'table{width:100%;border-collapse:collapse;font-size:13.5px}th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{background:var(--surface);color:var(--muted);font-size:11.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}td.sku{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;white-space:nowrap}td.nm{max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tag{display:inline-block;background:#FEF2F2;color:#B91C1C;border-radius:999px;padding:2px 8px;font-size:11.5px;font-weight:600;margin:2px 4px 2px 0}' +
'.cta{background:var(--ink);color:#F8FAFC;border-radius:18px;padding:30px;margin-top:48px;display:grid;grid-template-columns:1.1fr .9fr;gap:30px}.cta h2{color:#fff;margin:0 0 10px;font-size:24px}.cta p{color:#CBD5E1;max-width:52ch}.cta .stat{font-family:Manrope,Inter,sans-serif;font-weight:800;font-size:38px;color:#fff;margin-top:18px;letter-spacing:-.03em}.cta .stat small{display:block;font-family:Inter,sans-serif;font-weight:400;font-size:13px;color:#94A3B8;letter-spacing:0;margin-top:2px}' +
'.form{background:#fff;border-radius:14px;padding:18px;color:var(--ink)}.form label{display:block;font-size:12.5px;font-weight:600;color:var(--soft);margin:10px 0 4px}.form input,.form textarea{width:100%;border:1.5px solid var(--line);border-radius:10px;padding:10px 12px;font:inherit;font-size:14px}.form textarea{min-height:70px;resize:vertical}.form .cb{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:var(--muted);margin-top:10px;font-weight:400}.form button{width:100%;margin-top:14px;border:0;background:var(--accent);color:#fff;font:inherit;font-weight:600;font-size:15px;padding:13px;border-radius:11px;cursor:pointer}.form button:disabled{opacity:.6}.form .ok{background:#ECFDF5;color:#047857;border-radius:10px;padding:12px;font-weight:600;margin-top:12px}.form .err{color:#B91C1C;font-size:13px;margin-top:8px}.form .alt{font-size:12.5px;color:var(--muted);margin-top:10px;text-align:center}.form .alt a{color:var(--primary)}' +
'.foot{margin-top:36px;color:var(--muted);font-size:12.5px;line-height:1.6}.foot a{color:var(--muted)}' +
'@media(max-width:760px){.wrap{padding:24px 18px 60px}.hero,.two,.cta{grid-template-columns:1fr}.kpis{grid-template-columns:1fr 1fr}.area{grid-template-columns:1fr;gap:6px}.meta{text-align:left}}' +
'@media print{.wrap{padding:0}.cta{break-inside:avoid}.form button{display:none}}' +
'</style></head><body><div class="wrap">' +
'<div class="top"><div class="brand"><svg width="26" height="26" viewBox="0 0 48 48" fill="none"><g stroke="#4F46E5" stroke-width="2.4" stroke-linecap="round"><path d="M11 36 L18 25" opacity=".55"/><path d="M24 38 L18 25" opacity=".55"/><path d="M24 38 L30 25" opacity=".55"/><path d="M37 36 L30 25" opacity=".55"/><path d="M18 25 L24 13" opacity=".85"/><path d="M30 25 L24 13" opacity=".85"/></g><g fill="#4F46E5"><circle cx="11" cy="36" r="3.4"/><circle cx="24" cy="38" r="3.4"/><circle cx="37" cy="36" r="3.4"/><circle cx="18" cy="25" r="3.4"/><circle cx="30" cy="25" r="3.4"/></g><circle cx="24" cy="11" r="5" fill="#7C3AED"/></svg>mams <small>Opisy z BASE</small></div><div class="meta">Audyt treści kanału<br>' + esc(ctx.date) + ' · katalog ' + esc(ctx.inventoryName || '') + '</div></div>' +
'<div class="eyebrow">Raport audytu</div><h1>' + chName + (ctx.lang ? ' · ' + esc(String(ctx.lang).toUpperCase()) : '') + ' — stan treści na ' + fmt(n) + ' ofertach</h1>' +
'<p style="color:var(--soft);margin-top:8px;max-width:70ch">Zakres: ' + esc(ctx.scopeLabel || '') + '. Liczby pochodzą z pól tekstowych w BASE, dokładnie tych, które trafiają na marketplace po kaskadzie kanał → język → bazowy.</p>' +
'<div class="hero"><div>' + ring(a.total, grade[1]) + '</div><div><div class="g" style="color:' + grade[1] + '">' + grade[0] + '</div><p>Wynik ' + a.total + '/100 to średnia ważona sześciu obszarów poniżej. Największą wagę ma to, czy treści są pisane pod ten kanał (30%) i jakość opisów (25%).</p></div></div>' +
'<div class="kpis"><div class="kpi"><div class="v">' + pct(m.descChannel, n) + '%</div><div class="l">opisów pisanych pod ' + chName + '</div></div><div class="kpi"><div class="v">' + fmt(m.descAvg) + '</div><div class="l">średnia długość opisu (zn.)</div></div><div class="kpi"><div class="v">' + fmt(m.descEmpty + m.descShort) + '</div><div class="l">opisów pustych lub &lt; 300 zn.</div></div><div class="kpi"><div class="v">' + fmt(m.clean) + '</div><div class="l">ofert bez żadnych uwag</div></div></div>' +
'<h2>Ocena w obszarach</h2><div class="areas">' + a.areas.map(x => '<div class="area"><div><div class="t">' + esc(x.label) + '</div><div class="d">' + esc(x.desc) + ' · waga ' + Math.round(x.weight * 100) + '%</div></div><div class="bt"><i style="width:' + x.score + '%;background:' + areaColor(x.score) + '"></i></div><div class="s" style="color:' + areaColor(x.score) + '">' + x.score + '</div></div>').join('') + '</div>' +
'<div class="two" style="margin-top:36px"><div class="card"><h3>Skąd pochodzą opisy</h3><p style="font-size:13px;color:var(--muted);margin-bottom:12px">Kaskada BASE: nadpisanie dla kanału → tłumaczenie → bazowy</p>' + src.map(x => bar(x[0], x[1], n, x[2])).join('') + '</div><div class="card"><h3>Długość opisów</h3><p style="font-size:13px;color:var(--muted);margin-bottom:12px">Mediana ' + fmt(m.descMedian) + ' zn. · ' + pct(m.html, n) + '% opisów zawiera HTML</p>' + dist.map(x => bar(x[0], x[1], n, x[2])).join('') + '</div></div>' +
'<div class="two" style="margin-top:20px"><div class="card"><h3 style="color:#047857">Co jest dobrze</h3>' + (a.good.length ? '<ul class="list good">' + a.good.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>' : '<p style="color:var(--muted)">Niewiele — patrz kolumna obok.</p>') + '</div><div class="card"><h3 style="color:#B91C1C">Do poprawy</h3>' + (a.fix.length ? '<ul class="list fix">' + a.fix.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>' : '<p style="color:var(--muted)">Nic istotnego. Gratulacje.</p>') + '</div></div>' +
(a.worst.length ? '<h2>Oferty z największą liczbą uwag</h2><p style="color:var(--muted);font-size:13.5px;margin-bottom:12px">Pierwsze ' + a.worst.length + ' z ' + fmt(n - m.clean) + ' ofert z uwagami. Pełną listę masz w pliku XLSX — kolumny „Źródło" i „Znaków w opisie".</p><div style="overflow-x:auto"><table><tr><th>SKU</th><th>Tytuł</th><th>Opis (zn.)</th><th>Uwagi</th></tr>' + a.worst.map(p => '<tr><td class="sku">' + esc(p.sku) + '</td><td class="nm" title="' + esc(p.name) + '">' + esc(p.name || '—') + '</td><td>' + fmt(p.len) + '</td><td>' + p.issues.map(i => '<span class="tag">' + esc(i) + '</span>').join('') + '</td></tr>').join('') + '</table></div>' : '') +
'<div class="cta" id="kontakt"><div><div class="eyebrow" style="color:#A78BFA">Co dalej</div><h2>Chcesz, żeby ktoś to po prostu ogarnął?</h2><p>Ten raport pokazuje, gdzie treści hamują sprzedaż. My te treści piszemy i wgrywamy do BASE: opisy pod każdy kanał, masowo, na cały katalog, w jakości, która przechodzi walidację marketplace\'ów. Zostaw kontakt — przejrzę Twój raport i powiem, co bym zrobił najpierw. Bez zobowiązań.</p><div class="stat">+130% GMV r/r<small>u dystrybutora 11 000+ SKU po wdrożeniu MAMS (pomiar: sierpień 2026)</small></div><p style="margin-top:18px;font-size:14px">Maciej Fidor · <a href="mailto:maciej.fidor@mediafy.com.pl" style="color:#A78BFA">maciej.fidor@mediafy.com.pl</a> · <a href="tel:+48786119528" style="color:#A78BFA">786 119 528</a> · <a href="https://mams.mediafy.com.pl" style="color:#A78BFA">mams.mediafy.com.pl</a></p></div>' +
'<form class="form" id="lead-form"><h3>Napisz do mnie</h3><label>Firma</label><input name="firma" placeholder="Nazwa firmy"><label>Imię i nazwisko</label><input name="osoba"><label>E-mail *</label><input name="email" type="email" required placeholder="ty@firma.pl"><label>Telefon</label><input name="telefon" type="tel" placeholder="+48 …"><label>Wiadomość</label><textarea name="wiadomosc" placeholder="Np. Chcę poprawić opisy na ' + chName + ' dla całego katalogu."></textarea><input name="hp" style="display:none" tabindex="-1" autocomplete="off"><label class="cb"><input type="checkbox" name="zgoda" required style="width:auto;margin-top:3px"> Zgadzam się na kontakt Mediafy w sprawie moich ofert. Dane trafiają tylko do Mediafy (<a href="https://opisy-z-base.vercel.app/polityka-prywatnosci" target="_blank">polityka prywatności</a>).</label><button type="submit">Wyślij — odezwę się w 1 dzień roboczy</button><div class="err" id="lead-err"></div><div class="alt">Wolisz maila? <a href="mailto:maciej.fidor@mediafy.com.pl?subject=' + encodeURIComponent('Audyt ' + ctx.channelLabel + ' — ' + a.total + '/100') + '">Napisz bezpośrednio</a></div></form></div>' +
'<div class="foot">Raport wygenerowany przez darmowe narzędzie <a href="https://opisy-z-base.vercel.app">Opisy z BASE</a> (MAMS · Mediafy) na podstawie danych z API BASE. Limity długości tytułów są orientacyjne — sprawdź aktualne wymagania kanału. Progi jakości (300 zn., 800 zn., struktura) to praktyka z wdrożeń, nie oficjalne reguły marketplace\'ów. BASE i BaseLinker są znakami towarowymi ich właściciela.</div>' +
'</div><script>(function(){var f=document.getElementById("lead-form"),e=document.getElementById("lead-err");f.addEventListener("submit",function(ev){ev.preventDefault();var b=f.querySelector("button");b.disabled=true;e.textContent="";var d={type:"lead",page:"raport-audytu",channel:' + JSON.stringify(ctx.channelLabel) + ',audyt:' + audytJson + '};["firma","osoba","email","telefon","wiadomosc","hp"].forEach(function(k){d[k]=f.elements[k].value});d.zgoda=f.elements.zgoda.checked;fetch(' + JSON.stringify(trackUrl) + ',{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)}).then(function(r){return r.json()}).then(function(j){if(j.ok){f.innerHTML="<div class=ok>Dzięki — mam Twoją wiadomość. Odezwę się w ciągu 1 dnia roboczego.</div>"}else{throw new Error(j.error||"błąd")}}).catch(function(x){b.disabled=false;e.textContent="Nie udało się wysłać ("+x.message+"). Napisz mailem: maciej.fidor@mediafy.com.pl"})})})();</script></body></html>';
  }

  global.OpisyAudit = { computeAudit, buildReport, TITLE_LIMITS, CHANNEL_NAMES, stripHtml };
})(window);
