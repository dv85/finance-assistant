"""Synthetic prerequisite checks: no real tools, household data, or setup calls."""
from __future__ import annotations

import builtins
import io
import os
import subprocess
import sys
import unittest
from contextlib import ExitStack, redirect_stdout
from pathlib import Path
from types import ModuleType
from unittest.mock import Mock, call, patch

import check_environment as checker


class EnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.node = str(Path("/tools with spaces & symbols") / "node")
        self.npm = str(Path("/tools with spaces & symbols") / "npm")
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(checker.sys, "version_info", (3, 12, 9)))
        self.which = self.stack.enter_context(patch.object(
            checker.shutil, "which", side_effect=lambda name: {"node": self.node, "npm": self.npm}[name],
        ))
        self.run = self.stack.enter_context(patch.object(checker.subprocess, "run"))
        self.run.side_effect = [self.result("v24.3.0\n")]

    @staticmethod
    def result(stdout="", returncode=0, stderr=""):
        return subprocess.CompletedProcess([], returncode, stdout, stderr)

    def invoke(self):
        output = io.StringIO()
        with redirect_stdout(output):
            code = checker.main()
        return code, output.getvalue()

    def test_supported_versions_and_strict_command_contract(self):
        code, output = self.invoke()
        self.assertEqual(code, 0)
        for message in ("Python: 3.12", "Node.js: v24.3.0 (major 24)", "npm: available on PATH", "does not validate app setup"):
            self.assertIn(message, output)
        self.assertEqual(self.which.call_args_list, [call("node"), call("npm")])
        options = dict(shell=False, stdin=subprocess.DEVNULL, capture_output=True,
                       text=True, encoding="utf-8", errors="replace", timeout=10, check=False)
        self.assertEqual(self.run.call_args_list, [
            call([self.node, "--version"], **options),
        ])

    def test_python_requires_exact_major_minor_but_allows_patch_releases(self):
        for version in ((3, 11, 9), (3, 13, 0), (4, 12, 0), (3, 12, 0), (3, 12, 99)):
            with self.subTest(version=version), patch.object(checker.sys, "version_info", version):
                self.run.side_effect = [self.result("v24.0.0")]
                code, output = self.invoke()
                self.assertEqual(code, 0 if version[:2] == (3, 12) else 1)
                if code:
                    self.assertIn("required 3.12", output)
                    self.assertIn("py -3.12", output)
                self.assertIn("OK npm", output)

    def test_node_requires_exact_major_and_npm_is_not_version_pinned(self):
        for node_version in ("v23.9.0", "v25.0.0", "v124.0.0", "v24.0.0", "v24.99.1"):
            with self.subTest(version=node_version):
                self.run.side_effect = [self.result(node_version)]
                code, output = self.invoke()
                self.assertEqual(code, 0 if node_version.startswith("v24.") else 1)
                self.assertIn("OK npm: available on PATH", output)
                if code:
                    self.assertIn("required major 24", output)
                    self.assertIn("PATH", output)

    def test_missing_tools_are_actionable_and_all_failures_are_reported(self):
        for missing in ({"node"}, {"npm"}, {"node", "npm"}):
            with self.subTest(missing=missing):
                self.which.side_effect = lambda name: None if name in missing else {"node": self.node, "npm": self.npm}[name]
                self.run.reset_mock()
                self.run.side_effect = [self.result("v24.0.0")]
                with patch.object(checker.sys, "version_info", (3, 13, 0)):
                    code, output = self.invoke()
                self.assertEqual(code, 1)
                self.assertIn("FAIL Python", output)
                for name in missing:
                    self.assertIn(f"FAIL {'Node.js' if name == 'node' else 'npm'}: command not found", output)
                self.assertIn("PATH", output)
                self.assertEqual(self.run.call_count, 0 if "node" in missing else 1)

    def test_node_command_errors_do_not_hide_npm_presence(self):
        for failure, expected in (
            (FileNotFoundError("private detail"), "command not found or no longer available"),
            (PermissionError("private detail"), "Check execution permissions"),
            (OSError("private detail"), "could not start version query"),
            (subprocess.TimeoutExpired(["tool"], 10, output=b"private detail"), "timed out after 10s"),
            (self.result("v24.0.0", 7, "private detail"), "exited with status 7"),
        ):
            with self.subTest(failure=expected):
                self.run.reset_mock()
                self.run.side_effect = [failure]
                code, output = self.invoke()
                self.assertEqual(code, 1)
                self.assertIn("FAIL Node.js", output)
                self.assertIn(expected, output)
                self.assertIn("PATH", output)
                self.assertNotIn("private detail", output)
                self.assertEqual(self.run.call_count, 1)
                self.assertIn("OK npm: available on PATH", output)

    def test_unrecognized_or_empty_versions_fail_without_echoing_output(self):
        for invalid in ("", "private detail", "v24.0.0\nprivate detail", "24", "v24.0.0-rc.1"):
            with self.subTest(invalid=invalid):
                self.run.side_effect = [self.result(invalid)]
                code, output = self.invoke()
                self.assertEqual(code, 1)
                self.assertIn("FAIL Node.js", output)
                self.assertIn("unrecognized version", output)
                self.assertNotIn("private detail", output)

    def test_windows_batch_launchers_are_not_executed(self):
        for extension in (".cmd", ".CMD", ".bat"):
            with self.subTest(extension=extension):
                npm = self.npm + extension
                self.which.side_effect = lambda name: self.node if name == "node" else npm
                self.run.reset_mock()
                self.run.side_effect = [self.result("v24.0.0")]
                with patch.object(Path, "is_file", side_effect=AssertionError("no npm files should be read")):
                    code, _ = self.invoke()
                self.assertEqual(code, 0)
                self.assertEqual([item.args[0] for item in self.run.call_args_list], [[self.node, "--version"]])
                self.assertFalse(self.run.call_args.kwargs["shell"])

    def test_cli_import_and_execution_never_open_data_write_or_call_setup(self):
        # Compile before guarding file APIs so the test itself needs no data files.
        source = compile(Path(checker.__file__).read_text(encoding="utf-8"), checker.__file__, "exec")
        setup = ModuleType("setup_local")
        setup.main = Mock(side_effect=AssertionError("setup must not run"))
        original_import = builtins.__import__

        def guarded_import(name, *args, **kwargs):
            self.assertNotIn(name.split(".")[0], {"setup_local", "household_config", "ledger_memory", "convert_bank_exports"})
            return original_import(name, *args, **kwargs)

        for fail in (False, True):
            with self.subTest(fail=fail), ExitStack() as guards:
                self.run.reset_mock()
                self.run.side_effect = [self.result("v25.0.0" if fail else "v24.0.0")]
                guards.enter_context(patch.dict(sys.modules, {"setup_local": setup}))
                guards.enter_context(patch("builtins.__import__", side_effect=guarded_import))
                blocked = []
                for target, names in (
                    (builtins, ("open",)), (io, ("open",)),
                    (Path, ("open", "read_text", "read_bytes", "write_text", "write_bytes", "mkdir", "touch", "unlink", "rename", "replace")),
                    (os, ("open", "mkdir", "makedirs", "remove", "unlink", "rename", "replace", "system", "getenv")),
                    (subprocess, ("Popen", "call", "check_call", "check_output")),
                ):
                    for name in names:
                        blocked.append(guards.enter_context(patch.object(target, name, side_effect=AssertionError("unexpected I/O or process"))))
                with redirect_stdout(io.StringIO()), self.assertRaises(SystemExit) as exit_result:
                    exec(source, {"__name__": "__main__"})
                self.assertEqual(exit_result.exception.code, int(fail))
                setup.main.assert_not_called()
                for operation in blocked:
                    operation.assert_not_called()
                self.assertEqual([item.args[0] for item in self.run.call_args_list], [
                    [self.node, "--version"],
                ])


if __name__ == "__main__":
    unittest.main()
