#!/usr/bin/env pwsh

<# Run In PowerShell: 
# local
.\scripts\smoke.ps1 -Base "http://localhost:3000/v1"

# or against prod/staging (careful: creates a test user)
.\scripts\smoke.ps1 -Base "https://api.cineschedule.com/v1"

# optional verbose HTTP logging
.\scripts\smoke.ps1 -VerboseHttp #>

param(
  [string]$Base = "http://localhost:3000/v1",
  [string]$EmailPrefix = "dev",
  [string]$Password = "0123456789x",
  [switch]$VerboseHttp
)

$ErrorActionPreference = "Stop"

function Need($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Missing dependency: $name"
  }
}

function Log([string]$msg) { Write-Host "`n▶ $msg" -ForegroundColor Cyan }
function Ok ([string]$msg) { Write-Host "✔ $msg" -ForegroundColor Green }
function Fail([string]$msg){ Write-Host "✘ $msg" -ForegroundColor Red; exit 1 }

# PS 7+ required for -SkipHttpErrorCheck
if ($PSVersionTable.PSVersion.Major -lt 7) {
  Fail "Please run with PowerShell 7+ (Install from https://aka.ms/powershell)"
}

Need "Invoke-WebRequest"
Need "ConvertFrom-Json"

function Invoke-Api {
  param(
    [Parameter(Mandatory)][ValidateSet('GET','POST','DELETE')][string]$Method,
    [Parameter(Mandatory)][string]$Url,
    [Parameter()][hashtable]$Body,
    [Parameter()][string]$Token
  )
  $headers = @{}
  if ($Token) { $headers["Authorization"] = "Bearer $Token" }
  $contentType = $null
  $jsonBody = $null
  if ($null -ne $Body) {
    $contentType = "application/json"
    $jsonBody = ($Body | ConvertTo-Json -Depth 100)
  }

  if ($VerboseHttp) {
    Write-Host "HTTP $Method $Url" -ForegroundColor DarkGray
    if ($jsonBody) { Write-Host $jsonBody -ForegroundColor DarkGray }
  }

  $resp = Invoke-WebRequest -Method $Method -Uri $Url `
          -Headers $headers `
          -ContentType $contentType `
          -Body $jsonBody `
          -SkipHttpErrorCheck

  $raw = $resp.Content
  $json = $null
  if ($raw -and $raw.Trim().StartsWith('{') -or $raw.Trim().StartsWith('[')) {
    try { $json = $raw | ConvertFrom-Json -Depth 100 } catch { $json = $null }
  }

  return [pscustomobject]@{
    Status = [int]$resp.StatusCode
    Raw    = $raw
    Json   = $json
  }
}

# ===== 1) Health =====
Log "Health check → $Base/health"
$r = Invoke-Api -Method GET -Url "$Base/health"
if (-not ($r.Json.ok -and $r.Json.db)) { $r | Format-List | Out-String | Write-Host; Fail "Health failed" }
Ok "Health OK"

# ===== 2) Register → Login =====
Log "Auth: register & login"
$Email = "$EmailPrefix+$(Get-Date -AsUTC -Format yyyyMMddHHmmss)@example.com"
$rReg = Invoke-Api -Method POST -Url "$Base/auth/register" -Body @{ email = $Email; password = $Password }
# 200 or 409 are acceptable here
if ($rReg.Status -ne 200 -and $rReg.Status -ne 409) {
  $rReg | Format-List | Out-String | Write-Host
  Fail "Unexpected status from /auth/register: $($rReg.Status)"
}
$rLogin = Invoke-Api -Method POST -Url "$Base/auth/login" -Body @{ email = $Email; password = $Password }
$TOKEN = [string]$rLogin.Json.token
if (-not $TOKEN) { $rLogin | Format-List | Out-String | Write-Host; Fail "No token from /auth/login" }
Ok "Got token"

# ===== 3) Titles (create via TMDB, fetch by id, list) =====
Log "Titles: create via TMDB"
$rTmdb = Invoke-Api -Method POST -Url "$Base/titles/tmdb" -Body @{ tmdbId = 27205; type = "MOVIE" } -Token $TOKEN
$TITLE_ID = $rTmdb.Json.id
if (-not $TITLE_ID) {
  $rList1 = Invoke-Api -Method GET -Url "$Base/titles?limit=1" -Token $TOKEN
  $TITLE_ID = $rList1.Json.items[0].id
}
if (-not $TITLE_ID) { $rTmdb | Format-List | Out-String | Write-Host; Fail "No TITLE_ID" }

