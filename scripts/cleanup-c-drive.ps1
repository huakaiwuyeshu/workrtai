param([switch]$Apply)
$ErrorActionPreference = "SilentlyContinue"
$targets = @(
  "$env:LOCALAPPDATA\npm-cache",
  "$env:USERPROFILE\.npm",
  "$env:USERPROFILE\.cargo",
  "$env:LOCALAPPDATA\ms-playwright",
  "$env:LOCALAPPDATA\Microsoft\Edge\User Data\Default\Cache",
  "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Cache"
)
$tempPatterns = @(
  "$env:LOCALAPPDATA\Temp\MuMu-setup-*.exe",
  "$env:LOCALAPPDATA\Temp\DockerDesktopInstaller.exe",
  "$env:LOCALAPPDATA\Temp\8.5.5-Release*.exe",
  "$env:LOCALAPPDATA\Temp\wsl.*.msi",
  "$env:LOCALAPPDATA\Temp\antigravity-ide-download.exe"
)
if (-not $Apply) { Write-Host "预览模式：不会删除文件。确认无相关安装任务后，使用 -Apply 执行。" -ForegroundColor Yellow }
foreach ($path in $targets) {
  if (Test-Path -LiteralPath $path) {
    $items = Get-ChildItem -LiteralPath $path -Force -Recurse -File
    $bytes = ($items | Measure-Object Length -Sum).Sum
    Write-Host (('{0:N2} GB  {1}' -f ($bytes / 1GB), $path))
    if ($Apply) { Remove-Item -LiteralPath $path -Recurse -Force }
  }
}
foreach ($pattern in $tempPatterns) {
  Get-ChildItem -Path $pattern -File | ForEach-Object {
    Write-Host (('{0:N2} GB  {1}' -f ($_.Length / 1GB), $_.FullName))
    if ($Apply) { Remove-Item -LiteralPath $_.FullName -Force }
  }
}
Write-Host "未处理 Windows\Temp、WinSxS、System32、Program Files、旧 CLI-Manager 数据和回收站。"

