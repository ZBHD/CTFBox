use super::{Finding, LineBuffers, StreamKind, ToolOutputAnalyzer};

/// nuclei 漏洞命中解析：优先 `-jsonl`，退化为 `[id] [proto] [severity] url` 括号格式。
#[derive(Default)]
pub struct NucleiAnalyzer {
    lines: LineBuffers,
}

impl ToolOutputAnalyzer for NucleiAnalyzer {
    fn push(&mut self, stream: StreamKind, chunk: &str, eof: bool) -> Vec<Finding> {
        self.lines
            .push(stream, chunk, eof)
            .into_iter()
            .filter_map(|line| parse_line(line.trim()))
            .collect()
    }
}

fn parse_line(line: &str) -> Option<Finding> {
    if line.is_empty() {
        return None;
    }
    if line.starts_with('{') {
        if let Some(finding) = parse_json(line) {
            return Some(finding);
        }
    }
    parse_bracketed(line)
}

fn parse_json(line: &str) -> Option<Finding> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    let template = value.get("template-id")?.as_str()?.trim();
    if template.is_empty() {
        return None;
    }
    let severity = value
        .get("info")
        .and_then(|info| info.get("severity"))
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .unwrap_or("unknown");
    let matched = value
        .get("matched-at")
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|item| !item.is_empty());
    Some(vuln(template, severity, matched))
}

/// 从行首连续提取 `[...]` 分组。
fn leading_groups(line: &str) -> (Vec<&str>, &str) {
    let mut groups = Vec::new();
    let mut rest = line;
    loop {
        let trimmed = rest.trim_start();
        let Some(inner) = trimmed.strip_prefix('[') else {
            return (groups, trimmed);
        };
        let Some(end) = inner.find(']') else {
            return (groups, trimmed);
        };
        groups.push(&inner[..end]);
        rest = &inner[end + 1..];
    }
}

fn parse_bracketed(line: &str) -> Option<Finding> {
    let (groups, rest) = leading_groups(line);
    if groups.len() < 3 {
        return None;
    }
    let template = groups[0].trim();
    let severity = groups[2].trim();
    if template.is_empty() || !is_severity(severity) {
        return None;
    }
    let matched = rest
        .split_whitespace()
        .next()
        .filter(|item| !item.is_empty());
    Some(vuln(template, severity, matched))
}

fn is_severity(value: &str) -> bool {
    matches!(
        value.to_ascii_lowercase().as_str(),
        "info" | "low" | "medium" | "high" | "critical" | "unknown"
    )
}

fn vuln(template: &str, severity: &str, matched: Option<&str>) -> Finding {
    let detail = match matched {
        Some(url) => format!("{severity} · {url}"),
        None => severity.to_string(),
    };
    Finding {
        kind: "vuln".to_string(),
        value: template.to_string(),
        database: None,
        table: None,
        detail: Some(detail),
    }
}

#[cfg(test)]
mod tests {
    use super::NucleiAnalyzer;
    use crate::analysis::{Finding, StreamKind, ToolOutputAnalyzer};

    fn feed(output: &str, chunk_size: usize) -> Vec<Finding> {
        let mut analyzer = NucleiAnalyzer::default();
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
    fn parses_jsonl_template_severity_and_location() {
        let output = concat!(
            "{\"template-id\":\"CVE-2021-1234\",\"info\":{\"severity\":\"high\",\"name\":\"Demo\"},",
            "\"matched-at\":\"http://target/vuln\"}\n",
        );

        let findings = feed(output, 9);

        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].kind, "vuln");
        assert_eq!(findings[0].value, "CVE-2021-1234");
        assert_eq!(
            findings[0].detail.as_deref(),
            Some("high · http://target/vuln")
        );
    }

    #[test]
    fn parses_bracketed_fallback_and_ignores_plain_logs() {
        let output = concat!(
            "[INF] Templates loaded\n",
            "[tech-detect] [http] [info] http://target\n",
            "[CVE-2020-5902] [http] [critical] https://target/config\n",
        );

        let findings = feed(output, 64);

        assert_eq!(findings.len(), 2);
        assert_eq!(findings[0].value, "tech-detect");
        assert_eq!(findings[0].detail.as_deref(), Some("info · http://target"));
        assert_eq!(findings[1].value, "CVE-2020-5902");
        assert_eq!(
            findings[1].detail.as_deref(),
            Some("critical · https://target/config")
        );
    }
}
