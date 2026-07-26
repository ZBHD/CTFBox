use crate::ProcessManager;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const LATEST_RELEASE_API: &str = "https://api.github.com/repos/ZBHD/CTFBox/releases/latest";

#[derive(Clone, Debug, PartialEq, Eq)]
struct SetupUpdate {
    pub current_version: String,
    pub version: String,
    pub date: Option<String>,
    pub body: Option<String>,
    pub download_url: String,
    pub digest: String,
    pub size: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SetupUpdateMetadata {
    update_id: u64,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
}

impl SetupUpdate {
    fn metadata(&self, update_id: u64) -> SetupUpdateMetadata {
        SetupUpdateMetadata {
            update_id,
            current_version: self.current_version.clone(),
            version: self.version.clone(),
            date: self.date.clone(),
            body: self.body.clone(),
        }
    }
}

#[derive(Default)]
struct SetupUpdateSession {
    checked: Option<CheckedSetupUpdate>,
    downloaded: Option<std::path::PathBuf>,
    active_download: Option<ActiveSetupDownload>,
}

struct CheckedSetupUpdate {
    id: u64,
    update: SetupUpdate,
}

struct ActiveSetupDownload {
    id: u64,
    version: String,
    cancelled: Arc<AtomicBool>,
}

pub(crate) struct SetupUpdater {
    client: reqwest::Client,
    next_update_id: AtomicU64,
    session: tokio::sync::Mutex<SetupUpdateSession>,
}

impl SetupUpdater {
    pub(crate) fn new() -> Result<Self, String> {
        Ok(Self {
            client: build_http_client()?,
            next_update_id: AtomicU64::new(1),
            session: tokio::sync::Mutex::new(SetupUpdateSession::default()),
        })
    }

    fn allocate_update_id(&self) -> u64 {
        self.next_update_id.fetch_add(1, Ordering::Relaxed)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "event", content = "data")]
pub(crate) enum SetupDownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
}

impl SetupUpdateSession {
    fn cancel_active_download(&mut self) {
        if let Some(active) = self.active_download.take() {
            active.cancelled.store(true, Ordering::Release);
        }
    }

    fn checked_update_for_session(
        &self,
        update_id: u64,
        version: &str,
    ) -> Result<&SetupUpdate, String> {
        let checked = self
            .checked
            .as_ref()
            .ok_or_else(|| "请先检查可用更新".to_string())?;
        if checked.id != update_id || checked.update.version != version {
            return Err("更新会话已过期，请重新检查".into());
        }
        Ok(&checked.update)
    }

    fn replace_checked_session(
        &mut self,
        checked: Option<(u64, SetupUpdate)>,
    ) -> Option<std::path::PathBuf> {
        self.cancel_active_download();
        self.checked = checked.map(|(id, update)| CheckedSetupUpdate { id, update });
        self.downloaded.take()
    }

    fn begin_download(
        &mut self,
        update_id: u64,
        version: &str,
    ) -> Result<(SetupUpdate, Option<std::path::PathBuf>, Arc<AtomicBool>), String> {
        let update = self.checked_update_for_session(update_id, version)?.clone();
        if self.active_download.is_some() {
            return Err("更新下载已经在进行中".into());
        }
        let cancelled = Arc::new(AtomicBool::new(false));
        self.active_download = Some(ActiveSetupDownload {
            id: update_id,
            version: version.to_string(),
            cancelled: cancelled.clone(),
        });
        Ok((update, self.downloaded.take(), cancelled))
    }

    fn finish_download(
        &mut self,
        update_id: u64,
        version: &str,
        path: std::path::PathBuf,
    ) -> Result<(), String> {
        let matches = self
            .active_download
            .as_ref()
            .is_some_and(|active| active.id == update_id && active.version == version);
        if !matches {
            return Err("更新下载会话已过期".into());
        }
        self.active_download = None;
        self.remember_downloaded(update_id, version, path)
    }

