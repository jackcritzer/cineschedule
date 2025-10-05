# Start local Docker on port 5432
# Run from repo base:
#  powershell -ExecutionPolicy Bypass -File .\scripts\dev-5432.ps1

Param(
  [string]$ComposeFile = "docker-compose.dev.yml",
  [int]$DbPort = 5432
)

$ErrorActionPreference = "Stop"

# 1) Free 5432 from any non-docker postgres
$procs = (netstat -ano | findstr ":$DbPort") -split "`n" | Where-Object { $_ -match 'LISTENING' }
if ($procs) {
  $pids = $procs | ForEach-Object { ($_ -split '\s+')[-1] } | Select-Object -Unique
  foreach ($p in $pids) {
    try {
      $name = (tasklist /FI "PID eq $pid") -join "`n"
      if ($name -notmatch "com.docker.backend") {
        Write-Host "Killing PID $pid using :$DbPort" -ForegroundColor Yellow
        Stop-Process -Id $p -Force
      }
    } catch {}
  }
}

# 2) Reset DB container & volume
docker compose -f $ComposeFile down -v
docker compose -f $ComposeFile up -d db

# 3) Wait healthy
for ($i=0; $i -lt 30; $i++) {
  $js = docker compose -f $ComposeFile ps --format json | ConvertFrom-Json
  if ($js[0].State -match "healthy") { break }
  Start-Sleep -Seconds 1
}

# 4) Force-set password
docker compose -f $ComposeFile exec -T db psql -U postgres -d postgres -c "ALTER USER postgres WITH PASSWORD 'postgres';"

# 5) TCP sanity
psql "postgresql://postgres:postgres@127.0.0.1:$DbPort/postgres" -c "select 1;"

# 6) Prisma (inline env to avoid overrides)
$Env:DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:$DbPort/cineschedule_dev?schema=public"
$Env:SHADOW_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:$DbPort/cineschedule_dev_shadow?schema=public"
npx prisma generate
npx prisma migrate dev --name init --schema=./prisma/schema.prisma

Write-Host "Dev DB ready on :$DbPort ✅"