# scripts\cs.ps1
# CineSchedule PowerShell helpers for Option A (API local :3000, Postgres in Docker)

# --- .env loader (simple .env KEY=VALUE parser) ---
function Load-DotEnv([string]$Path = ".env") {
  if (-not (Test-Path $Path)) { Write-Verbose "No .env at $Path"; return }
  Get-Content $Path | ForEach-Object {
    if ($_ -match '^\s*#') { return }
    if ($_ -match '^\s*$') { return }
    if ($_ -match '^\s*([^=]+?)\s*=\s*(.*)\s*$') {
      $key = $matches[1].Trim()
      $val = $matches[2].Trim()
      if ($val.StartsWith('"') -and $val.EndsWith('"')) { $val = $val.Substring(1, $val.Length-2) }
      if ($val.StartsWith("'") -and $val.EndsWith("'")) { $val = $val.Substring(1, $val.Length-2) }
      # remove inline comment if unquoted value
      if (-not ($val.StartsWith('"') -or $val.StartsWith("'"))) { $val = ($val -replace '\s+#.*$','') }

      # ✅ set process env var for this session
      Set-Item -Path ("Env:{0}" -f $key) -Value $val
    }
  }
}

# --- Session setup ---
function cs-init([string]$EnvPath = ".env") {
  Load-DotEnv $EnvPath
  $script:BASE   = "http://localhost:3000"
  $script:JSONHD = @{ "Content-Type" = "application/json" }
  Write-Host "BASE set to $BASE"
  if ($env:TMDB_API_KEY) { Write-Host "TMDB_API_KEY loaded (len=$(( $env:TMDB_API_KEY | Measure-Object -Character ).Characters))" }
}

# --- DB (Docker) ---
function cs-db-up() {
  docker compose up -d db | Out-Null
  docker compose ps
}

# --- Auth: login + stash token ---
function cs-login([string]$Email = $env:CINE_EMAIL, [string]$Password = $env:CINE_PASSWORD) {
  if (-not $Email)    { $Email    = Read-Host "Email" }
  if (-not $Password) { $Password = Read-Host "Password" }
  $body  = @{ email = $Email; password = $Password } | ConvertTo-Json
  $resp  = Invoke-RestMethod -Method POST -Uri "$BASE/auth/login" -Headers $JSONHD -Body $body
  $global:TOKEN = $resp.token
  $global:AUTH  = @{ Authorization = "Bearer $TOKEN" }
  Write-Host ("JWT set (first 20): " + $TOKEN.Substring(0,20) + "…")
}

function cs-register([string]$Email = $env:CINE_EMAIL, [string]$Password = $env:CINE_PASSWORD) {
  if (-not $Email)    { $Email    = Read-Host "Email" }
  if (-not $Password) {
    # prompt securely, then convert to plain for JSON body
    $sec = Read-Host "Password" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try { $Password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  }

  $body = @{ email = $Email; password = $Password } | ConvertTo-Json
  try {
    $resp = Invoke-RestMethod -Method POST -Uri "$BASE/auth/register" -Headers $JSONHD -Body $body

    # If your /auth/register returns a token, capture it
    if ($resp.PSObject.Properties.Name -contains 'token' -and $resp.token) {
      $global:TOKEN = $resp.token
      $global:AUTH  = @{ Authorization = "Bearer $TOKEN" }
      Write-Host ("Registered and JWT set (first 20): " + $TOKEN.Substring(0,20) + "…")
    } else {
      Write-Host "Registered. Run cs-login to obtain a token."
    }
    return $resp
  } catch {
    # If already exists, attempt login with same creds
    $msg = $_.Exception.Message
    if ($msg -match '409' -or $msg -match 'exist') {
      Write-Warning "User likely exists. Attempting login with provided credentials…"
      return cs-login -Email $Email -Password $Password
    }
    throw
  }
}

# --- Convenience calls ---
function cs-add-tmdb([int]$TmdbId, [ValidateSet('MOVIE','TV')]$Type) {
  $b = @{ tmdbId = $TmdbId; type = $Type } | ConvertTo-Json
  Invoke-RestMethod -Method POST -Uri "$BASE/watchlist/tmdb" -Headers ($AUTH + $JSONHD) -Body $b | ConvertTo-Json -Depth 6
}

function cs-refresh([int]$TitleId) {
  Invoke-RestMethod -Method POST -Uri "$BASE/titles/$TitleId/refresh" -Headers ($AUTH + $JSONHD) | ConvertTo-Json -Depth 6
}

function cs-calendar([string]$From, [string]$To, [int]$Limit = 100) {
  if (-not $BASE) { throw "BASE is not set. Run cs-init first." }

  # Build http://localhost:3000/calendar safely
  $ub = [System.UriBuilder]$BASE
  $path = $ub.Path.TrimEnd('/')
  if ($path -eq "") { $path = "/" }
  $ub.Path = ($path.TrimEnd('/') + "/calendar")

  # Build query string safely
  Add-Type -AssemblyName System.Web | Out-Null
  $q = [System.Web.HttpUtility]::ParseQueryString("")
  if ($From)  { $q["from"]  = $From }
  if ($To)    { $q["to"]    = $To }
  if ($Limit) { $q["limit"] = [string]$Limit }

  $ub.Query = $q.ToString()

  $uri = $ub.Uri.AbsoluteUri
  Invoke-RestMethod -Method GET -Uri $uri -Headers $AUTH | ConvertTo-Json -Depth 6
}

function get-titles {
  Invoke-RestMethod -Method GET -Uri "${BASE}/titles" -Headers $AUTH | ConvertTo-Json -Depth 6
}

function cs-unload {
  Get-ChildItem function:cs-* | Remove-Item -Force
  Remove-Variable TOKEN, AUTH -Scope Global -ErrorAction SilentlyContinue
  Write-Host "CineSchedule helpers unloaded."
}

