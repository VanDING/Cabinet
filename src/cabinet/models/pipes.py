# src/cabinet/models/pipes.py
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> UUID:
    return uuid.uuid4()


class ReasoningStrategy(BaseModel):
    """推理策略 — Pipe 自带的行为配置"""
    temperature: float = 0.3
    max_tokens: int | None = None
    reasoning_effort: Literal["low", "medium", "high"] | None = None
    chain_of_thought: bool = False
    stop_sequences: list[str] = []


class Pipe(BaseModel):
    """行为管道 — 面向系统，可独立测试和社区分享"""
    id: UUID = Field(default_factory=_uuid)
    name: str
    description: str
    kind: Literal["atomic", "composite"]
    system_prompt: str
    tool_ids: list[UUID] = []
    reasoning: ReasoningStrategy = Field(default_factory=ReasoningStrategy)
    input_schema: dict = {}
    output_schema: dict = {}
    metadata: dict = {}
    version: int = 1
    created_at: datetime = Field(default_factory=_now)


class Persona(BaseModel):
    """人格外衣 — 面向 Captain，长期积累协作记忆"""
    id: UUID = Field(default_factory=_uuid)
    name: str
    expertise: list[str] = []
    traits: dict = {}
    collaboration_summary: dict = {}
    memory_refs: list[UUID] = []
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)
