param([switch]$SkipBuild)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$env:CLI_MANAGER_DISTRIBUTION = "standalone"
$env:WORKBENCH_REPO_ROOT = $repo
$env:CLI_MANAGER_WORKBENCH_DATA_DIR = Join-Path $repo ".workbench"
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path $cargoBin) { $env:Path = "$cargoBin;$env:Path" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "未找到 Node.js 22+，请先安装 Node.js。" }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "未找到 npm。" }
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { throw "未找到 Cargo/Rustup。" }
$link = Get-Command link.exe -ErrorAction SilentlyContinue
if (-not $link) {
  $vswhere = "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path $vswhere) {
    $vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
    if ($vs) {
      $vcvars = Join-Path $vs "VC\Auxiliary\Build\vcvars64.bat"
      if (Test-Path $vcvars) { cmd /c "call `"$vcvars`" >nul && set" | ForEach-Object { if ($_ -match "^(.*?)=(.*)$") { Set-Item -Path ("Env:" + $matches[1]) -Value $matches[2] } } }
      $link = Get-Command link.exe -ErrorAction SilentlyContinue
    }
  }
}
if (-not $link) { throw "未找到 MSVC link.exe。请安装 Visual Studio Build Tools 的 Desktop development with C++ 工作负载后重试。" }
if (-not (Test-Path (Join-Path $repo "node_modules"))) { npm install }
if (-not $SkipBuild) { npm run build }
$mcp = Start-Process -FilePath "node" -ArgumentList "orchestrator/bin/workbench-mcp.mjs" -WorkingDirectory $repo -PassThru -WindowStyle Hidden
try {
  npm run tauri dev
} finally {
  if ($mcp -and -not $mcp.HasExited) { Stop-Process -Id $mcp.Id -Force -ErrorAction SilentlyContinue }
}
