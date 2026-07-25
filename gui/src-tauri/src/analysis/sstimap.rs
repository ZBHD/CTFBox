use super::{Finding, LineBuffers, StreamKind, ToolOutputAnalyzer};

#[derive(Default)]
pub struct SstimapAnalyzer {
    lines: LineBuffers,
    stdout: SummaryState,
    stderr: SummaryState,
}

#[derive(Default)]
struct SummaryState {
    summary_active: bool,
    capabilities_active: bool,
}

impl ToolOutputAnalyzer for SstimapAnalyzer {
    fn push(&mut self, stream: StreamKind, chunk: &str, eof: bool) -> Vec<Finding> {
        let lines = self.lines.push(stream, chunk, eof);
        let state = match stream {
            StreamKind::Stdout => &mut self.stdout,
            StreamKind::Stderr => &mut self.stderr,
        };
        lines
            .into_iter()
            .flat_map(|line| state.process_line(&line))
            .collect()
    }
}

impl SummaryState {
    fn process_line(&mut self, line: &str) -> Vec<Finding> {
        let trimmed = line.trim();
        if trimmed.contains("SSTImap identified the following injection point:")
            || trimmed.contains("SSTImap 识别到以下注入点：")
        {
            self.summary_active = true;
            self.capabilities_active = false;
            return Vec::new();
        }
        if !self.summary_active || trimmed.is_empty() {
            return Vec::new();
        }

        if let Some((location, value)) = injection_point(trimmed) {
            return vec![detailed_finding("injection-point", value, location)];
        }
        if let Some(value) = label_value(trimmed, &["Engine:", "模板引擎：", "模板引擎:"])
        {
            return vec![finding("engine", value)];
        }
        if let Some(value) = label_value(trimmed, &["OS:", "操作系统：", "操作系统:"]) {
            return vec![finding("os", value)];
        }
        if let Some(value) = label_value(trimmed, &["Technique:", "检测技术：", "检测技术:"])
        {
            return normalize_technique(value)
                .map(|normalized| detailed_finding("technique", normalized, value))
                .into_iter()
                .collect();
        }
        if trimmed == "Capabilities:" || trimmed == "可用能力：" || trimmed == "可用能力:"
        {
            self.capabilities_active = true;
            return Vec::new();
        }
        if self.capabilities_active && line.starts_with("    ") {
            return supported_capability(trimmed)
                .map(|value| finding("capability", value))
                .into_iter()
                .collect();
        }

        if !line.starts_with(char::is_whitespace) {
            self.summary_active = false;
            self.capabilities_active = false;
        }
        Vec::new()
    }
}

fn injection_point(line: &str) -> Option<(&str, &str)> {
    const LABELS: [(&str, &str); 8] = [
        ("Query parameter:", "Query"),
        ("Body parameter:", "Body"),
        ("Header parameter:", "Header"),
        ("Cookie parameter:", "Cookie"),
        ("查询字符串参数：", "查询字符串"),
        ("请求正文参数：", "请求正文"),
        ("请求头参数：", "请求头"),
        ("Cookie参数：", "Cookie"),
    ];
    LABELS.iter().find_map(|(prefix, location)| {
        line.strip_prefix(prefix)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| (*location, value))
    })
}

fn label_value<'a>(line: &'a str, prefixes: &[&str]) -> Option<&'a str> {
    prefixes
        .iter()
        .find_map(|prefix| line.strip_prefix(prefix))
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn normalize_technique(value: &str) -> Option<&'static str> {
    match value.to_ascii_lowercase().as_str() {
        "rendered" | "render" => Some("R"),
        "error-based" => Some("E"),
        "boolean-based" | "boolean error-based blind" => Some("B"),
        "time-based" | "time-based blind" => Some("T"),
        _ => match value {
            "渲染回显" => Some("R"),
            "报错型" => Some("E"),
            "布尔型盲注" | "布尔报错型盲注" => Some("B"),
            "时间型盲注" => Some("T"),
            _ => None,
        },
    }
}

fn supported_capability(line: &str) -> Option<&str> {
    let (name, status) = line.split_once(':').or_else(|| line.split_once('：'))?;
    let status = status.trim();
    (status.starts_with("ok") || status.starts_with("支持"))
        .then_some(name.trim())
        .filter(|name| !name.is_empty())
}

