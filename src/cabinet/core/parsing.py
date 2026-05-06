from __future__ import annotations

import re
from typing import TypeVar, Type

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


def extract_json_block(content: str) -> str:
    match = re.search(r"```json\s*(.*?)\s*```", content, re.DOTALL)
    if match:
        return match.group(1)
    match = re.search(r"\{.*\}", content, re.DOTALL)
    if match:
        return match.group(0)
    match = re.search(r"\[.*\]", content, re.DOTALL)
    if match:
        return match.group(0)
    raise ValueError("No JSON found in LLM output")


def parse_llm_json(content: str, model_class: Type[T]) -> T | None:
    try:
        json_str = extract_json_block(content)
        return model_class.model_validate_json(json_str)
    except Exception:
        return None


class AuthorizationCheckResult(BaseModel):
    auto_process: bool
    reason: str = ""


class CascadeOutput(BaseModel):
    titles: list[str] = []


class PermissionCheckResult(BaseModel):
    allowed: bool
    level: str = "L1"


class BlueprintValidationResult(BaseModel):
    is_valid: bool
    notes: list[str] = []


class BlueprintOutput(BaseModel):
    domains: list[str] = []
    constraints: list[str] = []
    criteria: list[str] = []


class InsightItem(BaseModel):
    content: str
    insight_type: str = "observation"
    confidence: float = 0.7


class InsightsOutput(BaseModel):
    insights: list[InsightItem] = []


class TreeNode(BaseModel):
    label: str
    node_type: str = "branch"
    children: list[TreeNode] = []


class DecisionTreeOutput(BaseModel):
    root_label: str = "project root"
    children: list[TreeNode] = []


class SuggestionItem(BaseModel):
    description: str
    category: str = "workflow"
    impact: str = "medium"
    effort: str = "low"


class SuggestionsOutput(BaseModel):
    suggestions: list[SuggestionItem] = []


class AuditOutput(BaseModel):
    total_decisions: int = 0
    manually_approved: int = 0
    could_auto_process: int = 0
    suggestion: str = ""
