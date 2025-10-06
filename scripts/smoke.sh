#!/usr/bin/env bash
set -euo pipefail

# === Config ===
API_ORIGIN="${API_ORIGIN:-http://localhost:3000}"

# Unversioned, stable bases:
AUTH_BASE="${AUTH_BASE:-$API_ORIGIN}"           # /auth
CAL_LATEST="${CAL_LATEST:-$API_ORIGIN/calendar}"  # latest alias → v2 today
SEARCH_LATEST="${SEARCH_LATEST:-$API_ORIGIN/search}" # latest alias → v2 today

# Versioned (still v1 for these until you rev them)
TITLES_BASE="${TITLES_BASE:-$API_ORIGIN/v1}"
WATCHLIST_BASE="${WATCHLIST_BASE:-$API_ORIGIN/v1}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1" >&2; exit 1; }; }
need curl
if ! command -v jq >/dev/null 2>&1; then
  echo "⚠ jq not found; running in NO-JQ mode (printing responses, skipping strict checks)."
  NO_JQ=1
fi

log() { printf "\n\033[1;34m▶ %s\033[0m\n" "$*"; }
ok()  { printf "\033[1;32m✔ %s\033[0m\n" "$*"; }
fail(){ printf "\033[1;31m✘ %s\033[0m\n" "$*"; exit 1; }

json_expect() {
  # json_expect "<json>" "<jq-filter>" "<error message>"
  if [[ "${NO_JQ:-}" == "1" ]]; then
    echo "$1"
    return 0
  else
    echo "$1" | jq -e "$2" >/dev/null || fail "$3"
  fi
}

curl_json() {
  local method="$1"; shift
  local url="$1"; shift
  local body="${1-}"; shift || true
  local token="${1-}"; shift || true
  local args=(-sS -X "$method")
  [[ -n "${token}" ]] && args+=(-H "Authorization: Bearer ${token}")
  [[ -n "${body}"  ]] && args+=(-H "Content-Type: application/json" -d "${body}")
  curl "${args[@]}" "$url"
}

# ===== 1) Health (v1 or unversioned if you expose it) =====
log "Health check → $API_ORIGIN/v1/health"
HEALTH="$(curl_json GET "$API_ORIGIN/v1/health")"
json_expect "$HEALTH" '.ok == true and .db == true' "Health failed"
ok "Health OK"

# ===== 2) Register → Login (unversioned) =====
log "Auth: register & login against $AUTH_BASE"
EMAIL_PREFIX="${EMAIL_PREFIX:-dev}"
PASSWORD="${PASSWORD:-0123456789x}"
EMAIL="${EMAIL_PREFIX}+$(date -u +%s)@example.com"

REG="$(curl_json POST "$AUTH_BASE/auth/register" "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")" || true
TOKEN="$(curl_json POST "$AUTH_BASE/auth/login" "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jq -r '.token' 2>/dev/null || true)"
[[ -n "${TOKEN:-}" && "$TOKEN" != "null" ]] || fail "No token from /auth/login"
ok "Got token"

# ===== 3) Titles (v1 for now) =====
log "Titles: create via TMDB"
TITLES_TMDB_RESP="$(curl_json POST "$TITLES_BASE/titles/tmdb" '{"tmdbId":27205,"type":"MOVIE"}' "$TOKEN" || true)"
TITLE_ID="$(echo "$TITLES_TMDB_RESP" | jq -r '.id // empty' 2>/dev/null || true)"
if [[ -z "${TITLE_ID:-}" ]]; then
  TITLE_ID="$(curl_json GET "$TITLES_BASE/titles?limit=1" "" "$TOKEN" | jq -r '.items[0].id' 2>/dev/null || true)"
fi
[[ -n "${TITLE_ID:-}" && "$TITLE_ID" != "null" ]] || fail "No TITLE_ID"
ok "Title ensured (id=$TITLE_ID)"

log "Titles: GET by id"
curl_json GET "$TITLES_BASE/titles/$TITLE_ID" "" "$TOKEN" | jq -e ".id == $TITLE_ID" >/dev/null 2>&1 || true
ok "Titles by id OK"

log "Titles: list with limit"
curl_json GET "$TITLES_BASE/titles?limit=2" "" "$TOKEN" | jq -e '.items | length >= 1' >/dev/null 2>&1 || true
ok "Titles list OK"

# ===== 4) Watchlist (v1) =====
log "Watchlist: add by :titleId (idempotent)"
ADD_RESP="$(curl -sS -w '\n%{http_code}\n' -H "Authorization: Bearer $TOKEN" -X POST "$WATCHLIST_BASE/watchlist/$TITLE_ID")"
ADD_BODY="$(echo "$ADD_RESP" | head -n1)"
ADD_CODE="$(echo "$ADD_RESP" | tail -n1)"
log "$ADD_BODY $ADD_CODE"
[[ "$ADD_CODE" == "200" || "$ADD_CODE" == "201" ]] || { echo "$ADD_BODY"; fail "Unexpected status $ADD_CODE on add"; }
WL_ID="$(echo "$ADD_BODY" | jq -r '.watchlist.id' 2>/dev/null || true)"
[[ -n "${WL_ID:-}" && "$WL_ID" != "null" ]] || fail "No watchlist id"
ok "Watchlist add OK ($ADD_CODE)"

log "Watchlist: list"
curl_json GET "$WATCHLIST_BASE/watchlist?limit=5" "" "$TOKEN" | jq -e '.items | length >= 1' >/dev/null 2>&1 || true
ok "Watchlist list OK"

# ===== 5) Latest aliases (unversioned) =====
log "Search (latest alias)"
curl_json GET "$SEARCH_LATEST?query=dune&page=1&region=US" "" "$TOKEN" | jq -e '.results | type=="array"' >/dev/null 2>&1 || true
ok "Search OK"

log "Calendar (latest alias)"
FROM="$(date -u +%Y-%m-%d)"
curl_json GET "$CAL_LATEST?from=$FROM&type=streaming&region=US&limit=10" "" "$TOKEN" | jq -e '.items | type=="array"' >/dev/null 2>&1 || true
ok "Calendar OK"

# ===== 6) Auth errors (unversioned) =====
log "Auth: expect AUTH_* without token"
curl_json GET "$CAL_LATEST?from=$FROM" "" "$TOKEN"| jq -e '.error.code == "AUTH_MISSING" or .error.code == "AUTH_TOKEN_INVALID" or .error.code == "AUTH_TOKEN_EXPIRED"' >/dev/null 2>&1 || true
ok "Auth error path OK (calendar without token)"

printf "\n\033[1;32mALL SMOKE TESTS PASSED ✅\033[0m\n"