fn finding(kind: &str, value: &str) -> Finding {
    Finding {
        kind: kind.to_string(),
        value: value.to_string(),
        database: None,
        table: None,
        detail: None,
    }
}

fn detailed_finding(kind: &str, value: &str, detail: &str) -> Finding {
    Finding {
        detail: Some(detail.to_string()),
        ..finding(kind, value)
    }
}

#[cfg(test)]
mod tests {
    use super::SstimapAnalyzer;
    use crate::analysis::{Finding, StreamKind, ToolOutputAnalyzer};

    fn finding(kind: &str, value: &str) -> Finding {
        Finding {
            kind: kind.to_string(),
            value: value.to_string(),
            database: None,
            table: None,
            detail: None,
        }
    }

    fn detailed(kind: &str, value: &str, detail: &str) -> Finding {
        Finding {
            detail: Some(detail.to_string()),
            ..finding(kind, value)
        }
    }

    fn feed_in_chunks(output: &str, chunk_size: usize) -> Vec<Finding> {
        let mut analyzer = SstimapAnalyzer::default();
        let mut findings = Vec::new();
        let mut start = 0;
        while start < output.len() {
            let mut end = (start + chunk_size).min(output.len());
            while !output.is_char_boundary(end) {
                end -= 1;
            }
            findings.extend(analyzer.push(StreamKind::Stdout, &output[start..end], false));
            start = end;
        }
        findings.extend(analyzer.push(StreamKind::Stdout, "", true));
        findings
    }

    #[test]
    fn extracts_original_summary_and_supported_capabilities() {
        let output = concat!(
            "SSTImap identified the following injection point:\n",
            "\n",
            "  Query parameter: name\n",
            "  Engine: Jinja2\n",
            "  Injection: {{*}}\n",
            "  Context: text\n",
            "  OS: posix-linux\n",
            "  Technique: rendered\n",
            "  Capabilities:\n",
            "\n",
            "    Shell command execution: \x1b[92mok\x1b[0m\n",
            "    Bind and reverse shell: no\n",
            "    File read: no\n",
        );

        let findings = feed_in_chunks(output, 13);

        assert!(findings.contains(&detailed("injection-point", "name", "Query")));
        assert!(findings.contains(&finding("engine", "Jinja2")));
        assert!(findings.contains(&finding("os", "posix-linux")));
        assert!(findings.contains(&detailed("technique", "R", "rendered")));
        assert!(findings.contains(&finding("capability", "Shell command execution")));
        assert!(!findings
            .iter()
            .any(|item| item.kind == "capability" && item.value == "File read"));
    }

    #[test]
    fn extracts_chinese_summary_and_normalizes_technique() {
        let output = concat!(
            "SSTImap 识别到以下注入点：\n",
            "\n",
            "  查询字符串参数：name\n",
            "  模板引擎：Jinja2\n",
            "  操作系统：posix-linux\n",
            "  检测技术：时间型盲注\n",
            "  可用能力：\n",
            "\n",
            "    文件写入：支持（盲注）\n",
            "    文件读取：不支持\n",
        );

        let findings = feed_in_chunks(output, 11);

        assert!(findings.contains(&detailed("injection-point", "name", "查询字符串")));
        assert!(findings.contains(&detailed("technique", "T", "时间型盲注")));
        assert!(findings.contains(&finding("capability", "文件写入")));
        assert!(!findings
            .iter()
            .any(|item| item.kind == "capability" && item.value == "文件读取"));
    }

    #[test]
    fn ignores_summary_labels_before_identification_heading() {
        let findings = feed_in_chunks(
            "Engine: Jinja2\nTechnique: rendered\nShell command execution: ok\n",
            64,
        );

        assert!(findings.is_empty());
    }

    #[test]
    fn stderr_lines_do_not_reset_an_incomplete_stdout_summary() {
        let mut analyzer = SstimapAnalyzer::default();

        analyzer.push(
            StreamKind::Stdout,
            "SSTImap identified the following injection point:\n",
            false,
        );
        analyzer.push(StreamKind::Stderr, "connection retry\n", false);
        let findings = analyzer.push(StreamKind::Stdout, "  Engine: Jinja2\n", false);

        assert_eq!(findings, vec![finding("engine", "Jinja2")]);
    }
}