    fn abort_download(&mut self, update_id: u64, version: &str) {
        let matches = self
            .active_download
            .as_ref()
            .is_some_and(|active| active.id == update_id && active.version == version);
        if matches {
            self.cancel_active_download();
        }
    }

    fn remember_downloaded(
        &mut self,
        update_id: u64,
        version: &str,
        path: std::path::PathBuf,
    ) -> Result<(), String> {
        self.checked_update_for_session(update_id, version)?;
        self.downloaded = Some(path);
        Ok(())
    }

    fn downloaded_setup(&self, update_id: u64, version: &str) -> Result<&Path, String> {
        self.checked_update_for_session(update_id, version)?;
        self.downloaded
            .as_deref()
            .ok_or_else(|| "请先下载并校验 Setup".to_string())
    }

    fn discard_session(
        &mut self,
        update_id: u64,
        version: &str,
    ) -> Result<Option<std::path::PathBuf>, String> {
        self.checked_update_for_session(update_id, version)?;
        self.cancel_active_download();
        self.checked = None;
        Ok(self.downloaded.take())
    }
}

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    body: Option<String>,
    published_at: Option<String>,
    draft: bool,
    prerelease: bool,
    assets: Vec<GithubAsset>,
}

#[derive(Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
    digest: Option<String>,
}

fn canonical_setup_name(version: &str) -> String {
    format!("CTFBox-{version}-windows-x64-setup.exe")
}

fn parse_stable_tag(tag: &str) -> Result<Version, String> {
    let raw = tag
        .strip_prefix('v')
        .ok_or_else(|| "最新 Release 标签不是稳定版 SemVer".to_string())?;
    let version =
        Version::parse(raw).map_err(|_| "最新 Release 标签不是稳定版 SemVer".to_string())?;
    if !version.pre.is_empty()
        || !version.build.is_empty()
        || tag != format!("v{}.{}.{}", version.major, version.minor, version.patch)
    {
        return Err("最新 Release 标签不是稳定版 SemVer".into());
    }
    Ok(version)
}

fn parse_sha256_digest(value: Option<&str>) -> Result<String, String> {
    let value = value.ok_or_else(|| "Setup 缺少 GitHub SHA-256 digest".to_string())?;
    let digest = value
        .strip_prefix("sha256:")
        .ok_or_else(|| "Setup 的 GitHub digest 不是 SHA-256".to_string())?;
    if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Setup 的 GitHub SHA-256 digest 格式无效".into());
    }
    Ok(digest.to_ascii_lowercase())
}

fn parse_release_json(payload: &str, current_version: &str) -> Result<Option<SetupUpdate>, String> {
    let release: GithubRelease = serde_json::from_str(payload)
        .map_err(|error| format!("GitHub Release 响应格式无效：{error}"))?;
    if release.draft || release.prerelease {
        return Err("最新 Release 不是稳定正式版本".into());
    }

    let current =
        Version::parse(current_version).map_err(|_| "当前应用版本不是有效的 SemVer".to_string())?;
    let latest = parse_stable_tag(&release.tag_name)?;
    if latest <= current {
        return Ok(None);
    }

    if release.assets.len() != 1 {
        return Err("最新 Release 必须且只能包含一个 Setup".into());
    }
    let asset = &release.assets[0];
    let version = latest.to_string();
    let expected_name = canonical_setup_name(&version);
    if asset.name != expected_name {
        return Err(format!("Setup 名称不符合规范：应为 {expected_name}"));
    }
    if asset.size == 0 {
        return Err("Setup 文件大小无效".into());
    }
    let expected_url =
        format!("https://github.com/ZBHD/CTFBox/releases/download/v{version}/{expected_name}");
    if asset.browser_download_url != expected_url {
        return Err("Setup 下载地址不属于预期的 GitHub Release".into());
    }
    let digest = parse_sha256_digest(asset.digest.as_deref())?;

    Ok(Some(SetupUpdate {
        current_version: current_version.to_string(),
        version,
        date: release.published_at,
        body: release.body,
        download_url: asset.browser_download_url.clone(),
        digest,
        size: asset.size,
    }))
}

