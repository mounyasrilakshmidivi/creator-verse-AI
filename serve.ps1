# Tiny zero-dependency server for CreatorVerse AI.
#  - serves the static app
#  - POST /api/chat   -> Pollinations text (streaming)
#  - GET  /api/image  -> Pollinations image
# Works with no key (anonymous free tier, hourly limits). For higher limits, create a free key at
# https://enter.pollinations.ai and put POLLINATIONS_KEY=sk_... in a .env file next to this script.
# Usage:  powershell -ExecutionPolicy Bypass -File serve.ps1   (then open http://localhost:5173)
param([int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 5173 }), [switch]$Open)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Web
$root = $PSScriptRoot
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
  '.json' = 'application/json'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.ico' = 'image/x-icon'
}

# .env is re-read on every config request, so creating or editing it needs no server restart.
# Accepts KEY=value, export KEY=value, quotes, # comments and a UTF-8 BOM (Notepad).
# Real environment variables take precedence over .env.
$envFile = Join-Path $root '.env'
function Read-DotEnv {
  $cfg = @{}
  if (-not (Test-Path $envFile -PathType Leaf)) { return $cfg }
  foreach ($line in [IO.File]::ReadAllLines($envFile)) {
    $line = $line.TrimStart([char]0xFEFF)
    if ($line -match '^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$') {
      $name = $Matches[1].ToUpper()   # read before the next -match overwrites $Matches
      $v = $Matches[2]
      if ($v -match '^"(.*)"$' -or $v -match "^'(.*)'$") { $v = $Matches[1] }
      elseif ($v -match '^(.*?)\s+#') { $v = $Matches[1] }
      $cfg[$name] = $v.Trim()
    }
  }
  return $cfg
}
function Get-Setting([string]$name) {
  $v = [Environment]::GetEnvironmentVariable($name)
  if ($v) { return $v }
  return (Read-DotEnv)[$name]
}
$key = Get-Setting 'POLLINATIONS_KEY'

# Explains why accounts are unavailable (never includes the values themselves).
function Get-ConfigProblem([string]$url, [string]$anon) {
  if ($url -and $anon) {
    if ($url -match 'your-project-ref|YOUR-PROJECT-REF' -or $anon -match '^your-') { return 'placeholder' }
    if ($url -notmatch '^https?://[^\s/]+') { return 'invalid_url' }
    return ''
  }
  if (-not (Test-Path $envFile) -and (Test-Path "$envFile.txt")) { return 'env_txt' }
  if (-not (Test-Path $envFile)) { return 'no_env_file' }
  return 'empty'
}

# Only these values are ever sent to the browser. Secrets (service-role key, Razorpay secret,
# Resend key) belong in Supabase Edge Function secrets, not here.
function Get-PublicConfigJson {
  # accept a pasted API endpoint (…/rest/v1/ or …/auth/v1) and keep only the project base URL
  $url = ("$(Get-Setting 'SUPABASE_URL')".Trim() -replace '/(rest|auth|storage|functions)/v1/?.*$', '').TrimEnd('/')
  $anon = "$(Get-Setting 'SUPABASE_ANON_KEY')".Trim()
  $problem = Get-ConfigProblem $url $anon
  $o = [ordered]@{
    supabaseUrl     = $(if ($problem) { '' } else { $url })
    supabaseAnonKey = $(if ($problem) { '' } else { $anon })
    appBaseUrl      = "$(Get-Setting 'APP_BASE_URL')"
    configProblem   = $problem
  }
  return ($o | ConvertTo-Json -Compress)
}

function Send-Json($res, [int]$status, [string]$json) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $res.StatusCode = $status
  $res.ContentType = 'application/json'
  $res.OutputStream.Write($bytes, 0, $bytes.Length)
}

