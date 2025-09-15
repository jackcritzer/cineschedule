#!/usr/bin/env bash

# RUN IN GIT BASH WITH: chmod +x scripts/smoke.sh
# RUN AGAINST LOCAL: BASE="http://localhost:3000/v1" ./scripts/smoke.sh
# RUN AGAINST PROD (!! CREATED A USER !!): BASE="https://api.cineschedule.com/v1" ./scripts/smoke.sh
set -euo pipefail

# === Config ===
BASE="${BASE:-http://localhost:3000/v1}"  # override: BASE=https://api.cineschedule.com/v1 ./smoke.sh
EMAIL_PREFIX="${EMAIL_PREFIX:-dev}"
PASSWORD="${PASSWORD:-0123456789x}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1" >&2; exit 1; }; }
need curl
need jq
date -u >/dev/null 2>&1 || true

log() { printf "\n\033[1;34m▶ %s\033[0m\n" "$*"; }
ok()  { printf "\033[1;32m✔ %s\033[0m\n" "$*"; }
fail(){ printf "\033[1;31m✘ %s\033[0m\n" "$*"; exit 1; }

curl_json() {
  # Usage: curl_json METHOD URL [BODY] [AUTH_TOKEN]
  local method="$1"; shift
  local url="$1"; shift
  local body="${1-}"; shift || true
  local token="${1-}"; shift || true

  if [[ -n "$body" ]]; then
    if [[ -n "$token" ]]; then
      curl -sS -H "Content-Type: application/json" -H "Authorization: Bearer $token" -X "$method" "$url" -d "$body"
    else
      curl -sS -H "Content-Type: application/json" -X "$method" "$url" -d "$body"
    fi
  else
    if [[ -n "$token" ]]; then
      curl -sS -H "Authorization: Bearer $token" -X "$method" "$url"
    else
      curl -sS -X "$method" "$url"
    fi
  fi
}

# ===== 1) Health =====
log "Health check → $BASE/health"
HEALTH="$(curl_json GET "$BASE/health")"
echo "$HEALTH" | jq -e '.ok == true and .db == true' >/dev/null || fail "Health failed"
ok "Health OK"

# ===== 2) Register → Login =====
log "Auth: register & login"
EMAIL="${EMAIL_PREFIX}+$(date -u +%s)@example.com"
REG="$(curl_json POST "$BASE/auth/register" "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")" || true
# Registration might 409 if you rerun quickly; that’s fine. Proceed to login.
TOKEN="$(curl_json POST "$BASE/auth/login" "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jq -r '.token')"
[[ -n "$TOKEN" && "$TOKEN" != "null" ]] || fail "No token from /auth/login"
ok "Got token"

# ===== 3) Titles (create via TMDB, fetch by id, list) =====
log "Titles: create via TMDB"
TITLES_TMDB_RESP="$(curl_json POST "$BASE/titles/tmdb" '{"tmdbId":27205,"type":"MOVIE"}' "$TOKEN" || true)"
# Some backends may return 201 with body; accommodate both 200/201.
TITLE_ID="$(echo "$TITLES_TMDB_RESP" | jq -r '.id // empty')"
if [[ -z "${TITLE_ID:-}" ]]; then
  # Fallback: fetch latest page and grab first id
  TITLE_ID="$(curl_json GET "$BASE/titles?limit=1" "" "$TOKEN" | jq -r '.items[0].id')"
fi
[[ -n "$TITLE_ID" && "$TITLE_ID" != "null" ]] || fail "No TITLE_ID"

log "Titles: GET by id"
curl_json GET "$BASE/titles/$TITLE_ID" "" "$TOKEN" | jq -e ".id == $TITLE_ID" >/dev/null
ok "Titles by id OK"

log "Titles: list with limit"
curl_json GET "$BASE/titles?limit=2" "" "$TOKEN" | jq -e '.items | length >= 1' >/dev/null
ok "Titles list OK"

# ===== 4) Watchlist (idempotent add, list, idempotent delete) =====
log "Watchlist: add by :titleId (idempotent)"
ADD_RESP="$(curl -sS -w '\n%{http_code}\n' -H "Authorization: Bearer $TOKEN" -X POST "$BASE/watchlist/$TITLE_ID")"
ADD_BODY="$(echo "$ADD_RESP" | head -n1)"
ADD_CODE="$(echo "$ADD_RESP" | tail -n1)"
[[ "$ADD_CODE" == "200" || "$ADD_CODE" == "201" ]] || { echo "$ADD_BODY" | jq .; fail "Unexpected status $ADD_CODE on add"; }
WL_ID="$(echo "$ADD_BODY" | jq -r '.id')"
[[ -n "$WL_ID" && "$WL_ID" != "null" ]] || fail "No watchlist id"
ok "Watchlist add OK ($ADD_CODE)"

log "Watchlist: list"
curl_json GET "$BASE/watchlist?limit=5" "" "$TOKEN" | jq -e '.items | length >= 1' >/dev/null
ok "Watchlist list OK"

log "Watchlist: delete by id (idempotent)"
curl_json DELETE "$BASE/watchlist/$WL_ID" "" "$TOKEN" | jq -e '.ok == true' >/dev/null
curl_json DELETE "$BASE/watchlist/$WL_ID" "" "$TOKEN" | jq -e '.ok == true' >/dev/null
ok "Watchlist delete OK (idempotent)"

# ===== 5) Calendar =====
log "Calendar"
FROM="$(date -u +%Y-%m-%d)"
curl_json GET "$BASE/calendar?from=$FROM&limit=10" "" "$TOKEN" | jq -e '.items | type=="array"' >/dev/null
ok "Calendar OK"

# ===== 6) Validation errors =====
log "Validation: expect VALIDATION_ERROR"
curl_json GET "$BASE/titles?limit=0" "" "$TOKEN" | jq -e '.error.code == "VALIDATION_ERROR"' >/dev/null || fail "Expected VALIDATION_ERROR on /titles?limit=0"
curl_json GET "$BASE/calendar?from=2025-99-99" "" "$TOKEN" | jq -e '.error.code == "VALIDATION_ERROR"' >/dev/null || fail "Expected VALIDATION_ERROR on /calendar?from=bad"
ok "Validation error paths OK"

# ===== 7) Auth errors =====
log "Auth: expect AUTH_* without token"
curl_json GET "$BASE/watchlist" | jq -e '.error.code == "AUTH_TOKEN_INVALID" or .error.code == "AUTH_TOKEN_EXPIRED"' >/dev/null || fail "Expected AUTH_* error without token"
ok "Auth error path OK"

printf "\n\033[1;32mALL SMOKE TESTS PASSED ✅\033[0m\n"