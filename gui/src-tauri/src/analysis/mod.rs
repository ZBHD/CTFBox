use serde::Serialize;

pub mod dirsearch;
pub mod nuclei;
pub mod sqlmap;
pub mod sstimap;
pub mod subfinder;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamKind {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub kind: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub database: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

pub trait ToolOutputAnalyzer: Send {
    fn push(&mut self, stream: StreamKind, chunk: &str, eof: bool) -> Vec<Finding>;
}

pub fn analyzer_for(tool_id: &str, arguments: &[String]) -> Option<Box<dyn ToolOutputAnalyzer>> {
    match tool_id {
        "sqlmap" => Some(Box::new(sqlmap::SqlmapAnalyzer::new(arguments))),
        "sstimap" => Some(Box::new(sstimap::SstimapAnalyzer::default())),
        "dirsearch" => Some(Box::new(dirsearch::DirsearchAnalyzer::default())),
        "subfinder" => Some(Box::new(subfinder::SubfinderAnalyzer::default())),
        "nuclei" => Some(Box::new(nuclei::NucleiAnalyzer::default())),
        _ => None,
    }
}

#[derive(Default)]
pub struct LineBuffers {
    stdout: String,
    stderr: String,
}

impl LineBuffers {
    pub fn push(&mut self, stream: StreamKind, chunk: &str, eof: bool) -> Vec<String> {
        let buffer = match stream {
            StreamKind::Stdout => &mut self.stdout,
            StreamKind::Stderr => &mut self.stderr,
        };
        buffer.push_str(chunk);

        let mut lines = Vec::new();
        while let Some(index) = buffer.find('\n') {
            let raw = buffer[..index].trim_end_matches('\r').to_string();
            buffer.drain(..=index);
            lines.push(strip_ansi(&raw));
        }
        if eof && !buffer.is_empty() {
            let raw = std::mem::take(buffer);
            lines.push(strip_ansi(raw.trim_end_matches('\r')));
        }
        lines
    }
}

fn strip_ansi(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut characters = value.chars();
    while let Some(character) = characters.next() {
        if character != '\u{1b}' {
            result.push(character);
            continue;
        }
        if characters.next() != Some('[') {
            continue;
        }
        for control in characters.by_ref() {
            if ('@'..='~').contains(&control) {
                break;
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::{analyzer_for, LineBuffers, StreamKind};

    #[test]
    fn buffers_streams_independently_and_flushes_final_lines() {
        let mut lines = LineBuffers::default();

        assert!(lines
            .push(StreamKind::Stdout, "Database: ma", false)
            .is_empty());
        assert_eq!(
            lines.push(StreamKind::Stderr, "warning\n", false),
            vec!["warning"]
        );
        assert_eq!(
            lines.push(StreamKind::Stdout, "in\nunterminated", true),
            vec!["Database: main", "unterminated"]
        );
    }

    #[test]
    fn strips_ansi_csi_sequences_after_reassembling_lines() {
        let mut lines = LineBuffers::default();

        assert_eq!(
            lines.push(StreamKind::Stdout, "\x1b[92mok\x1b[0m\r\n", false),
            vec!["ok"]
        );
    }

    #[test]
    fn registry_returns_only_supported_analyzers() {
        assert!(analyzer_for("sqlmap", &[]).is_some());
        assert!(analyzer_for("sstimap", &[]).is_some());
        assert!(analyzer_for("dirsearch", &[]).is_some());
        assert!(analyzer_for("subfinder", &[]).is_some());
        assert!(analyzer_for("nuclei", &[]).is_some());
        // webshell 使用会话协议，不走行解析器。
        assert!(analyzer_for("webshell", &[]).is_none());
        assert!(analyzer_for("crypto", &[]).is_none());
    }
}
