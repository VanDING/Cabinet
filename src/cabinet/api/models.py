from __future__ import annotations

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=10000)
    captain_id: str = Field("captain", min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")


class ChatResponse(BaseModel):
    response: str
    captain_id: str


class EmployeeCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    role: str = Field(..., min_length=1, max_length=256)
    personality: str = Field("", max_length=2000)
    kind: str = "ai"


class EmployeeResponse(BaseModel):
    id: str
    name: str
    role: str
    kind: str
    skills: list[str]


class SkillRunRequest(BaseModel):
    inputs: dict[str, str] = {}


class SkillRunResponse(BaseModel):
    skill_name: str
    output: str


class KnowledgeIndexRequest(BaseModel):
    path: str


class KnowledgeQueryRequest(BaseModel):
    question: str
    top_k: int = Field(3, ge=1, le=50)


class KnowledgeQueryResponse(BaseModel):
    results: list[dict]


class MeetingRequest(BaseModel):
    topic: str
    level: str = "multi_party"


class DecisionRequest(BaseModel):
    title: str
    decision_type: str = "strategic"
    options: list[dict] = []


class TaskRequest(BaseModel):
    description: str
    inputs: dict[str, str] = {}


class StrategyRequest(BaseModel):
    proposal: str


class ReviewRequest(BaseModel):
    project_id: str | None = None
    review_type: str = "project_review"


class ErrorResponse(BaseModel):
    error: str
    detail: str | None = None


class ComponentHealth(BaseModel):
    name: str
    status: str
    detail: str = ""
    latency_ms: float = 0.0


class HealthResponse(BaseModel):
    status: str
    version: str
    components: list[ComponentHealth]
    uptime_seconds: float