#[cfg(test)]
fn sha256_matches(bytes: &[u8], expected: &str) -> bool {
    format!("{:x}", Sha256::digest(bytes)) == expected.to_ascii_lowercase()
}

fn installer_arguments() -> [&'static str; 3] {
    ["/S", "/R", "/UPDATE"]
}

fn build_http_client() -> Result<reqwest::Client, String> {
    build_http_client_with_timeouts(Duration::from_secs(10), Duration::from_secs(30))
}

fn build_http_client_with_timeouts(
    connect_timeout: Duration,
    read_timeout: Duration,
) -> Result<reqwest::Client, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .user_agent(format!("CTFBox/{}", env!("CARGO_PKG_VERSION")))
        .connect_timeout(connect_timeout)
        .read_timeout(read_timeout)
        .build()
        .map_err(|error| format!("创建更新请求客户端失败：{error}"))
}

async fn fetch_setup_update_from_url(
    client: &reqwest::Client,
    url: &str,
    current_version: &str,
) -> Result<Option<SetupUpdate>, String> {
    let payload = client
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|error| format!("检查 GitHub Release 失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("检查 GitHub Release 失败：{error}"))?
        .text()
        .await
        .map_err(|error| format!("读取 GitHub Release 响应失败：{error}"))?;
    parse_release_json(&payload, current_version)
}

async fn verify_setup_file(path: &Path, update: &SetupUpdate) -> Result<(), String> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|error| format!("打开已下载的 Setup 失败：{error}"))?;
    let metadata = file
        .metadata()
        .await
        .map_err(|error| format!("读取 Setup 文件信息失败：{error}"))?;
    if metadata.len() != update.size {
        return Err("Setup 文件大小校验失败，请重新下载".into());
    }

    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .await
            .map_err(|error| format!("读取 Setup 文件失败：{error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    if format!("{:x}", hasher.finalize()) != update.digest {
        return Err("Setup SHA-256 校验失败，请重新下载".into());
    }
    Ok(())
}

async fn download_setup_to_path<C, F>(
    client: &reqwest::Client,
    update: &SetupUpdate,
    destination: &Path,
    is_cancelled: C,
    mut on_progress: F,
) -> Result<(), String>
where
    C: Fn() -> bool,
    F: FnMut(u64, Option<u64>),
{
    if is_cancelled() {
        return Err("Setup 下载已取消".into());
    }
    let parent = destination
        .parent()
        .ok_or_else(|| "Setup 下载目录无效".to_string())?;
    let temporary = destination.with_extension("exe.download");
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|error| format!("创建更新目录失败：{error}"))?;
    let _ = tokio::fs::remove_file(&temporary).await;
    let _ = tokio::fs::remove_file(destination).await;

    let download = async {
        if is_cancelled() {
            return Err("Setup 下载已取消".into());
        }
        let mut response = client
            .get(&update.download_url)
            .send()
            .await
            .map_err(|error| format!("下载 Setup 失败：{error}"))?
            .error_for_status()
            .map_err(|error| format!("下载 Setup 失败：{error}"))?;
        if let Some(content_length) = response.content_length() {
            if content_length != update.size {
                return Err(format!(
                    "Setup 响应大小与 Release 资产不一致：预期 {} 字节，实际 {} 字节",
                    update.size, content_length
                ));
            }
        }

        let mut file = tokio::fs::File::create(&temporary)
            .await
            .map_err(|error| format!("创建 Setup 临时文件失败：{error}"))?;
        let mut hasher = Sha256::new();
        let mut downloaded = 0_u64;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| format!("读取 Setup 下载数据失败：{error}"))?
        {
            if is_cancelled() {
                return Err("Setup 下载已取消".into());
            }
            downloaded = downloaded
                .checked_add(chunk.len() as u64)
                .ok_or_else(|| "Setup 文件大小溢出".to_string())?;
            if downloaded > update.size {
                return Err(format!(
                    "Setup 实际大小超过 Release 资产：预期 {} 字节",
                    update.size
                ));
            }
            file.write_all(&chunk)
                .await
                .map_err(|error| format!("写入 Setup 临时文件失败：{error}"))?;
            hasher.update(&chunk);
            on_progress(chunk.len() as u64, Some(update.size));
        }
        file.flush()
            .await
            .map_err(|error| format!("刷新 Setup 临时文件失败：{error}"))?;
        file.sync_all()
            .await
            .map_err(|error| format!("同步 Setup 临时文件失败：{error}"))?;
        drop(file);

        if downloaded != update.size {
            return Err(format!(
                "Setup 实际大小与 Release 资产不一致：预期 {} 字节，实际 {} 字节",
                update.size, downloaded
            ));
        }
        let actual_digest = format!("{:x}", hasher.finalize());
        if actual_digest != update.digest {
            return Err("Setup SHA-256 校验失败，文件可能已损坏或被篡改".into());
        }
        if is_cancelled() {
            return Err("Setup 下载已取消".into());
        }

        tokio::fs::rename(&temporary, destination)
            .await
            .map_err(|error| format!("保存已验证的 Setup 失败：{error}"))
    }
    .await;

    if download.is_err() {
        let _ = tokio::fs::remove_file(&temporary).await;
        let _ = tokio::fs::remove_file(destination).await;
    }
    download
}

