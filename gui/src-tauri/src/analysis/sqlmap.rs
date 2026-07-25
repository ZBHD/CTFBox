use super::{Finding, LineBuffers, StreamKind, ToolOutputAnalyzer};
use std::collections::VecDeque;

pub struct SqlmapAnalyzer {
    lines: LineBuffers,
    stdout: SqlmapState,
    stderr: SqlmapState,
}

struct SqlmapState {
    database: Option<DatabaseContext>,
    table: Option<String>,
    requested_table: Option<String>,
    pending_tables: VecDeque<String>,
    section: Section,
}

#[derive(Clone)]
enum DatabaseContext {
    Named(String),
    Current,
}

#[derive(Default)]
enum Section {
    #[default]
    None,
    Databases,
    Tables {
        database: Option<String>,
        phase: TablePhase,
    },
    Columns {
        database: Option<String>,
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

impl Default for SqlmapAnalyzer {
    fn default() -> Self {
        Self::new(&[])
    }
}

impl SqlmapAnalyzer {
    pub fn new(arguments: &[String]) -> Self {
        let database = single_argument_value(arguments, "-D").map(DatabaseContext::Named);
        let table = single_argument_value(arguments, "-T");
        Self {
            lines: LineBuffers::default(),
            stdout: SqlmapState::new(database.clone(), table.clone()),
            stderr: SqlmapState::new(database, table),
        }
    }
}

impl SqlmapState {
    fn new(database: Option<DatabaseContext>, table: Option<String>) -> Self {
        Self {
            database,
            table: table.clone(),
            requested_table: table,
            pending_tables: VecDeque::new(),
            section: Section::None,
        }
    }

    fn database_value(&self) -> Option<String> {
        match &self.database {
            Some(DatabaseContext::Named(value)) => Some(value.clone()),
            Some(DatabaseContext::Current) | None => None,
        }
    }

    fn enter_current_database(&mut self) {
        self.database = Some(DatabaseContext::Current);
        self.table = if let Some(requested) = self.requested_table.clone() {
            if self.pending_tables.front() == Some(&requested) {
                self.pending_tables.pop_front();
            }
            Some(requested)
        } else {
            self.pending_tables.pop_front()
        };
        self.section = Section::None;
    }
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

        if let Some(table) = fetched_columns_table(line) {
            if self.pending_tables.back() != Some(&table) {
                self.pending_tables.push_back(table);
            }
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
        if let Some(database) = summary_value(line, &["Database:", "数据库：", "数据库:"]) {
            self.database = Some(DatabaseContext::Named(database.to_string()));
            self.table = self.requested_table.clone();
            self.section = Section::None;
            return Vec::new();
        }
        if line == "<current>" || line == "<当前>" {
            self.enter_current_database();
            return Vec::new();
        }
        if let Some(table) = summary_value(line, &["Table:", "表：", "表:"]) {
            self.table = Some(table.to_string());
            self.section = Section::None;
            return Vec::new();
        }
        if is_count(line, "table") {
            if self.database.is_some() {
                self.section = Section::Tables {
                    database: self.database_value(),
                    phase: TablePhase::Border,
                };
            }
            return Vec::new();
        }
        if is_count(line, "column") {
            if self.database.is_some() {
                if let Some(table) = self.table.clone() {
                    self.section = Section::Columns {
                        database: self.database_value(),
                        table,
                        phase: ColumnPhase::Border,
                    };
                }
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
                    .map(|value| contextual_finding("table", value, database.as_deref(), None))
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
                    if cells.first().is_some_and(|value| is_column_header(value)) {
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
                    .map(|value| {
                        contextual_finding("column", value, database.as_deref(), Some(table))
                    })
                    .into_iter()
                    .collect(),
                ColumnPhase::Border | ColumnPhase::HeaderBorder => Vec::new(),
            },
        }
    }
}

fn single_argument_value(arguments: &[String], flag: &str) -> Option<String> {
    arguments
        .iter()
        .enumerate()
        .find_map(|(index, argument)| {
            if argument == flag {
                arguments.get(index + 1).cloned()
            } else {
                argument
                    .strip_prefix(&format!("{flag}="))
                    .map(str::to_string)
            }
        })
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && !value.contains(','))
}

fn quoted_value_after(line: &str, prefix: &str, suffix: &str) -> Option<String> {
    let value = line.split_once(prefix)?.1.split_once(suffix)?.0.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn fetched_columns_table(line: &str) -> Option<String> {
    if line.contains("fetching columns ") {
        quoted_value_after(line, "for table '", "'")
    } else if line.contains("获取列 ") {
        quoted_value_after(line, "对于表“", "”")
            .or_else(|| quoted_value_after(line, "for table '", "'"))
    } else {
        None
    }
}

fn is_column_header(value: &str) -> bool {
    value.eq_ignore_ascii_case("column") || matches!(value, "列" | "字段")
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

fn contextual_finding(
    kind: &str,
    value: &str,
    database: Option<&str>,
    table: Option<&str>,
) -> Finding {
    Finding {
        kind: kind.to_string(),
        value: value.to_string(),
        database: database.map(str::to_string),
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

    fn contextual_finding(
        kind: &str,
        value: &str,
        database: Option<&str>,
        table: Option<&str>,
    ) -> Finding {
        Finding {
            kind: kind.to_string(),
            value: value.to_string(),
            database: database.map(str::to_string),
            table: table.map(str::to_string),
            detail: None,
        }
    }

    fn feed_in_chunks_with_arguments(
        output: &str,
        chunk_size: usize,
        arguments: &[&str],
    ) -> Vec<Finding> {
        let arguments = arguments
            .iter()
            .map(|value| value.to_string())
            .collect::<Vec<_>>();
        let mut analyzer = SqlmapAnalyzer::new(&arguments);
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

    fn feed_in_chunks(output: &str, chunk_size: usize) -> Vec<Finding> {
        feed_in_chunks_with_arguments(output, chunk_size, &[])
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
        assert!(findings.contains(&contextual_finding("table", "users", Some("app"), None)));
        assert!(findings.contains(&contextual_finding(
            "column",
            "username",
            Some("app"),
            Some("users")
        )));
    }

    #[test]
    fn extracts_current_database_tables_from_original_and_chinese_runs() {
        for output in [
            concat!(
                "[INFO] fetching tables for database: 'SQLite_masterdb'\n",
                "<current>\n",
                "[2 tables]\n",
                "+----------+\n",
                "| articles |\n",
                "| users    |\n",
                "+----------+\n",
            ),
            concat!(
                "[INFO] 获取数据库的表: 'SQLite_masterdb'\n",
                "<current>\n",
                "[2 tables]\n",
                "+----------+\n",
                "| articles |\n",
                "| users    |\n",
                "+----------+\n",
            ),
        ] {
            let findings = feed_in_chunks(output, 11);

            assert!(findings.contains(&contextual_finding("table", "articles", None, None)));
            assert!(findings.contains(&contextual_finding("table", "users", None, None)));
        }
    }

    #[test]
    fn supports_every_sqlmap_backend_that_uses_the_current_database_formatter() {
        for dbms in [
            "SQLite",
            "Microsoft Access",
            "Firebird",
            "Mckoi",
            "eXtremeDB",
            "Raima Database Manager",
        ] {
            let output = format!(
                "back-end DBMS: {dbms}\n<current>\n[1 table]\n+-------+\n| users |\n+-------+\n"
            );

            let findings = feed_in_chunks(&output, 7);

            assert!(
                findings.contains(&finding("dbms", dbms)),
                "missing DBMS: {dbms}"
            );
            assert!(
                findings.contains(&contextual_finding("table", "users", None, None)),
                "missing current-database table for {dbms}"
            );
        }
    }

    #[test]
    fn uses_run_arguments_for_current_database_column_context() {
        let output = concat!(
            "<current>\n",
            "[2 columns]\n",
            "+----------+---------+\n",
            "| Column   | Type    |\n",
            "+----------+---------+\n",
            "| id       | INTEGER |\n",
            "| username | TEXT    |\n",
            "+----------+---------+\n",
        );

        let findings = feed_in_chunks_with_arguments(output, 13, &["--columns", "-T", "users"]);

        assert!(findings.contains(&contextual_finding("column", "id", None, Some("users"))));
        assert!(findings.contains(&contextual_finding(
            "column",
            "username",
            None,
            Some("users")
        )));
    }

    #[test]
    fn accepts_equals_syntax_for_sqlmap_context_arguments() {
        let output = concat!(
            "<current>\n",
            "[1 column]\n",
            "+--------+------+\n",
            "| Column | Type |\n",
            "+--------+------+\n",
            "| id     | int  |\n",
            "+--------+------+\n",
        );

        let findings = feed_in_chunks_with_arguments(output, 64, &["--columns", "-T=users"]);

        assert!(findings.contains(&contextual_finding("column", "id", None, Some("users"))));
    }

    #[test]
    fn associates_multiple_current_database_column_blocks_with_fetch_logs() {
        let output = concat!(
            "[INFO] fetching columns for table 'articles'\n",
            "[INFO] fetching columns for table 'users'\n",
            "<current>\n",
            "[1 column]\n",
            "+--------+------+\n",
            "| Column | Type |\n",
            "+--------+------+\n",
            "| title  | TEXT |\n",
            "+--------+------+\n",
            "<current>\n",
            "[1 column]\n",
            "+--------+---------+\n",
            "| Column | Type    |\n",
            "+--------+---------+\n",
            "| id     | INTEGER |\n",
            "+--------+---------+\n",
        );

        let findings = feed_in_chunks(output, 17);

        assert!(findings.contains(&contextual_finding(
            "column",
            "title",
            None,
            Some("articles")
        )));
        assert!(findings.contains(&contextual_finding("column", "id", None, Some("users"))));
    }

    #[test]
    fn associates_chinese_current_database_column_blocks_with_fetch_logs() {
        let output = concat!(
            "[INFO] 获取列 对于表“users”\n",
            "<current>\n",
            "[1 column]\n",
            "+--------+---------+\n",
            "| Column | Type    |\n",
            "+--------+---------+\n",
            "| id     | INTEGER |\n",
            "+--------+---------+\n",
        );

        let findings = feed_in_chunks(output, 9);

        assert!(findings.contains(&contextual_finding("column", "id", None, Some("users"))));
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
