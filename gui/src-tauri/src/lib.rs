mod analysis;
mod setup_updater;

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{ipc::Channel, AppHandle, Manager, State};

const PYTHON_RUNTIME_FLAGS: [&str; 2] = ["-B", "-u"];

#[derive(Serialize)]
struct HealthStatus {
    app: &'static str,
    version: &'static str,
    platform: &'static str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToolRunRequest {
    run_id: String,
    tool_id: String,
    edition: String,
    arguments: Vec<String>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "event", rename_all = "lowercase")]
enum ToolStreamEvent {
    Output {
        #[serde(rename = "runId")]
        run_id: String,
        stream: &'static str,
        chunk: String,
    },
    Analysis {
        #[serde(rename = "runId")]
        run_id: String,
        findings: Vec<analysis::Finding>,
    },
    Exit {
        #[serde(rename = "runId")]
        run_id: String,
        status: &'static str,
        code: Option<i32>,
    },
}

type SharedAnalyzer = Arc<Mutex<Box<dyn analysis::ToolOutputAnalyzer>>>;

#[derive(Clone, Default)]
struct ProcessManager {
    children: Arc<Mutex<HashMap<String, Arc<Mutex<Child>>>>>,
    stop_requested: Arc<Mutex<HashSet<String>>>,
}

fn workspace_root(app: &AppHandle) -> PathBuf {
    if let Ok(resource_dir) = app.path().resource_dir() {
        if resource_dir
            .join("tools")
            .join("ctfbox_launcher.py")
            .is_file()
        {
            return resource_dir;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

fn python_program(root: &Path) -> PathBuf {
    let bundled = root.join("python").join(if cfg!(windows) {
        "python.exe"
    } else {
        "python"
    });
    if bundled.is_file() {
        bundled
    } else {
        PathBuf::from("python")
    }
}

fn build_tool_arguments(request: &ToolRunRequest) -> Result<Vec<String>, String> {
    if request.run_id.trim().is_empty() {
        return Err("运行 ID 不能为空".to_string());
    }
    if request.tool_id != "sqlmap" && request.tool_id != "sstimap" {
        return Err("不支持的工具".to_string());
    }
    if request.edition != "original" && request.edition != "cn" {
        return Err("不支持的工具版本".to_string());
    }
    let mut arguments = vec![request.tool_id.clone()];
    if request.edition == "cn" {
        arguments.push("-cn".to_string());
    }
    arguments.extend(request.arguments.iter().cloned());
    Ok(arguments)
}

fn decode_utf8_stream(pending: &mut Vec<u8>, bytes: &[u8], eof: bool) -> String {
    pending.extend_from_slice(bytes);
    let mut output = String::new();
    loop {
        match std::str::from_utf8(pending) {
            Ok(text) => {
                output.push_str(text);
                pending.clear();
                break;
            }
            Err(error) => {
                let valid = error.valid_up_to();
                if valid > 0 {
                    output.push_str(
                        std::str::from_utf8(&pending[..valid]).expect("validated UTF-8 prefix"),
                    );
                    pending.drain(..valid);
                }
                match error.error_len() {
                    Some(length) => {
                        output.push('\u{fffd}');
                        pending.drain(..length);
                    }
                    None if eof => {
                        output.push_str(&String::from_utf8_lossy(pending));
                        pending.clear();
                        break;
                    }
                    None => break,
                }
            }
        }
    }
    output
}

fn emit_output(
    channel: &Channel<ToolStreamEvent>,
    run_id: &str,
    stream: &'static str,
    chunk: String,
) {
    if chunk.is_empty() {
        return;
    }
    let _ = channel.send(ToolStreamEvent::Output {
        run_id: run_id.to_string(),
        stream,
        chunk,
    });
}

fn analyze_chunk(
    analyzer: &Option<SharedAnalyzer>,
    stream: analysis::StreamKind,
    chunk: &str,
    eof: bool,
) -> Vec<analysis::Finding> {
    analyzer
        .as_ref()
        .and_then(|value| value.lock().ok())
        .map(|mut value| value.push(stream, chunk, eof))
        .unwrap_or_default()
}

fn emit_analysis(
    channel: &Channel<ToolStreamEvent>,
    run_id: &str,
    findings: Vec<analysis::Finding>,
) {
    if findings.is_empty() {
        return;
    }
    let _ = channel.send(ToolStreamEvent::Analysis {
        run_id: run_id.to_string(),
        findings,
    });
}

fn forward_stream<R: Read + Send + 'static>(
    mut reader: R,
    channel: Channel<ToolStreamEvent>,
    run_id: String,
    stream: &'static str,
    stream_kind: analysis::StreamKind,
    analyzer: Option<SharedAnalyzer>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        let mut pending = Vec::new();
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    let chunk = decode_utf8_stream(&mut pending, &buffer[..size], false);
                    emit_output(&channel, &run_id, stream, chunk.clone());
                    let findings = analyze_chunk(&analyzer, stream_kind, &chunk, false);
                    emit_analysis(&channel, &run_id, findings);
                }
                Err(_) => break,
            }
        }
        let chunk = decode_utf8_stream(&mut pending, &[], true);
        emit_output(&channel, &run_id, stream, chunk.clone());
        let findings = analyze_chunk(&analyzer, stream_kind, &chunk, true);
        emit_analysis(&channel, &run_id, findings);
    })
}