#[tauri::command]
pub(crate) async fn check_setup_update(
    updater: State<'_, SetupUpdater>,
) -> Result<Option<SetupUpdateMetadata>, String> {
    let update = fetch_setup_update_from_url(
        &updater.client,
        LATEST_RELEASE_API,
        env!("CARGO_PKG_VERSION"),
    )
    .await?;
    let (metadata, checked) = match update {
        Some(update) => {
            let update_id = updater.allocate_update_id();
            (Some(update.metadata(update_id)), Some((update_id, update)))
        }
        None => (None, None),
    };
    let stale_setup = updater
        .session
        .lock()
        .await
        .replace_checked_session(checked);
    if let Some(path) = stale_setup {
        let _ = tokio::fs::remove_file(path).await;
    }
    Ok(metadata)
}

#[tauri::command]
pub(crate) async fn download_setup_update(
    app: AppHandle,
    updater: State<'_, SetupUpdater>,
    update_id: u64,
    version: String,
    on_event: Channel<SetupDownloadEvent>,
) -> Result<(), String> {
    let update_directory = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("确定更新目录失败：{error}"))?
        .join("updates");
    let destination = update_directory.join(canonical_setup_name(&version));
    let (update, stale_setup, cancelled) = updater
        .session
        .lock()
        .await
        .begin_download(update_id, &version)?;
    if let Some(stale_setup) = stale_setup {
        let _ = tokio::fs::remove_file(stale_setup).await;
    }

    if let Err(error) = on_event
        .send(SetupDownloadEvent::Started {
            content_length: Some(update.size),
        })
        .map_err(|error| format!("发送更新下载状态失败：{error}"))
    {
        updater
            .session
            .lock()
            .await
            .abort_download(update_id, &version);
        return Err(error);
    }
    let download = download_setup_to_path(
        &updater.client,
        &update,
        &destination,
        || cancelled.load(Ordering::Acquire),
        |chunk, _total| {
            let _ = on_event.send(SetupDownloadEvent::Progress {
                chunk_length: chunk as usize,
            });
        },
    )
    .await;
    if let Err(error) = download {
        updater
            .session
            .lock()
            .await
            .abort_download(update_id, &version);
        return Err(error);
    }
    if let Err(error) =
        updater
            .session
            .lock()
            .await
            .finish_download(update_id, &version, destination.clone())
    {
        let _ = tokio::fs::remove_file(destination).await;
        return Err(error);
    }
    on_event
        .send(SetupDownloadEvent::Finished)
        .map_err(|error| format!("发送更新完成状态失败：{error}"))
}

#[cfg(windows)]
fn launch_setup(path: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    std::process::Command::new(path)
        .args(installer_arguments())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("启动 Setup 失败：{error}"))
}

