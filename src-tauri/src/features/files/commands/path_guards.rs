use std::path::{Component, Path};

// 按组件比较路径，避免字符串前缀把 sibling 目录误判为祖先目录。
pub(super) fn path_component_matches(
    left: Component<'_>,
    right: Component<'_>,
    ignore_case: bool,
) -> bool {
    if !ignore_case {
        return left == right;
    }
    left.as_os_str().to_string_lossy().to_lowercase()
        == right.as_os_str().to_string_lossy().to_lowercase()
}

pub(super) fn path_starts_with_components(path: &Path, prefix: &Path, ignore_case: bool) -> bool {
    let mut path_components = path.components();
    for prefix_component in prefix.components() {
        let Some(path_component) = path_components.next() else {
            return false;
        };
        if !path_component_matches(path_component, prefix_component, ignore_case) {
            return false;
        }
    }
    true
}

pub(super) fn path_components_equal(left: &Path, right: &Path, ignore_case: bool) -> bool {
    path_starts_with_components(left, right, ignore_case)
        && path_starts_with_components(right, left, ignore_case)
}

// Windows 本地文件系统不区分大小写；WSL UNC 路径仍遵循 Linux 大小写语义。
pub(super) fn move_paths_ignore_case(root: &Path) -> bool {
    #[cfg(windows)]
    {
        let normalized = root
            .to_string_lossy()
            .replace('/', "\\")
            .to_ascii_lowercase();
        let is_wsl_unc = normalized.starts_with("\\\\wsl.localhost\\")
            || normalized.starts_with("\\\\wsl$\\")
            || normalized.starts_with("\\\\?\\unc\\wsl.localhost\\")
            || normalized.starts_with("\\\\?\\unc\\wsl$\\");
        return !is_wsl_unc;
    }
    #[cfg(not(windows))]
    {
        let _ = root;
        false
    }
}