fn monitor_process(
    channel: Channel<ToolStreamEvent>,
    manager: ProcessManager,
    run_id: String,
    child: Arc<Mutex<Child>>,
    stream_threads: Vec<thread::JoinHandle<()>>,
) {
    thread::spawn(move || {
        let status = loop {
            let result = child
                .lock()
                .map_err(|_| ())
                .and_then(|mut process| process.try_wait().map_err(|_| ()));
            if let Ok(Some(result)) = result {
                break Some(result);
            }
            if result.is_err() {
                break None;
            }
            thread::sleep(Duration::from_millis(80));
        };
        for stream_thread in stream_threads {
            let _ = stream_thread.join();
        }
        let stopped = manager
            .stop_requested
            .lock()
            .map(|mut set| set.remove(&run_id))
            .unwrap_or(false);
        if let Ok(mut children) = manager.children.lock() {
            children.remove(&run_id);
        }
        let _ = channel.send(ToolStreamEvent::Exit {
            run_id,
            status: if stopped {
                "stopped"
            } else if status.as_ref().is_some_and(|result| result.success()) {
                "completed"
            } else {
                "failed"
            },
            code: status.and_then(|result| result.code()),
        });
    });
}

#[tauri::command]
fn app_health() -> HealthStatus {
    HealthStatus {
        app: "CTFBox",
        version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
    }
}

