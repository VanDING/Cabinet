from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum
from uuid import uuid4


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    TIMEOUT = "timeout"


@dataclass
class CronJob:
    name: str
    expression: str = ""
    interval_seconds: int | None = None
    recurring: bool = True
    id: str = field(default_factory=lambda: uuid4().hex[:12])
    description: str = ""
    skills: list[str] = field(default_factory=list)
    model_override: str | None = None
    workdir: str | None = None

    DURATION_RE = re.compile(r"^(\d+)\s*(s|m|h|d)$")
    EVERY_RE = re.compile(r"every\s+(\w+)\s+(\d+)(am|pm)?", re.IGNORECASE)

    @classmethod
    def from_natural(cls, name: str, schedule: str) -> CronJob:
        job = cls(name=name)
        schedule = schedule.strip()

        m = cls.DURATION_RE.match(schedule)
        if m:
            value = int(m.group(1))
            unit = m.group(2)
            multipliers = {"s": 1, "m": 60, "h": 3600, "d": 86400}
            job.interval_seconds = value * multipliers[unit]
            return job

        m = cls.EVERY_RE.search(schedule)
        if m:
            multiplier = 86400
            if "hour" in m.group(1).lower():
                multiplier = 3600
            elif "min" in m.group(1).lower():
                multiplier = 60
            job.interval_seconds = int(m.group(2)) * multiplier
            return job

        if re.match(r"^[\d\s\*/,-]+$", schedule) and len(schedule.split()) == 5:
            job.expression = schedule
            return job

        if re.match(r"^\d{4}-\d{2}-\d{2}", schedule):
            job.expression = schedule
            job.recurring = False
            return job

        job.expression = schedule
        return job


@dataclass
class JobResult:
    job_id: str
    status: JobStatus
    output: str = ""
    error: str = ""
    started_at: float = 0.0
    finished_at: float = 0.0
