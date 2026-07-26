from contextlib import redirect_stdout
import hashlib
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from tools import verify_localization


class LocalizationBaselineTests(unittest.TestCase):
    def test_baseline_is_kept_with_localization_tools(self):
        expected = verify_localization.ROOT / "tools" / "localization" / "original-baseline.sha256"

        self.assertEqual(verify_localization.BASELINE, expected)
        self.assertTrue(expected.is_file())
        self.assertTrue(verify_localization.read_baseline())


class OriginalHashTests(unittest.TestCase):
    def test_text_hash_is_independent_of_line_endings_and_extension(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("sample.c", "sample.cpp", "sample.h", "AUTHORS"):
                with self.subTest(name=name):
                    lf = root / "lf" / name
                    crlf = root / "crlf" / name
                    lf.parent.mkdir(exist_ok=True)
                    crlf.parent.mkdir(exist_ok=True)
                    lf.write_bytes(b"first line\nsecond line\n")
                    crlf.write_bytes(b"first line\r\nsecond line\r\n")
                    self.assertEqual(
                        verify_localization.sha256(lf),
                        verify_localization.sha256(crlf),
                    )

    def test_nul_binary_hash_preserves_raw_line_endings(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            lf = root / "payload.c"
            crlf = root / "payload-crlf.c"
            lf_bytes = b"prefix\0first\nsecond\n"
            crlf_bytes = b"prefix\0first\r\nsecond\r\n"
            lf.write_bytes(lf_bytes)
            crlf.write_bytes(crlf_bytes)

            self.assertEqual(
                verify_localization.sha256(lf), hashlib.sha256(lf_bytes).hexdigest()
            )
            self.assertEqual(
                verify_localization.sha256(crlf),
                hashlib.sha256(crlf_bytes).hexdigest(),
            )
            self.assertNotEqual(
                verify_localization.sha256(lf), verify_localization.sha256(crlf)
            )

    def test_git_declared_binary_without_nul_preserves_raw_line_endings(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".gitattributes").write_text("*.sln binary\n", encoding="utf-8")
            lf = root / "project.sln"
            crlf = root / "project-crlf.sln"
            lf_bytes = b"first\nsecond\n"
            crlf_bytes = b"first\r\nsecond\r\n"
            lf.write_bytes(lf_bytes)
            crlf.write_bytes(crlf_bytes)

            self.assertEqual(
                verify_localization.sha256(lf), hashlib.sha256(lf_bytes).hexdigest()
            )
            self.assertEqual(
                verify_localization.sha256(crlf),
                hashlib.sha256(crlf_bytes).hexdigest(),
            )
            self.assertNotEqual(
                verify_localization.sha256(lf), verify_localization.sha256(crlf)
            )

    def test_real_text_change_changes_hash(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            original = root / "original.c"
            changed = root / "changed.c"
            original.write_bytes(b"return 0;\n")
            changed.write_bytes(b"return 1;\r\n")

            self.assertNotEqual(
                verify_localization.sha256(original),
                verify_localization.sha256(changed),
            )


class VerifyOriginalTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.original = self.root / "Original"
        self.original.mkdir()
        self.baseline = self.root / "original-baseline.sha256"

    def tearDown(self):
        self.temporary_directory.cleanup()

    def write_baseline(self, path: str, content: bytes) -> None:
        digest = hashlib.sha256(content).hexdigest()
        self.baseline.write_text(f"{digest}  {path}\n", encoding="utf-8")

    def verify(self) -> verify_localization.CheckResults:
        results = verify_localization.CheckResults()
        with (
            patch.object(verify_localization, "ORIGINAL", self.original),
            patch.object(verify_localization, "BASELINE", self.baseline),
            redirect_stdout(StringIO()),
        ):
            verify_localization.verify_original(results)
        return results

    def test_line_ending_only_change_does_not_fail_verification(self):
        self.write_baseline("source.c", b"first\nsecond\n")
        (self.original / "source.c").write_bytes(b"first\r\nsecond\r\n")

        self.assertEqual(self.verify().failures, [])

    def test_real_change_and_removal_still_fail_verification(self):
        self.write_baseline("source.c", b"first\nsecond\n")
        source = self.original / "source.c"
        source.write_bytes(b"changed\n")

        changed = self.verify()
        self.assertTrue(any("变化 1 个" in failure for failure in changed.failures))

        source.unlink()
        removed = self.verify()
        self.assertTrue(any("删除 1 个" in failure for failure in removed.failures))


if __name__ == "__main__":
    unittest.main()
