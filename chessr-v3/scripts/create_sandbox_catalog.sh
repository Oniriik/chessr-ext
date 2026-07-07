#!/usr/bin/env bash
# Crée dans Paddle SANDBOX le catalogue Chessr Premium : 1 produit + 6 prix
# (grille actuelle 2.99/29.99/59.99 ET nouvelle grille 3.99/34.99/79.99,
# avec les overrides pays des 4 paliers) — pour tester la fenêtre d'annonce
# et la bascule en local.
#
# Usage : SANDBOX_API_KEY=pdl_sdbx_apikey_xxx ./create_sandbox_catalog.sh
# Sortie : les IDs à coller dans serveur/.env.sandbox
set -euo pipefail

: "${SANDBOX_API_KEY:?SANDBOX_API_KEY manquant (clé API sandbox Paddle)}"
API="https://sandbox-api.paddle.com"
AUTH=(-H "Authorization: Bearer $SANDBOX_API_KEY" -H "Content-Type: application/json")

T2='["ES","PT","GR","PL","CZ","SK","HU","HR","SI","RO","BG","EE","LV","LT","KR","TW","CL","UY"]'
T3='["TR","BR","MX","AR","CO","PE","EC","GT","PY","DO","TH","MY","CN","ZA","RS","BA","MK","AL","ME","GE","AM","AZ","KZ","MA","TN","DZ","JO"]'
T4='["IN","ID","PH","VN","PK","BD","LK","NP","KH","LA","EG","NG","KE","GH","TZ","UG","ET","ZM","MZ","SN","CI","CM","MG","UA","UZ","KG","TJ","MD","BO","HN","NI","SV","HT"]'

echo "── Création du produit…"
PRODUCT=$(curl -s -X POST "$API/products" "${AUTH[@]}" \
  -d '{"name":"Chessr Premium (sandbox)","tax_category":"standard","description":"Sandbox mirror of Chessr Premium"}' \
  | jq -r '.data.id // (.error | tostring)')
case "$PRODUCT" in pro_*) echo "   $PRODUCT";; *) echo "ERREUR: $PRODUCT" >&2; exit 1;; esac

mkprice() { # $1 name  $2 base  $3 p2  $4 p3  $5 p4  $6 billing_cycle_json  $7 grid_tag
  jq -n --arg name "$1" --arg base "$2" --arg p2 "$3" --arg p3 "$4" --arg p4 "$5" \
        --argjson bc "$6" --arg grid "$7" --arg product "$PRODUCT" \
        --argjson t2 "$T2" --argjson t3 "$T3" --argjson t4 "$T4" '
    {
      product_id: $product, name: $name, description: ($name + " (" + $grid + ")"),
      tax_mode: "internal", quantity: {minimum: 1, maximum: 1},
      custom_data: {grid: $grid},
      unit_price: {amount: $base, currency_code: "EUR"},
      unit_price_overrides: [
        {country_codes: $t2, unit_price: {amount: $p2, currency_code: "EUR"}},
        {country_codes: $t3, unit_price: {amount: $p3, currency_code: "EUR"}},
        {country_codes: $t4, unit_price: {amount: $p4, currency_code: "EUR"}}
      ]
    } + (if $bc == null then {} else {billing_cycle: $bc} end)' \
  | curl -s -X POST "$API/prices" "${AUTH[@]}" -d @- | jq -r '.data.id // (.error | tostring)'
}

echo "── Grille ACTUELLE (2.99 / 29.99 / 59.99)…"
CUR_M=$(mkprice "Monthly"  299  230  150  100  '{"interval":"month","frequency":1}' "current")
CUR_Y=$(mkprice "Yearly"   2999 2300 1500 1000 '{"interval":"year","frequency":1}'  "current")
CUR_L=$(mkprice "Lifetime" 5999 4500 3000 2000 'null'                               "current")

echo "── NOUVELLE grille (3.99 / 34.99 / 79.99)…"
NEW_M=$(mkprice "Monthly"  399  299  199  149  '{"interval":"month","frequency":1}' "2026-07-12")
NEW_Y=$(mkprice "Yearly"   3499 2499 1799 1299 '{"interval":"year","frequency":1}'  "2026-07-12")
NEW_L=$(mkprice "Lifetime" 7999 5499 3999 2799 'null'                               "2026-07-12")

echo ""
echo "── À coller dans serveur/.env.sandbox :"
echo "PADDLE_PRICE_MONTHLY=$CUR_M"
echo "PADDLE_PRICE_YEARLY=$CUR_Y"
echo "PADDLE_PRICE_LIFETIME=$CUR_L"
echo "PADDLE_PRICE_MONTHLY_NEW=$NEW_M"
echo "PADDLE_PRICE_YEARLY_NEW=$NEW_Y"
echo "PADDLE_PRICE_LIFETIME_NEW=$NEW_L"