#[tauri::command]
fn run_tool(
    app: AppHandle,
    manager: State<'_, ProcessManager>,
    request: ToolRunRequest,
    on_event: Channel<ToolStreamEvent>,
) -> Result<(), String> {
    let launcher_arguments = build_tool_arguments(&request)?;
    {
        let children = manager
            .children
            .lock()
            .map_err(|_| "运行状态不可用".to_string())?;
        if children.contains_key(&request.run_id) {
            return Err("该任务已经在运行".to_string());
        }
    }
    let root = workspace_root(&app);
    let launcher = root.join("tools").join("ctfbox_launcher.py");
    if !launcher.is_file() {
        return Err(format!("找不到工具启动器：{}", launcher.display()));
    }
    let python = python_program(&root);
    let mut command = Command::new(python);
    command
        .args(PYTHON_RUNTIME_FLAGS)
        .arg(launcher)
        .args(launcher_arguments)
        .current_dir(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("启动工具失败：{error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法读取工具标准输出".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法读取工具错误输出".to_string())?;
    let child = Arc::new(Mutex::new(child));
    let manager = manager.inner().clone();
    if let Ok(mut children) = manager.children.lock() {
        children.insert(request.run_id.clone(), child.clone());
    }
    let analyzer =
        analysis::analyzer_for(&request.tool_id).map(|value| Arc::new(Mutex::new(value)));
    let stdout_thread = forward_stream(
        stdout,
        on_event.clone(),
        request.run_id.clone(),
        "stdout",
        analysis::StreamKind::Stdout,
        analyzer.clone(),
    );
    let stderr_thread = forward_stream(
        stderr,
        on_event.clone(),
        request.run_id.clone(),
        "stderr",
        analysis::StreamKind::Stderr,
        analyzer,
    );
    monitor_process(
        on_event,
        manager,
        request.run_id,
        child,
        vec![stdout_thread, stderr_thread],
    );
    Ok(())
}

#[tauri::command]
fn send_tool_input(
    manager: State<'_, ProcessManager>,
    run_id: String,
    input: String,
) -> Result<(), String> {
    let children = manager
        .children
        .lock()
        .map_err(|_| "运行状态不可用".to_string())?;
    let child = children
        .get(&run_id)
        .ok_or_else(|| "找不到运行中的任务".to_string())?
        .clone();
    let mut process = child.lock().map_err(|_| "任务状态不可用".to_string())?;
    let stdin = process
        .stdin
        .as_mut()
        .ok_or_else(|| "工具不接受输入".to_string())?;
    stdin
        .write_all(input.as_bytes())
        .map_err(|error| format!("发送输入失败：{error}"))?;
    stdin
        .write_all(b"\n")
        .map_err(|error| format!("发送换行失败：{error}"))?;
    stdin
        .flush()
        .map_err(|error| format!("刷新输入失败：{error}"))
}

#[tauri::command]
fn stop_tool(manager: State<'_, ProcessManager>, run_id: String) -> Result<(), String> {
    let children = manager
        .children
        .lock()
        .map_err(|_| "运行状态不可用".to_string())?;
    let child = children
        .get(&run_id)
        .ok_or_else(|| "找不到运行中的任务".to_string())?
        .clone();
    manager
        .stop_requested
        .lock()
        .map_err(|_| "运行状态不可用".to_string())?
        .insert(run_id);
    let result = child
        .lock()
        .map_err(|_| "任务状态不可用".to_string())?
        .kill()
        .map_err(|error| format!("停止工具失败：{error}"));
    result
}

#[cfg(test)]
mod tests {
    use super::{
        analysis, analyze_chunk, build_tool_arguments, decode_utf8_stream, ToolRunRequest,
        ToolStreamEvent, PYTHON_RUNTIME_FLAGS,
    };
    use crate::analysis::StreamKind;
    use serde_json::json;
    use std::sync::{Arc, Mutex};

    #[test]
    fn disables_python_bytecode_for_bundled_tools() {
        assert_eq!(PYTHON_RUNTIME_FLAGS, ["-B", "-u"]);
    }

    #[test]
    fn builds_original_and_chinese_launcher_arguments() {
        let original = ToolRunRequest {
            run_id: "a".into(),
            tool_id: "sqlmap".into(),
            edition: "original".into(),
            arguments: vec!["-h".into()],
        };
        assert_eq!(
            build_tool_arguments(&original).unwrap(),
            vec!["sqlmap", "-h"]
        );
        let chinese = ToolRunRequest {
            run_id: "b".into(),
            tool_id: "sstimap".into(),
            edition: "cn".into(),
            arguments: vec!["-u".into(), "TARGET".into()],
        };
        assert_eq!(
            build_tool_arguments(&chinese).unwrap(),
            vec!["sstimap", "-cn", "-u", "TARGET"]
        );
    }

    #[test]
    fn rejects_unknown_tool_or_edition() {
        let request = ToolRunRequest {
            run_id: "a".into(),
            tool_id: "shell".into(),
            edition: "original".into(),
            arguments: vec![],
        };
        assert!(build_tool_arguments(&request).is_err());
    }

    #[test]
    fn preserves_utf8_characters_split_across_chunks() {
        let mut pending = Vec::new();
        let bytes = "汉化回显".as_bytes();
        assert_eq!(decode_utf8_stream(&mut pending, &bytes[..2], false), "");
        assert_eq!(
            decode_utf8_stream(&mut pending, &bytes[2..], false),
            "汉化回显"
        );
        assert!(pending.is_empty());
    }

    #[test]
    fn serializes_analysis_events_with_the_existing_tag_protocol() {
        let event = ToolStreamEvent::Analysis {
            run_id: "run-1".into(),
            findings: vec![analysis::Finding {
                kind: "database".into(),
                value: "app".into(),
                database: None,
                table: None,
                detail: None,
            }],
        };

        assert_eq!(
            serde_json::to_value(event).unwrap(),
            json!({
                "event": "analysis",
                "runId": "run-1",
                "findings": [{ "kind": "database", "value": "app" }]
            })
        );
    }

    #[test]
    fn analyzes_chunks_without_consuming_the_output_text() {
        let analyzer = analysis::analyzer_for("sqlmap").map(|value| Arc::new(Mutex::new(value)));
        let output = "available databases [1]:\n[*] app\n";

        let findings = analyze_chunk(&analyzer, StreamKind::Stdout, output, false);

        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].value, "app");
        assert_eq!(output, "available databases [1]:\n[*] app\n");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let setup_updater = setup_updater::SetupUpdater::new().expect("初始化应用更新客户端失败");
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ProcessManager::default())
        .manage(setup_updater)
        .invoke_handler(tauri::generate_handler![
            app_health,
            run_tool,
            send_tool_input,
            stop_tool,
            setup_updater::check_setup_update,
            setup_updater::download_setup_update,
            setup_updater::install_setup_update,
            setup_updater::discard_setup_update
        ])
        .run(tauri::generate_context!())
        .expect("CTFBox 启动失败");
}
