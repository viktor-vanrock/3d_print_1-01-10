import os
import pathlib
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class ApiMigrationSafetyTest(unittest.TestCase):
    def test_vds_deploys_use_guarded_downtime_helper(self) -> None:
        for relative in ("deploy/portal.deploy.sh", "deploy/portal.deploy-dev.sh"):
            script = (ROOT / relative).read_text(encoding="utf-8")
            self.assertIn("deploy/portal.api-migrate-with-downtime.sh", script, relative)
            self.assertNotIn("pnpm --filter @portal/api run db:migrate", script, relative)

    def test_helper_stops_before_migration_and_starts_after_success(self) -> None:
        script = (ROOT / "deploy/portal.api-migrate-with-downtime.sh").read_text(encoding="utf-8")
        stop = script.index('/usr/bin/systemctl stop "$API_UNIT"')
        migrate = script.index("pnpm --filter @portal/api run db:migrate")
        start = script.index('/usr/bin/systemctl start "$API_UNIT"')
        self.assertLess(stop, migrate)
        self.assertLess(migrate, start)
        self.assertIn("migration failed; API remains stopped", script)

    def run_helper(self, migration_exit: int) -> tuple[subprocess.CompletedProcess[str], list[str]]:
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            log = root / "calls.log"
            env_file = root / "api.env"
            env_file.write_text("DATABASE_URL=postgres://isolated-test\n", encoding="utf-8")
            (root / "sudo").write_text(
                '#!/usr/bin/env bash\nprintf "systemctl %s %s\\n" "$2" "$3" >> "$MIGRATION_TEST_LOG"\n',
                encoding="utf-8",
            )
            (root / "pnpm").write_text(
                f'#!/usr/bin/env bash\nprintf "db:migrate\\n" >> "$MIGRATION_TEST_LOG"\nexit {migration_exit}\n',
                encoding="utf-8",
            )
            (root / "sudo").chmod(0o755)
            (root / "pnpm").chmod(0o755)
            environment = os.environ.copy()
            environment["PATH"] = f"{root}:{environment['PATH']}"
            environment["MIGRATION_TEST_LOG"] = str(log)
            result = subprocess.run(
                [str(ROOT / "deploy/portal.api-migrate-with-downtime.sh"), "portal.api", str(env_file)],
                cwd=ROOT,
                env=environment,
                check=False,
                capture_output=True,
                text=True,
            )
            calls = log.read_text(encoding="utf-8").splitlines()
            return result, calls

    def test_helper_executes_stop_migrate_start(self) -> None:
        result, calls = self.run_helper(0)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, ["systemctl stop portal.api", "db:migrate", "systemctl start portal.api"])

    def test_helper_leaves_api_stopped_when_migration_fails(self) -> None:
        result, calls = self.run_helper(1)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, ["systemctl stop portal.api", "db:migrate"])
        self.assertIn("API remains stopped", result.stderr)

    def test_helm_values_warn_that_recreate_does_not_stop_pre_upgrade_hook(self) -> None:
        for relative in ("envs/dev/api.yaml", "envs/prod/api.yaml"):
            values = (ROOT / relative).read_text(encoding="utf-8")
            self.assertIn("INCOMPATIBLE_MIGRATION_REQUIRES_SCALE_TO_ZERO", values, relative)

    def test_openshift_guard_scales_api_to_zero_and_verifies_ready_replicas(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            log = root / "oc.log"
            fake_oc = root / "oc"
            fake_oc.write_text(
                "#!/usr/bin/env bash\n"
                'printf "%s\\n" "$*" >> "$OPENSHIFT_GUARD_TEST_LOG"\n'
                'if [ "$1" = "get" ]; then printf "0"; fi\n',
                encoding="utf-8",
            )
            fake_oc.chmod(0o755)
            environment = os.environ.copy()
            environment["PATH"] = f"{root}:{environment['PATH']}"
            environment["OPENSHIFT_GUARD_TEST_LOG"] = str(log)
            result = subprocess.run(
                [str(ROOT / "deploy/portal.openshift-api-stop-for-migration.sh"), "p-rndml-aiportal"],
                cwd=ROOT,
                env=environment,
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            calls = log.read_text(encoding="utf-8")
            self.assertIn("scale deployment/api --replicas=0 -n p-rndml-aiportal", calls)
            self.assertIn("get deployment/api -n p-rndml-aiportal", calls)

    def test_openshift_guard_rejects_unknown_namespace_before_oc(self) -> None:
        result = subprocess.run(
            [str(ROOT / "deploy/portal.openshift-api-stop-for-migration.sh"), "unknown"],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 64)
        self.assertIn("unsupported API namespace", result.stderr)


if __name__ == "__main__":
    unittest.main()
