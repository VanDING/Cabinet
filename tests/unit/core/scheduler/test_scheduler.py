from __future__ import annotations

import json

from cabinet.core.scheduler.models import CronJob, JobResult, JobStatus
from cabinet.core.scheduler.scheduler import CronScheduler


class TestCronJobParsing:
    def test_duration_string_parsing(self):
        job = CronJob.from_natural("check deploy", "30m")
        assert job.name == "check deploy"
        assert job.interval_seconds == 1800

    def test_every_phrase_parsing(self):
        job = CronJob.from_natural("morning briefing", "every day 9am")
        assert job.name == "morning briefing"
        assert job.interval_seconds is not None

    def test_cron_expression_parsing(self):
        job = CronJob.from_natural("nightly backup", "0 2 * * *")
        assert job.name == "nightly backup"
        assert job.expression == "0 2 * * *"

    def test_iso_timestamp_parsing(self):
        job = CronJob.from_natural("one-time report", "2026-06-01T09:00:00")
        assert job.name == "one-time report"
        assert not job.recurring

    def test_zero_seconds_duration(self):
        job = CronJob.from_natural("immediate", "0s")
        assert job.interval_seconds == 0


class TestCronScheduler:
    async def test_add_job_persists(self, tmp_path):
        s = CronScheduler(persistence_path=tmp_path / "cron.json")
        try:
            job = CronJob.from_natural("test job", "1h")
            await s.add_job(job)
            assert len(s.jobs) == 1

            data = json.loads((tmp_path / "cron.json").read_text())
            assert len(data) == 1
            assert data[0]["name"] == "test job"
        finally:
            await s.stop()

    async def test_remove_job(self, tmp_path):
        s = CronScheduler(persistence_path=tmp_path / "cron.json")
        try:
            job = CronJob.from_natural("test job", "1h")
            await s.add_job(job)
            await s.remove_job(job.id)
            assert len(s.jobs) == 0
        finally:
            await s.stop()

    async def test_fire_job_executes_handler(self):
        s = CronScheduler()
        results = []

        async def handler(job: CronJob) -> JobResult:
            results.append(job.name)
            return JobResult(job_id=job.id, status=JobStatus.SUCCESS, output="done")

        try:
            job = CronJob.from_natural("test", "0s")
            await s.add_job(job, handler=handler)
            await s.fire_now(job.id)

            assert len(results) == 1
            assert results[0] == "test"
        finally:
            await s.stop()

    async def test_stop_cancels_running_loop(self):
        s = CronScheduler()
        await s.start(interval=0.1)
        assert s.is_running
        await s.stop()
        assert not s.is_running

    async def test_fire_now_unknown_job(self):
        s = CronScheduler()
        try:
            result = await s.fire_now("nonexistent")
            assert result.status == JobStatus.FAILED
            assert "not found" in result.error
        finally:
            await s.stop()