Log "Titles: GET by id"
$rGet = Invoke-Api -Method GET -Url "$Base/titles/$TITLE_ID" -Token $TOKEN
if ($rGet.Json.id -ne $TITLE_ID) { $rGet | Format-List | Out-String | Write-Host; Fail "GET /titles/:id mismatch" }
Ok "Titles by id OK"

Log "Titles: list with limit"
$rList = Invoke-Api -Method GET -Url "$Base/titles?limit=2" -Token $TOKEN
if (-not ($rList.Json.items.Count -ge 1)) { $rList | Format-List | Out-String | Write-Host; Fail "Titles list empty" }
Ok "Titles list OK"

# ===== 4) Watchlist (idempotent add, list, delete) =====
Log "Watchlist: add by :titleId (idempotent)"
$rAdd = Invoke-Api -Method POST -Url "$Base/watchlist/$TITLE_ID" -Token $TOKEN
if ($rAdd.Status -ne 200 -and $rAdd.Status -ne 201) { $rAdd | Format-List | Out-String | Write-Host; Fail "Unexpected status $($rAdd.Status) on add" }
$WL_ID = $rAdd.Json.id
if (-not $WL_ID) { $rAdd | Format-List | Out-String | Write-Host; Fail "No watchlist id" }
Ok "Watchlist add OK ($($rAdd.Status))"

Log "Watchlist: list"
$rWlList = Invoke-Api -Method GET -Url "$Base/watchlist?limit=5" -Token $TOKEN
if (-not ($rWlList.Json.items.Count -ge 1)) { $rWlList | Format-List | Out-String | Write-Host; Fail "Watchlist list empty" }
Ok "Watchlist list OK"

Log "Watchlist: delete by id (idempotent)"
$rDel1 = Invoke-Api -Method DELETE -Url "$Base/watchlist/$WL_ID" -Token $TOKEN
$rDel2 = Invoke-Api -Method DELETE -Url "$Base/watchlist/$WL_ID" -Token $TOKEN
if (-not ($rDel1.Json.ok -and $rDel2.Json.ok)) { $rDel1 | Format-List | Out-String | Write-Host; $rDel2 | Format-List | Out-String | Write-Host; Fail "Delete not ok" }
Ok "Watchlist delete OK (idempotent)"

# ===== 5) Calendar =====
Log "Calendar"
$FROM = (Get-Date -AsUTC -Format yyyy-MM-dd)
$rCal = Invoke-Api -Method GET -Url "$Base/calendar?from=$FROM&limit=10" -Token $TOKEN
if (-not ($rCal.Json.items -is [System.Array])) { $rCal | Format-List | Out-String | Write-Host; Fail "Calendar items not array" }
Ok "Calendar OK"

# ===== 6) Validation errors =====
Log "Validation: expect VALIDATION_ERROR"
$rBad1 = Invoke-Api -Method GET -Url "$Base/titles?limit=0" -Token $TOKEN
if ($rBad1.Json.error.code -ne "VALIDATION_ERROR") { $rBad1 | Format-List | Out-String | Write-Host; Fail "Expected VALIDATION_ERROR on /titles?limit=0" }
$rBad2 = Invoke-Api -Method GET -Url "$Base/calendar?from=2025-99-99" -Token $TOKEN
if ($rBad2.Json.error.code -ne "VALIDATION_ERROR") { $rBad2 | Format-List | Out-String | Write-Host; Fail "Expected VALIDATION_ERROR on /calendar?from=bad" }
Ok "Validation error paths OK"

# ===== 7) Auth errors =====
Log "Auth: expect AUTH_* without token"
$rAuth = Invoke-Api -Method GET -Url "$Base/watchlist"
$code = $rAuth.Json.error.code
if (@("AUTH_TOKEN_INVALID","AUTH_TOKEN_EXPIRED") -notcontains $code) {
  $rAuth | Format-List | Out-String | Write-Host; Fail "Expected AUTH_* without token, got $code"
}
Ok "Auth error path OK"

Write-Host "`nALL SMOKE TESTS PASSED ✅" -ForegroundColor Green
