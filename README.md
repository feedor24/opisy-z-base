# Opisy per marketplace z BASE

Darmowe narzędzie od [MAMS](https://mams.mediafy.com.pl) (Mediafy) dla użytkowników BASE (BaseLinker).
Eksportuje nazwy i opisy ofert dla wybranego kanału sprzedaży i języka do XLSX/CSV
i importuje poprawiony plik z powrotem przez API. BASE nie ma wbudowanego masowego
eksportu pól per marketplace — to wypełnia tę lukę.

## Struktura

```
index.html   landing: zalety, jak działa, bezpieczeństwo, instrukcja tokena API, FAQ
app.html     aplikacja (eksport + import) — jeden plik, logika w przeglądarce
api/base.js  proxy do api.baselinker.com (Vercel serverless) — token z nagłówka, bez zapisu
api/track.js zapis leadów (formularz w raporcie) i anonimowych zdarzeń do Supabase (centrum dowodzenia: hot_leads, opisy_events)
audit.js     audyt treści kanału + generator raportu HTML
raport-demo.html  przykładowy raport na danych syntetycznych (link z landingu)
img/         zrzuty ekranu do instrukcji tokena: token-1.png … token-5.png (16:10)
regulamin.html · polityka-prywatnosci.html · doc.css   dokumenty prawne (UŚUDE art. 8, RODO art. 13)
fonts/ fonts.css   Inter + Manrope hostowane lokalnie (bez Google Fonts)
vendor/xlsx.full.min.js   SheetJS 0.18.5 hostowany lokalnie (bez CDN)
```

Adresy po wdrożeniu (`cleanUrls`): `/` = landing, `/app` = narzędzie, `/api/base` = proxy,
`/regulamin`, `/polityka-prywatnosci`. Strona nie ładuje nic z zewnętrznych domen (prywatność, brak banera cookie).

**Przed publikacją uzupełnij pola `[UZUPEŁNIJ]` w regulaminie i polityce** (dane usługodawcy, data) — dokumenty
przygotowane jako wzór, do weryfikacji prawnej.

## Jak działa

```
przeglądarka ──(POST /api/base, nagłówek X-BL-Token)──> Vercel function ──> api.baselinker.com
```

Proxy przepuszcza tylko: `getInventories`, `getInventoryAvailableTextFieldKeys`,
`getInventoryIntegrations`, `getInventoryProductsList`, `getInventoryProductsData`,
`addInventoryProduct` (i to wyłącznie z `product_id` + `text_fields`). Nic nie jest
zapisywane ani logowane po stronie serwera.

Kaskada odczytu pola dla kanału: `pole|język|kanał` → `pole|język` → `pole`.
Kolumna „Źródło" w pliku mówi, z którego poziomu wzięta jest wartość.

Import: dopasowanie po SKU (albo ID BASE), porównanie z aktualnym stanem pod klucz
docelowy, podgląd diff, kopia zapasowa XLSX, zapis 1 zapytanie / produkt z odstępem
650 ms (limit BASE: 100 zapytań/min).

## Zakres „wystawione na kanale"

API BASE nie zwraca listy ofert marketplace. Proxy sygnału: produkt ma `marketplace_category_id|<integracja>`
(lub `|<typ>_0[|site]` — Amazon) w `text_fields` (`include_marketplace_categories: true`). Kolumny w pliku:
„Przypisanie do kanału" (kategoria + treści / kategoria / tylko treści / brak) i „Kategoria marketplace (ID)".

## Leady i statystyki

`/api/track` → Supabase `jpkxaoohshlnylddncxf` kluczem anon (RLS: insert-only). Env vary opcjonalne:
`LEADS_SUPABASE_URL`, `LEADS_SUPABASE_KEY`, `LEADS_NOTIFY_WEBHOOK` (POST z leadem, np. n8n → mail), `IP_SALT`.
Vercel Web Analytics: włącz w dashboardzie projektu (skrypt już jest w HTML).

## Wdrożenie na Vercel

Framework Preset: **Other**, bez build command, output directory: katalog główny.
Zero zmiennych środowiskowych.

## Test lokalny

```
npx vercel dev
```

## Licencja

MIT.
