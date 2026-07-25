use super::{Finding, LineBuffers, StreamKind, ToolOutputAnalyzer};

#[derive(Default)]
pub struct SqlmapAnalyzer {
    lines: LineBuffers,
    stdout: SqlmapState,
    stderr: SqlmapState,
}

#[derive(Default)]
struct SqlmapState {
    database: Option<String>,
    table: Option<String>,
    section: Section,
}

#[derive(Default)]
enum Section {
    #[default]
    None,
    Databases,
    Tables {
        database: String,
        phase: TablePhase,
    },
    Columns {
        database: String,
        table: String,
        phase: ColumnPhase,
    },
}

#[derive(Clone, Copy)]
enum TablePhase {
    Border,
    Rows,
}

#[derive(Clone, Copy)]
enum ColumnPhase {
    Border,
    Header,
    HeaderBorder,
    Rows,
}

impl ToolOutputAnalyzer for SqlmapAnalyzer {
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

impl SqlmapState {
    fn process_line(&mut self, line: &str) -> Vec<Finding> {
        let line = line.trim();
        if line.is_empty() {
            return Vec::new();
        }

        if let Some(value) = summary_value(line, &["Parameter:", "参数：", "参数:"]) {
            let parameter = value.split(" (").next().unwrap_or(value).trim();
            return optional_finding("injection-point", parameter);
        }
        if let Some(value) = summary_value(
            line,
            &[
                "back-end DBMS:",
                "后端数据库管理系统：",
                "后端数据库管理系统:",
                "后台数据库管理系统：",
                "后台数据库管理系统:",
            ],
        ) {
            return optional_finding("dbms", value);
        }
        if is_database_list_heading(line) {
            self.section = Section::Databases;
            return Vec::new();
        }
        if let Some(database) = summary_value(line, &["Database:"]) {
            self.database = Some(database.to_string());
            self.table = None;
            self.section = Section::None;
            return Vec::new();
        }
        if let Some(table) = summary_value(line, &["Table:"]) {
            self.table = Some(table.to_string());
            self.section = Section::None;
            return Vec::new();
        }
        if is_count(line, "table") {
            if let Some(database) = self.database.clone() {
                self.section = Section::Tables {
                    database,
                    phase: TablePhase::Border,
                };
            }
            return Vec::new();
        }
        if is_count(line, "column") {
            if let (Some(database), Some(table)) = (self.database.clone(), self.table.clone()) {
                self.section = Section::Columns {
                    database,
                    table,
                    phase: ColumnPhase::Border,
                };
            }
            return Vec::new();
        }

        match &mut self.section {
            Section::None => Vec::new(),
            Section::Databases => {
                if let Some(value) = line.strip_prefix("[*]").map(str::trim) {
                    optional_finding("database", value)
                } else {
                    self.section = Section::None;
                    Vec::new()
                }
            }
            Section::Tables { database, phase } => match phase {
                TablePhase::Border if is_box_border(line) => {
                    *phase = TablePhase::Rows;
                    Vec::new()
                }
                TablePhase::Rows if is_box_border(line) => {
                    self.section = Section::None;
                    Vec::new()
                }
                TablePhase::Rows => table_cells(line)
                    .first()
                    .map(|value| contextual_finding("table", value, database, None))
                    .into_iter()
                    .collect(),
                TablePhase::Border => Vec::new(),
            },
            Section::Columns {
                database,
                table,
                phase,
            } => match phase {
                ColumnPhase::Border if is_box_border(line) => {
                    *phase = ColumnPhase::Header;
                    Vec::new()
                }
                ColumnPhase::Header => {
                    let cells = table_cells(line);
                    if cells
                        .first()
                        .is_some_and(|value| value.eq_ignore_ascii_case("column"))
                    {
                        *phase = ColumnPhase::HeaderBorder;
                    } else {
                        self.section = Section::None;
                    }
                    Vec::new()
                }
                ColumnPhase::HeaderBorder if is_box_border(line) => {
                    *phase = ColumnPhase::Rows;
                    Vec::new()
                }
                ColumnPhase::Rows if is_box_border(line) => {
                    self.section = Section::None;
                    Vec::new()
                }
                ColumnPhase::Rows => table_cells(line)
                    .first()
                    .map(|value| contextual_finding("column", value, database, Some(table)))
                    .into_iter()
                    .collect(),
                ColumnPhase::Border | ColumnPhase::HeaderBorder => Vec::new(),
            },
        }
    }
}

fn summary_value<'a>(line: &'a str, prefixes: &[&str]) -> Option<&'a str> {
    prefixes
        .iter()
        .find_map(|prefix| line.strip_prefix(prefix))
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn is_database_list_heading(line: &str) -> bool {
    (line.starts_with("available databases [") || line.starts_with("可用数据库 ["))
        && line.ends_with(':')
}

