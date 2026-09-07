// Proxy do API BASE (BaseLinker). Przeglądarka nie może wołać connector.php
// bezpośrednio (brak CORS), więc żądanie przechodzi tędy.
//
// Zasady:
//  - token przychodzi w nagłówku X-BL-Token i jest przekazywany dalej 1:1,
//    nigdzie nie jest zapisywany ani logowany;
//  - dozwolone są tylko metody z listy poniżej (odczyt katalogu + zapis pól tekstowych);
//  - żadnego stanu po stronie serwera, żadnej bazy.

const DOZWOLONE = new Set([
  'getInventories',
  'getInventoryAvailableTextFieldKeys',
  'getInventoryIntegrations',
  'getInventoryProductsList',
  'getInventoryProductsData',
  'addInventoryProduct',
]);

const BASE_URL = 'https://api.baselinker.com/connector.php';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ status: 'ERROR', error_code: 'METHOD_NOT_ALLOWED', error_message: 'Tylko POST' });
    return;
  }

  const token = String(req.headers['x-bl-token'] || '').trim();
  if (!token || token.length > 200) {
    res.status(401).json({ status: 'ERROR', error_code: 'NO_TOKEN', error_message: 'Brak tokena API BASE w nagłówku X-BL-Token' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const method = body && body.method;
  const parameters = (body && body.parameters) || {};

  if (!DOZWOLONE.has(method)) {
    res.status(400).json({ status: 'ERROR', error_code: 'METHOD_NOT_ALLOWED', error_message: 'Metoda ' + method + ' nie jest obsługiwana przez to narzędzie' });
    return;
  }

  // addInventoryProduct: przepuszczamy wyłącznie aktualizację pól tekstowych istniejącego produktu.
  if (method === 'addInventoryProduct') {
    const klucze = Object.keys(parameters);
    const dozwoloneKlucze = new Set(['inventory_id', 'product_id', 'text_fields']);
    const obce = klucze.filter(k => !dozwoloneKlucze.has(k));
    if (!parameters.product_id || obce.length) {
      res.status(400).json({ status: 'ERROR', error_code: 'WRITE_SCOPE', error_message: 'Zapis ograniczony do text_fields istniejącego produktu' });
      return;
    }
  }

  const form = 'method=' + encodeURIComponent(method) + '&parameters=' + encodeURIComponent(JSON.stringify(parameters));

  try {
    const r = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        'X-BLToken': token,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });
    const tekst = await r.text();
    let dane;
    try { dane = JSON.parse(tekst); }
    catch {
      res.status(502).json({ status: 'ERROR', error_code: 'BAD_UPSTREAM', error_message: 'BASE odpowiedział nie-JSON (HTTP ' + r.status + ')' });
      return;
    }
    res.status(200).json(dane);
  } catch (e) {
    res.status(502).json({ status: 'ERROR', error_code: 'UPSTREAM', error_message: 'Nie udało się połączyć z api.baselinker.com: ' + e.message });
  }
};
