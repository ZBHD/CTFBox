use super::{Finding, LineBuffers, StreamKind, ToolOutputAnalyzer};

/// dirsearch 命中行解析：`[HH:MM:SS]  200 -    1KB - /admin  ->  /admin/login`。
#[derive(Default)]
pub struct DirsearchAnalyzer {
    lines: LineBuffers,
}

impl ToolOutputAnalyzer for DirsearchAnalyzer {
    fn push(&mut self, stream: StreamKind, chunk: &str, eof: bool) -> Vec<Finding> {
        self.lines
            .push(stream, chunk, eof)
            .into_iter()
            .filter_map(|line| parse_line(&line))
            .collect()
    }
}

fn is_timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 8
        && bytes[2] == b':'
        && bytes[5] == b':'
        && [0, 1, 3, 4, 6, 7]
            .iter()
            .all(|&index| bytes[index].is_ascii_digit())
}

fn parse_line(line: &str) -> Option<Finding> {
    let rest = line.trim_start().strip_prefix('[')?;
    let (timestamp, after) = rest.split_once(']')?;
    if !is_timestamp(timestamp) {
        return None;
    }
    let tokens: Vec<&str> = after.split_whitespace().collect();
    // 至少：status - size - path
    if tokens.len() < 5 || tokens[1] != "-" || tokens[3] != "-" {
        return None;
    }
    let status = tokens[0];
    if status.len() != 3 || !status.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let size = tokens[2];
    let path = tokens[4];

    let mut detail = format!("{status} · {size}");
    if tokens.get(5) == Some(&"->") {
        if let Some(target) = tokens.get(6) {
            detail.push_str(&format!(" -> {target}"));
        }
    }

    Some(Finding {
        kind: "path".to_string(),
        value: path.to_string(),
        database: None,
        table: None,
        detail: Some(detail),
    })
}

#[cfg(test)]
mod tests {
    use super::DirsearchAnalyzer;
    use crate::analysis::{StreamKind, ToolOutputAnalyzer};

    fn feed(output: &str, chunk_size: usize) -> Vec<crate::analysis::Finding> {
        let mut analyzer = DirsearchAnalyzer::default();
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
    fn extracts_status_size_and_path_from_hit_lines() {
        let output = concat!(
            "\x1b[0m[12:00:01] Starting: \n",
            "[12:00:02] 200 -    1KB - /admin\n",
            "[12:00:03] 301 -  178B - /uploads  ->  /uploads/\n",
            "[12:00:04] 403 -   12B - /.htaccess\n",
        );

        // 逐 7 字节喂入，验证跨 chunk 截断下仍稳定。
        let findings = feed(output, 7);

        assert_eq!(findings.len(), 3);
        assert_eq!(findings[0].value, "/admin");
        assert_eq!(findings[0].detail.as_deref(), Some("200 · 1KB"));
        assert_eq!(findings[1].value, "/uploads");
        assert_eq!(findings[1].detail.as_deref(), Some("301 · 178B -> /uploads/"));
        assert_eq!(findings[2].value, "/.htaccess");
    }

    #[test]
    fn ignores_banner_and_progress_lines() {
        let findings = feed("Extensions: php | HTTP method: GET\n[stuff] not a hit\n", 64);
        assert!(findings.is_empty());
    }
}
