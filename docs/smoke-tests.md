# CineSchedule — Phase 7 Smoke Tests

> Requires: curl, jq

## 0) Setup
```bash
set -euo pipefail
BASE="${BASE:-https://api.cineschedule.com/v1}"
echo "Using BASE=$BASE"
CT="Content-Type: application/json"
```

## 1) Health
```bash
curl -sS "$BASE/health" | jq -e '.ok == true and .db == true' >/dev/null
echo "Health OK"
```

## 2) Register (unique email each run) → Login → export TOKEN
```bash
EMAIL="dev+$(date +%s)@example.com"
PASS="0123456789x"
curl -sS -X POST "$BASE/auth/register" -H "$CT" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | jq -e '.token' >/dev/null
TOKEN="$(curl -sS -X POST "$BASE/auth/login" -H "$CT" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | jq -r '.token')"
test -n "$TOKEN"
echo "TOKEN acquired"
```

## 3) Titles — upsert via TMDB, get by id, list with pagination
```bash
# Create via TMDB
TITLE_JSON="$(curl -sS -X POST "$BASE/titles/tmdb" -H "$CT" -H "Authorization: Bearer $TOKEN" -d '{"tmdbId":27205,"type":"MOVIE"}')"
TITLE_ID="$(echo "$TITLE_JSON" | jq -r '.id')"
test "$TITLE_ID" != "null"

# Get by id
curl -sS "$BASE/titles/$TITLE_ID" -H "Authorization: Bearer $TOKEN" | jq -e ".id == $TITLE_ID" >/dev/null

# List with limit
LIST_JSON="$(curl -sS "$BASE/titles?limit=2" -H "Authorization: Bearer $TOKEN")"
echo "$LIST_JSON" | jq -e '.items | length >= 1' >/dev/null
echo "Titles OK"
```

## 4) Watchlist — add by :titleId (idempotent), list, delete (idempotent)
```bash
# Add (first time -> 201, subsequent -> 200)
ADD_JSON="$(curl -sS -w '\n%{http_code}\n' -X POST "$BASE/watchlist/$TITLE_ID" -H "Authorization: Bearer $TOKEN")"
ADD_BODY="$(echo "$ADD_JSON" | head -n1)"
ADD_CODE="$(echo "$ADD_JSON" | tail -n1)"
echo "Add status: $ADD_CODE"
test "$ADD_CODE" = "201" -o "$ADD_CODE" = "200"
WL_ID="$(echo "$ADD_BODY" | jq -r '.id')"
test "$WL_ID" != "null"

# List
curl -sS "$BASE/watchlist?limit=5" -H "Authorization: Bearer $TOKEN" | jq -e '.items | length >= 1' >/dev/null

# Delete by watchlist id (idempotent)
curl -sS -X DELETE "$BASE/watchlist/$WL_ID" -H "Authorization: Bearer $TOKEN" | jq -e '.ok == true' >/dev/null
curl -sS -X DELETE "$BASE/watchlist/$WL_ID" -H "Authorization: Bearer $TOKEN" | jq -e '.ok == true' >/dev/null
echo "Watchlist OK"
```

## 5) Calendar — date filters & limit
```bash
FROM="$(date -u +%Y-%m-%d)"
curl -sS "$BASE/calendar?from=$FROM&limit=10" -H "Authorization: Bearer $TOKEN" | jq -e '.items | type=="array"' >/dev/null
echo "Calendar OK"
```

## 6) Validation failures — expect error envelope
```bash
# bad limit
curl -sS "$BASE/titles?limit=0" -H "Authorization: Bearer $TOKEN" | jq -e '.error.code == "VALIDATION_ERROR"' >/dev/null
# bad date
curl -sS "$BASE/calendar?from=2025-99-99" -H "Authorization: Bearer $TOKEN" | jq -e '.error.code == "VALIDATION_ERROR"' >/dev/null
echo "Validation error paths OK"
```

## 7) Auth failures — expect AUTH_* codes
```bash
curl -sS "$BASE/watchlist" | jq -e '.error.code == "AUTH_TOKEN_INVALID" or .error.code == "AUTH_TOKEN_EXPIRED"' >/dev/null
echo "Auth error paths OK"
```