#[cfg(not(windows))]
fn launch_setup(_path: &Path) -> Result<(), String> {
    Err("应用内更新当前仅支持 Windows".into())
}

#[tauri::command]
pub(crate) async fn install_setup_update(
    updater: State<'_, SetupUpdater>,
    manager: State<'_, ProcessManager>,
    update_id: u64,
    version: String,
) -> Result<(), String> {
    let (update, setup_path) = {
        let session = updater.session.lock().await;
        (
            session
                .checked_update_for_session(update_id, &version)?
                .clone(),
            session.downloaded_setup(update_id, &version)?.to_path_buf(),
        )
    };
    verify_setup_file(&setup_path, &update).await?;
    {
        let session = updater.session.lock().await;
        session.checked_update_for_session(update_id, &version)?;
        if session.downloaded_setup(update_id, &version)?.to_path_buf() != setup_path {
            return Err("已下载的 Setup 会话已变化，请重新下载".into());
        }
    }
    launch_setup(&setup_path)?;
    manager.terminate_all();
    std::process::exit(0);
}

#[tauri::command]
pub(crate) async fn discard_setup_update(
    updater: State<'_, SetupUpdater>,
    update_id: u64,
    version: String,
) -> Result<(), String> {
    let setup_path = updater
        .session
        .lock()
        .await
        .discard_session(update_id, &version)?;
    if let Some(path) = setup_path {
        let _ = tokio::fs::remove_file(path).await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        path::PathBuf,
        thread,
        time::{Duration, Instant},
    };

    use sha2::{Digest, Sha256};
    use tempfile::tempdir;

    use super::{
        build_http_client, build_http_client_with_timeouts, download_setup_to_path,
        fetch_setup_update_from_url, installer_arguments, parse_release_json, sha256_matches,
        verify_setup_file, SetupUpdate, SetupUpdateSession,
    };

    fn release_json(version: &str, assets: &str) -> String {
        format!(
            r#"{{
                "tag_name": "v{version}",
                "name": "CTFBox v{version}",
                "body": "修复更新流程",
                "published_at": "2026-07-25T15:00:00Z",
                "draft": false,
                "prerelease": false,
                "assets": [{assets}]
            }}"#,
        )
    }

    fn setup_asset(version: &str, digest: &str) -> String {
        format!(
            r#"{{
                "name": "CTFBox-{version}-windows-x64-setup.exe",
                "browser_download_url": "https://github.com/ZBHD/CTFBox/releases/download/v{version}/CTFBox-{version}-windows-x64-setup.exe",
                "size": 1024,
                "digest": "{digest}"
            }}"#,
        )
    }

    fn serve_once(body: Vec<u8>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 4096];
            let _ = stream.read(&mut request);
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len(),
            )
            .unwrap();
            stream.write_all(&body).unwrap();
        });
        format!("http://{address}/setup.exe")
    }

    fn serve_stalled_response(delay: Duration) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 4096];
            let _ = stream.read(&mut request);
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: 64\r\nConnection: close\r\n\r\n"
            )
            .unwrap();
            stream.flush().unwrap();
            thread::sleep(delay);
        });
        format!("http://{address}/release")
    }

    fn downloadable_update(url: String, body: &[u8], digest: String) -> SetupUpdate {
        SetupUpdate {
            current_version: "0.1.2".into(),
            version: "0.1.3".into(),
            date: None,
            body: None,
            download_url: url,
            digest,
            size: body.len() as u64,
        }
    }

    #[test]
    fn accepts_a_newer_stable_release_with_one_canonical_setup() {
        let digest = format!("sha256:{}", "ab".repeat(32));
        let release = release_json("0.1.3", &setup_asset("0.1.3", &digest));

        let update = parse_release_json(&release, "0.1.2")
            .expect("release should be valid")
            .expect("newer release should be available");

        assert_eq!(update.current_version, "0.1.2");
        assert_eq!(update.version, "0.1.3");
        assert_eq!(update.digest, "ab".repeat(32));
        assert_eq!(update.size, 1024);
        assert_eq!(update.body.as_deref(), Some("修复更新流程"));
    }

    #[test]
    fn treats_equal_or_older_stable_releases_as_current() {
        for version in ["0.1.2", "0.1.1"] {
            let digest = format!("sha256:{}", "ab".repeat(32));
            let release = release_json(version, &setup_asset(version, &digest));
            assert!(parse_release_json(&release, "0.1.2").unwrap().is_none());
        }
    }

    #[test]
    fn rejects_draft_prerelease_or_non_semver_tags() {
        let digest = format!("sha256:{}", "ab".repeat(32));
        let asset = setup_asset("0.1.3", &digest);

        let draft = release_json("0.1.3", &asset).replace("\"draft\": false", "\"draft\": true");
        assert!(parse_release_json(&draft, "0.1.2").is_err());

        let prerelease =
            release_json("0.1.3", &asset).replace("\"prerelease\": false", "\"prerelease\": true");
        assert!(parse_release_json(&prerelease, "0.1.2").is_err());

        let invalid = release_json("next", &setup_asset("next", &digest));
        assert!(parse_release_json(&invalid, "0.1.2").is_err());
    }

    #[test]
    fn rejects_missing_extra_or_misnamed_assets() {
        let digest = format!("sha256:{}", "ab".repeat(32));
        let canonical = setup_asset("0.1.3", &digest);
        let extra = format!(
            "{canonical}, {{\"name\":\"latest.json\",\"browser_download_url\":\"https://example.invalid/latest.json\",\"size\":1,\"digest\":\"sha256:{}\"}}",
            "cd".repeat(32),
        );

        assert!(parse_release_json(&release_json("0.1.3", ""), "0.1.2").is_err());
        assert!(parse_release_json(&release_json("0.1.3", &extra), "0.1.2").is_err());

        let misnamed = canonical.replace("windows-x64-setup.exe", "x64-setup.exe");
        assert!(parse_release_json(&release_json("0.1.3", &misnamed), "0.1.2").is_err());
    }

    #[test]
    fn rejects_missing_or_malformed_github_digests() {
        for digest in [
            "",
            "sha256:1234",
            "md5:001122",
            "sha256:zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
        ] {
            let release = release_json("0.1.3", &setup_asset("0.1.3", digest));
            assert!(
                parse_release_json(&release, "0.1.2").is_err(),
                "accepted {digest}"
            );
        }
    }

    #[test]
    fn verifies_downloaded_bytes_against_the_expected_sha256() {
        assert!(sha256_matches(
            b"ctfbox",
            "23ca1dfc39d5822045f39d619b3917f6e692a4e3665a663f16434075602d36bf",
        ));
        assert!(!sha256_matches(b"tampered", &"00".repeat(32)));
    }

    #[test]
    fn launches_nsis_in_quiet_update_mode() {
        assert_eq!(installer_arguments(), ["/S", "/R", "/UPDATE"]);
    }

    #[test]
    fn exposes_only_display_metadata_to_the_frontend() {
        let update = downloadable_update(
            "https://example.invalid/setup.exe".into(),
            b"setup",
            "ab".repeat(32),
        );

        let metadata = serde_json::to_value(update.metadata(17)).unwrap();

        assert_eq!(metadata["updateId"], 17);
        assert_eq!(metadata["currentVersion"], "0.1.2");
        assert_eq!(metadata["version"], "0.1.3");
        assert!(metadata.get("downloadUrl").is_none());
        assert!(metadata.get("digest").is_none());
        assert!(metadata.get("size").is_none());
    }

    #[test]
    fn binds_checked_and_downloaded_setups_to_one_version() {
        let update = downloadable_update(
            "https://example.invalid/setup.exe".into(),
            b"setup",
            "ab".repeat(32),
        );
        let mut session = SetupUpdateSession::default();
        let setup_path = PathBuf::from("CTFBox-0.1.3-windows-x64-setup.exe");

        assert!(session.checked_update_for_session(17, "0.1.3").is_err());
        assert!(session
            .replace_checked_session(Some((17, update)))
            .is_none());
        assert_eq!(
            session
                .checked_update_for_session(17, "0.1.3")
                .unwrap()
                .version,
            "0.1.3"
        );
        assert!(session.checked_update_for_session(17, "0.1.4").is_err());

        session
            .remember_downloaded(17, "0.1.3", setup_path.clone())
            .unwrap();
        assert_eq!(session.downloaded_setup(17, "0.1.3").unwrap(), &setup_path);
        assert!(session.downloaded_setup(17, "0.1.4").is_err());
        assert!(session.discard_session(17, "0.1.4").is_err());
        assert_eq!(
            session.discard_session(17, "0.1.3").unwrap(),
            Some(setup_path)
        );
        assert!(session.checked_update_for_session(17, "0.1.3").is_err());
    }

    #[test]
    fn rechecking_replaces_the_session_and_returns_the_old_setup_for_cleanup() {
        let update = downloadable_update(
            "https://example.invalid/setup.exe".into(),
            b"setup",
            "ab".repeat(32),
        );
        let mut session = SetupUpdateSession::default();
        let setup_path = PathBuf::from("old-setup.exe");
        session.replace_checked_session(Some((17, update)));
        session
            .remember_downloaded(17, "0.1.3", setup_path.clone())
            .unwrap();

        let stale = session.replace_checked_session(None);

        assert_eq!(stale, Some(setup_path));
        assert!(session.checked_update_for_session(17, "0.1.3").is_err());
    }

    #[test]
    fn rejects_cleanup_from_an_obsolete_check_session() {
        let update = downloadable_update(
            "https://example.invalid/setup.exe".into(),
            b"setup",
            "ab".repeat(32),
        );
        let mut session = SetupUpdateSession::default();
        session.replace_checked_session(Some((1, update.clone())));
        session.replace_checked_session(Some((2, update)));

        assert!(session.discard_session(1, "0.1.3").is_err());
        assert_eq!(
            session
                .checked_update_for_session(2, "0.1.3")
                .unwrap()
                .version,
            "0.1.3",
        );
    }

    #[test]
    fn cancels_an_active_download_when_the_checked_session_is_replaced() {
        let update = downloadable_update(
            "https://example.invalid/setup.exe".into(),
            b"setup",
            "ab".repeat(32),
        );
        let mut session = SetupUpdateSession::default();
        session.replace_checked_session(Some((17, update.clone())));

        let (_started, _stale, cancelled) = session.begin_download(17, "0.1.3").unwrap();
        assert!(session.begin_download(17, "0.1.3").is_err());
        session.replace_checked_session(Some((18, update)));

        assert!(cancelled.load(std::sync::atomic::Ordering::Acquire));
        assert!(session
            .finish_download(
                17,
                "0.1.3",
                PathBuf::from("CTFBox-0.1.3-windows-x64-setup.exe"),
            )
            .is_err());
    }

    #[tokio::test]
    async fn fetches_and_parses_the_latest_release_response() {
        let digest = format!("sha256:{}", "ab".repeat(32));
        let release = release_json("0.1.3", &setup_asset("0.1.3", &digest));

        let update = fetch_setup_update_from_url(
            &build_http_client().unwrap(),
            &serve_once(release.into_bytes()),
            "0.1.2",
        )
        .await
        .unwrap()
        .unwrap();

        assert_eq!(update.version, "0.1.3");
    }

    #[tokio::test]
    async fn times_out_when_a_release_response_stalls() {
        let client =
            build_http_client_with_timeouts(Duration::from_millis(50), Duration::from_millis(50))
                .unwrap();
        let started = Instant::now();

        let error = fetch_setup_update_from_url(
            &client,
            &serve_stalled_response(Duration::from_millis(250)),
            "0.1.2",
        )
        .await
        .unwrap_err();

        assert!(error.contains("GitHub Release"));
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[tokio::test]
    async fn revalidates_the_setup_before_installation() {
        let body = b"verified setup bytes";
        let digest = format!("{:x}", Sha256::digest(body));
        let update = downloadable_update("https://example.invalid/setup.exe".into(), body, digest);
        let directory = tempdir().unwrap();
        let setup_path = directory.path().join("setup.exe");
        std::fs::write(&setup_path, body).unwrap();
        verify_setup_file(&setup_path, &update).await.unwrap();

        std::fs::write(&setup_path, b"tampered setup bytes").unwrap();
        let error = verify_setup_file(&setup_path, &update).await.unwrap_err();
        assert!(error.contains("SHA-256"));
    }

    #[tokio::test]
    async fn downloads_setup_atomically_and_reports_progress() {
        let body = b"verified setup bytes".to_vec();
        let digest = format!("{:x}", Sha256::digest(&body));
        let update = downloadable_update(serve_once(body.clone()), &body, digest);
        let directory = tempdir().unwrap();
        let destination = directory.path().join("CTFBox-0.1.3-windows-x64-setup.exe");
        let mut downloaded = 0_u64;
        let mut totals = Vec::new();

        download_setup_to_path(
            &build_http_client().unwrap(),
            &update,
            &destination,
            || false,
            |chunk, total| {
                downloaded += chunk;
                totals.push(total);
            },
        )
        .await
        .expect("download should succeed");

        assert_eq!(std::fs::read(&destination).unwrap(), body);
        assert_eq!(downloaded, update.size);
        assert!(totals.iter().all(|total| *total == Some(update.size)));
        assert!(!destination.with_extension("exe.download").exists());
    }

    #[tokio::test]
    async fn rejects_tampered_download_without_leaving_an_installable_file() {
        let expected = b"expected setup bytes";
        let downloaded = b"tampered setup bytes".to_vec();
        let digest = format!("{:x}", Sha256::digest(expected));
        let mut update = downloadable_update(serve_once(downloaded.clone()), expected, digest);
        update.size = downloaded.len() as u64;
        let directory = tempdir().unwrap();
        let destination = directory.path().join("CTFBox-0.1.3-windows-x64-setup.exe");

        let error = download_setup_to_path(
            &build_http_client().unwrap(),
            &update,
            &destination,
            || false,
            |_chunk, _total| {},
        )
        .await
        .unwrap_err();

        assert!(error.contains("SHA-256"));
        assert!(!destination.exists());
        assert!(!destination.with_extension("exe.download").exists());
    }

    #[tokio::test]
    async fn rejects_a_download_whose_size_differs_from_the_release_asset() {
        let body = b"complete setup bytes".to_vec();
        let digest = format!("{:x}", Sha256::digest(&body));
        let mut update = downloadable_update(serve_once(body.clone()), &body, digest);
        update.size += 1;
        let directory = tempdir().unwrap();
        let destination = directory.path().join("CTFBox-0.1.3-windows-x64-setup.exe");

        let error = download_setup_to_path(
            &build_http_client().unwrap(),
            &update,
            &destination,
            || false,
            |_chunk, _total| {},
        )
        .await
        .unwrap_err();

        assert!(error.contains("大小"));
        assert!(!destination.exists());
        assert!(!destination.with_extension("exe.download").exists());
    }

    #[tokio::test]
    async fn cancels_a_download_before_network_or_file_work() {
        let body = b"setup bytes";
        let digest = format!("{:x}", Sha256::digest(body));
        let update = downloadable_update("http://127.0.0.1:1/setup.exe".into(), body, digest);
        let directory = tempdir().unwrap();
        let destination = directory.path().join("CTFBox-0.1.3-windows-x64-setup.exe");

        let error = download_setup_to_path(
            &build_http_client().unwrap(),
            &update,
            &destination,
            || true,
            |_chunk, _total| {},
        )
        .await
        .unwrap_err();

        assert!(error.contains("取消"));
        assert!(!destination.exists());
        assert!(!destination.with_extension("exe.download").exists());
    }
}