# Forward a request upstream and pipe the response back chunk by chunk (keeps text streaming live)
function Invoke-Upstream($res, [string]$method, [string]$url, [string]$body, [switch]$Cache) {
  try {
    $req = [Net.HttpWebRequest]::Create($url)
    $req.Method = $method
    # The server handles one request at a time, so a stalled upstream must not freeze the site for long
    $req.Timeout = 45000
    $req.ReadWriteTimeout = 45000
    $req.UserAgent = 'creatorverse-ai/1.0'
    if ($key) { $req.Headers.Add('Authorization', "Bearer $key") }
    if ($body) {
      $req.ContentType = 'application/json'
      $bytes = [Text.Encoding]::UTF8.GetBytes($body)
      $req.ContentLength = $bytes.Length
      $out = $req.GetRequestStream(); $out.Write($bytes, 0, $bytes.Length); $out.Close()
    }
    $up = $req.GetResponse()
    $res.ContentType = $up.ContentType
    if ($Cache) { $res.Headers.Add('Cache-Control', 'public, max-age=31536000') }
    $res.SendChunked = $true
    $in = $up.GetResponseStream()
    $buf = New-Object byte[] 8192
    while (($n = $in.Read($buf, 0, $buf.Length)) -gt 0) {
      $res.OutputStream.Write($buf, 0, $n)
      $res.OutputStream.Flush()
    }
    $up.Close()
  } catch [Net.WebException] {
    $status = 502
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    Write-Host "Upstream $status for $method $($url.Substring(0, [Math]::Min(90, $url.Length)))"
    Send-Json $res $status ('{"error":"upstream","status":' + $status + '}')
  }
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
try {
  $listener.Start()
} catch {
  # Port already taken: say whether it's another copy of this site or something else, instead of crashing silently.
  $existing = $null
  try { $existing = Invoke-RestMethod "http://localhost:$Port/api/config" -TimeoutSec 3 } catch {}
  if ($existing -and $null -ne $existing.PSObject.Properties['configProblem']) {
    Write-Host "CreatorVerse AI is ALREADY RUNNING at http://localhost:$Port (another window or process)." -ForegroundColor Yellow
    Write-Host 'Use that one, or close it first. Only one server can use a port.'
    exit 0
  }
  Write-Host "Cannot start: port $Port is in use by another program or reserved by Windows." -ForegroundColor Red
  Write-Host "  Find it:   netstat -ano | findstr :$Port"
  Write-Host "  Or use another port:   set PORT=5174 && start.bat   (then also set APP_BASE_URL and the Supabase redirect URL to that port)"
  Write-Host "Details: $($_.Exception.Message)"
  exit 1
}
$mode = if ($key) { 'using your Pollinations key' } else { 'anonymous free tier' }
Write-Host "CreatorVerse AI running at http://localhost:$Port  ($mode)  Ctrl+C to stop"
$startProblem = (Get-PublicConfigJson | ConvertFrom-Json).configProblem
$problemText = @{
  ''            = 'Accounts: Supabase configured (SUPABASE_URL + SUPABASE_ANON_KEY found).'
  'no_env_file' = "Accounts: NOT configured - create $envFile (copy .env.example) with SUPABASE_URL and SUPABASE_ANON_KEY."
  'env_txt'     = "Accounts: NOT configured - found .env.txt; rename it to .env (Windows hid the .txt extension)."
  'empty'       = 'Accounts: NOT configured - SUPABASE_URL and/or SUPABASE_ANON_KEY are empty in .env.'
  'placeholder' = 'Accounts: NOT configured - .env still contains the example placeholder values.'
  'invalid_url' = 'Accounts: NOT configured - SUPABASE_URL must look like https://your-ref.supabase.co'
}[$startProblem]
Write-Host $problemText
Write-Host '(.env is re-read automatically; no restart needed after editing it.)'
Write-Host 'Keep this window open while you use the site (including when you click email verification links).'
# Open the browser only now that the server is listening, so the first page load can't fail.
if ($Open) { Start-Process "http://localhost:$Port/" }

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $res = $ctx.Response
  try {
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))

    if ($path -eq 'api/chat' -and $ctx.Request.HttpMethod -eq 'POST') {
      $body = (New-Object IO.StreamReader($ctx.Request.InputStream, [Text.Encoding]::UTF8)).ReadToEnd()
      $url = if ($key) { 'https://gen.pollinations.ai/v1/chat/completions' } else { 'https://text.pollinations.ai/openai' }
      Invoke-Upstream $res 'POST' $url $body
    }
    elseif ($path -eq 'api/config') {
      $res.Headers.Add('Cache-Control', 'no-store')
      Send-Json $res 200 (Get-PublicConfigJson)
    }
    elseif ($path -eq 'api/image') {
      $q = [Web.HttpUtility]::ParseQueryString($ctx.Request.Url.Query)
      $prompt = [Uri]::EscapeDataString(($q['prompt'] + '').Substring(0, [Math]::Min(1500, ($q['prompt'] + '').Length)))
      $params = "width=$([int]$q['width'])&height=$([int]$q['height'])&seed=$([long]$q['seed'])&nologo=true"
      $url = if ($key) { "https://gen.pollinations.ai/image/$prompt`?$params" } else { "https://image.pollinations.ai/prompt/$prompt`?$params" }
      Invoke-Upstream $res 'GET' $url $null -Cache
    }
    else {
      if (-not $path) { $path = 'index.html' }
      $file = [IO.Path]::GetFullPath((Join-Path $root $path))
      # never serve dotfiles, tooling folders, server code or tests
      $blocked = $path -match '(^|/)\.' -or $path -match '^(node_modules|supabase|tests|api)/' -or $path -match '\.(ps1|bat|lock|mjs|ts|sql|md)$' -or $path -match '^package(-lock)?\.json$'
      if (-not $blocked -and $file.StartsWith($root) -and (Test-Path $file -PathType Leaf)) {
        $bytes = [IO.File]::ReadAllBytes($file)
        $ext = [IO.Path]::GetExtension($file).ToLower()
        $res.ContentType = if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' }
        $res.Headers.Add('Cache-Control', 'no-cache')
        $res.ContentLength64 = $bytes.Length
        # HEAD (health checks, link previews) gets headers only; writing a body would throw
        if ($ctx.Request.HttpMethod -ne 'HEAD') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
      } else {
        $res.StatusCode = 404
      }
    }
  } catch {
    Write-Host "Request error: $($_.Exception.Message)"
  } finally {
    try { $res.Close() } catch {}
  }
}
