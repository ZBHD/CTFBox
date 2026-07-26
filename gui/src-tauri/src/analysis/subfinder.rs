use super::{Finding, LineBuffers, StreamKind, ToolOutputAnalyzer};

/// subfinder 子域枚举解析：优先 `-oJ` 的 NDJSON，退化为每行一个子域的纯文本。
#[derive(Default)]
pub struct SubfinderAnalyzer {
    lines: LineBuffers,
}

impl ToolOutputAnalyzer for SubfinderAnalyzer {
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
    // 纯文本兜底：仅接受合法子域，滤掉 [INF] 之类的日志行。
    if looks_like_host(line) {
        return Some(subdomain(line, None));
    }
    None
}

fn parse_json(line: &str) -> Option<Finding> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    let host = value.get("host")?.as_str()?.trim();
    if host.is_empty() {
        return None;
    }
    let source = value
        .get("source")
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|item| !item.is_empty());
    Some(subdomain(host, source))
}

fn looks_like_host(line: &str) -> bool {
    line.contains('.')
        && !line.contains(char::is_whitespace)
        && line.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_')
        })
}

fn subdomain(host: &str, source: Option<&str>) -> Finding {
    Finding {
        kind: "subdomain".to_string(),
        value: host.to_string(),
        database: None,
        table: None,
        detail: source.map(str::to_string),
    }
}

#[cfg(test)]
mod tests {
    use super::SubfinderAnalyzer;
    use crate::analysis::{Finding, StreamKind, ToolOutputAnalyzer};

    fn feed_stdout(output: &str) -> Vec<Finding> {
        let mut analyzer = SubfinderAnalyzer::default();
        let mut findings = analyzer.push(StreamKind::Stdout, output, false);
        findings.extend(analyzer.push(StreamKind::Stdout, "", true));
        findings
    }

    #[test]
    fn parses_ndjson_host_and_source() {
        let output = concat!(
            "{\"host\":\"api.example.com\",\"source\":\"crtsh\"}\n",
            "{\"host\":\"cdn.example.com\",\"source\":\"dnsdumpster\"}\n",
        );

        let findings = feed_stdout(output);

        assert_eq!(findings.len(), 2);
        assert_eq!(findings[0].kind, "subdomain");
        assert_eq!(findings[0].value, "api.example.com");
        assert_eq!(findings[0].detail.as_deref(), Some("crtsh"));
        assert_eq!(findings[1].value, "cdn.example.com");
    }

    #[test]
    fn falls_back_to_plain_hosts_and_skips_log_lines() {
        let output = concat!(
            "[INF] enumerating subdomains for example.com\n",
            "www.example.com\n",
            "mail.example.com\n",
            "  not a host at all  \n",
        );

        let findings = feed_stdout(output);

        assert_eq!(
            findings
                .iter()
                .map(|item| item.value.as_str())
                .collect::<Vec<_>>(),
            vec!["www.example.com", "mail.example.com"]
        );
    }
}
