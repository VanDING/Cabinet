from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path

from cabinet.core.scheduler.models import CronJob, JobResult, JobStatus

logger = logging.getLogger(__name__)


class CronScheduler:
    def __init__(self, persistence_path: str | Path | None = None):
        self._jobs: dict[str, CronJob] = {}
        self._handlers: dict[str, object] = {}
        self._results: list[JobResult] = []
        self._running = False
        self._task: asyncio.Task | None = None
        self._persist_path = Path(persistence_path) if persistence_path else None
        self._hard_timeout = 180.0

    @property
    def jobs(self) -> list[CronJob]:
        return list(self._jobs.values())

    @property
    def is_running(self) -> bool:
        return self._running

    async def add_job(self, job: CronJob, handler: object = None) -> None:
        self._jobs[job.id] = job
        if handler:
            self._handlers[job.id] = handler
        await self._persist()
        logger.info("Cron job added: %s (%s)", job.name, job.id)

    async def remove_job(self, job_id: str) -> None:
        self._jobs.pop(job_id, None)
        self._handlers.pop(job_id, None)
        await self._persist()
        logger.info("Cron job removed: %s", job_id)

    async def start(self, interval: float = 1.0) -> None:
        self._running = True
        await self._load_persisted()
        self._task = asyncio.create_task(self._loop(interval))
        logger.info("CronScheduler started with %d jobs", len(self._jobs))

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("CronScheduler stopped")

    async def fire_now(self, job_id: str) -> JobResult:
        job = self._jobs.get(job_id)
        if job is None:
            return JobResult(job_id=job_id, status=JobStatus.FAILED, error="Job not found")
        result = await self._execute_job(job)
        self._results.append(result)
        if not job.recurring:
            await self.remove_job(job_id)
        return result

    async def _loop(self, interval: float) -> None:
        while self._running:
            try:
                await self._tick()
            except Exception as e:
                logger.error("Cron tick error: %s", e)
            await asyncio.sleep(interval)

    async def _tick(self) -> None:
        now = time.time()
        for job in list(self._jobs.values()):
            if job.interval_seconds and self._should_fire(job, now):
                result = await self._execute_job(job)
                self._results.append(result)

    def _should_fire(self, job: CronJob, now: float) -> bool:
        return True

    async def _execute_job(self, job: CronJob) -> JobResult:
        started = time.time()
        logger.info("Executing cron job: %s", job.name)
        try:
            handler = self._handlers.get(job.id)
            if handler:
                result = await handler(job)
            else:
                result = JobResult(
                    job_id=job.id,
                    status=JobStatus.SUCCESS,
                    output="Job completed (no handler)",
                )
        except asyncio.TimeoutError:
            result = JobResult(job_id=job.id, status=JobStatus.TIMEOUT, error="Hard timeout")
        except Exception as e:
            logger.error("Job %s failed: %s", job.name, e)
            result = JobResult(job_id=job.id, status=JobStatus.FAILED, error=str(e))

        result.started_at = started
        result.finished_at = time.time()
        return result

    async def _persist(self) -> None:
        if not self._persist_path:
            return
        data = []
        for job in self._jobs.values():
            data.append({
                "id": job.id,
                "name": job.name,
                "expression": job.expression,
                "interval_seconds": job.interval_seconds,
                "recurring": job.recurring,
                "description": job.description,
                "skills": job.skills,
                "model_override": job.model_override,
                "workdir": job.workdir,
            })
        self._persist_path.parent.mkdir(parents=True, exist_ok=True)
        self._persist_path.write_text(json.dumps(data, indent=2))

    async def _load_persisted(self) -> None:
        if not self._persist_path or not self._persist_path.exists():
            return
        data = json.loads(self._persist_path.read_text())
        for d in data:
            job = CronJob(**d)
            self._jobs[job.id] = job
