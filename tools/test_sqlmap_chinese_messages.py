import ast
import unittest
from pathlib import Path
from types import SimpleNamespace


SQLMAP_ROOT = Path(__file__).parents[1] / "CNversion" / "sqlmap-1.10"
QUERY_MESSAGE_FILES = (
    "lib/request/inject.py",
    "lib/techniques/blind/inference.py",
    "lib/techniques/dns/use.py",
    "lib/techniques/error/use.py",
    "lib/techniques/union/use.py",
)


class ChineseQueryMessageTests(unittest.TestCase):
    def test_query_debug_messages_use_chinese_count_and_duration_placeholders(self):
        expected_format = "执行了 %d%s查询，用时 %.2f 秒"

        for relative_path in QUERY_MESSAGE_FILES:
            with self.subTest(path=relative_path):
                source = (SQLMAP_ROOT / relative_path).read_text(encoding="utf-8")
                tree = ast.parse(source)
                expressions = [
                    node.value
                    for node in ast.walk(tree)
                    if isinstance(node, ast.Assign)
                    and isinstance(node.value, ast.BinOp)
                    and isinstance(node.value.op, ast.Mod)
                    and isinstance(node.value.left, ast.Constant)
                    and isinstance(node.value.left.value, str)
                    and "执行了" in node.value.left.value
                ]

                self.assertEqual(len(expressions), 1)
                self.assertEqual(expressions[0].left.value, expected_format)
                namespace = {
                    "PAYLOAD": SimpleNamespace(
                        TECHNIQUE=SimpleNamespace(UNION="union")
                    ),
                    "calculateDeltaSeconds": lambda _: 1.25,
                    "count": 2,
                    "duration": 1.25,
                    "getTechnique": lambda: "error",
                    "kb": SimpleNamespace(counters={"error": 2, "union": 2}),
                    "start": object(),
                }
                result = eval(
                    compile(ast.Expression(expressions[0]), relative_path, "eval"),
                    {"__builtins__": {}},
                    namespace,
                )
                self.assertEqual(result, "执行了 2 次查询，用时 1.25 秒")


if __name__ == "__main__":
    unittest.main()
