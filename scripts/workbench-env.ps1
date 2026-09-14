# Workbench 项目级工具链和缓存环境。由启动脚本加载，不修改旧 CLI-Manager 配置。
$env:WORKBENCH_ROOT = "D:\zuhaowan-ai\工作台"
$env:WORKBENCH_REPO_ROOT = $env:WORKBENCH_ROOT
$env:CLI_MANAGER_WORKBENCH_DATA_DIR = Join-Path $env:WORKBENCH_ROOT ".workbench"
$env:RUSTUP_HOME = Join-Path $env:WORKBENCH_ROOT ".tooling\rustup"
$env:CARGO_HOME = Join-Path $env:WORKBENCH_ROOT ".tooling\cargo"
$env:NPM_CONFIG_CACHE = Join-Path $env:WORKBENCH_ROOT ".tooling\npm-cache"
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $env:WORKBENCH_ROOT ".tooling\playwright"
$env:TEMP = Join-Path $env:WORKBENCH_ROOT ".tooling\tmp"
$env:TMP = $env:TEMP
$env:Path = "$env:CARGO_HOME\bin;$env:Path"