fn is_count(line: &str, subject: &str) -> bool {
    line.starts_with('[')
        && line.ends_with(']')
        && (line.contains(&format!(" {subject}]")) || line.contains(&format!(" {subject}s]")))
}

fn is_box_border(line: &str) -> bool {
    line.starts_with('+')
        && line.ends_with('+')
        && line
            .chars()
            .all(|character| character == '+' || character == '-')
}

fn table_cells(line: &str) -> Vec<String> {
    if !line.starts_with('|') || !line.ends_with('|') {
        return Vec::new();
    }
    line[1..line.len() - 1]
        .split('|')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect()
}

fn optional_finding(kind: &str, value: &str) -> Vec<Finding> {
    (!value.is_empty())
        .then(|| Finding {
            kind: kind.to_string(),
            value: value.to_string(),
            database: None,
            table: None,
            detail: None,
        })
        .into_iter()
        .collect()
}

fn contextual_finding(kind: &str, value: &str, database: &str, table: Option<&str>) -> Finding {
    Finding {
        kind: kind.to_string(),
        value: value.to_string(),
        database: Some(database.to_string()),
        table: table.map(str::to_string),
        detail: None,
    }
}

#[cfg(test)]
mod tests {
    use super::SqlmapAnalyzer;
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

    fn contextual_finding(kind: &str, value: &str, database: &str, table: Option<&str>) -> Finding {
        Finding {
            kind: kind.to_string(),
            value: value.to_string(),
            database: Some(database.to_string()),
            table: table.map(str::to_string),
            detail: None,
        }
    }

    fn feed_in_chunks(output: &str, chunk_size: usize) -> Vec<Finding> {
        let mut analyzer = SqlmapAnalyzer::default();
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
    fn extracts_summary_and_contextual_schema_across_chunks() {
        let output = concat!(
            "\x1b[32mParameter: id (GET)\x1b[0m\n",
            "Type: boolean-based blind\n",
            "back-end DBMS: MySQL\n",
            "available databases [2]:\n",
            "[*] app\n",
            "[*] audit\n",
            "Database: app\n",
            "[1 table]\n",
            "+-------+\n",
            "| users |\n",
            "+-------+\n",
            "Database: app\n",
            "Table: users\n",
            "[2 columns]\n",
            "+----------+---------+\n",
            "| Column   | Type    |\n",
            "+----------+---------+\n",
            "| id       | int     |\n",
            "| username | varchar |\n",
            "+----------+---------+\n",
        );

        let findings = feed_in_chunks(output, 17);

        assert!(findings.contains(&finding("injection-point", "id")));
        assert!(findings.contains(&finding("dbms", "MySQL")));
        assert!(findings.contains(&finding("database", "app")));
        assert!(findings.contains(&finding("database", "audit")));
        assert!(findings.contains(&contextual_finding("table", "users", "app", None)));
        assert!(findings.contains(&contextual_finding(
            "column",
            "username",
            "app",
            Some("users")
        )));
    }

    #[test]
    fn extracts_translated_summary_labels() {
        let findings = feed_in_chunks("参数：name (POST)\n后端数据库管理系统：PostgreSQL\n", 8);

        assert_eq!(
            findings,
            vec![
                finding("injection-point", "name"),
                finding("dbms", "PostgreSQL")
            ]
        );
    }

    #[test]
    fn ignores_box_rows_without_confirmed_dump_sections() {
        let findings = feed_in_chunks(
            "[INFO] ordinary output\n+-------+\n| users |\n+-------+\n[*] not_a_database\n",
            64,
        );

        assert!(findings.is_empty());
    }

    #[test]
    fn stderr_lines_do_not_reset_an_incomplete_stdout_section() {
        let mut analyzer = SqlmapAnalyzer::default();

        assert!(analyzer
            .push(StreamKind::Stdout, "available databases [1]:\n", false)
            .is_empty());
        assert!(analyzer
            .push(StreamKind::Stderr, "[WARNING] retrying request\n", false)
            .is_empty());
        let findings = analyzer.push(StreamKind::Stdout, "[*] app\n", false);

        assert_eq!(findings, vec![finding("database", "app")]);
    }
}
