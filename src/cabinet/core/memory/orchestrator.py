from __future__ import annotations

from dataclasses import dataclass, field

from cabinet.core.memory.scoring import MemoryScorer, MemoryScore
from cabinet.models.primitives import MemoryScope


@dataclass
class AssembledContext:
    long_term: list[MemoryScore] = field(default_factory=list)
    project: list[MemoryScore] = field(default_factory=list)
    session_summary: str | None = None
    user_profile: str = ""
    combined_text: str = ""


class MemoryOrchestrator:
    """Aggregate memories from multiple backends, deduplicate, rank, and assemble."""

    def __init__(self, backends: list, scorer: MemoryScorer | None = None):
        self._backends = backends
        self._scorer = scorer or MemoryScorer()

    async def assemble_context(self, query: str, employee_id: str,
                               project_id: str | None = None,
                               user_profile_injector=None,
                               captain_id: str = "") -> AssembledContext:
        all_items = []
        for backend in self._backends:
            try:
                items = await backend.search(employee_id, MemoryScope.LONG_TERM, limit=10)
                all_items.extend(items)
                if project_id:
                    p_items = await backend.search(project_id, MemoryScope.LONG_TERM, limit=5)
                    all_items.extend(p_items)
            except Exception:
                continue

        # Deduplicate by first 100 chars
        seen = set()
        unique = []
        for item in all_items:
            h = hash(item.content[:100])
            if h not in seen:
                seen.add(h)
                unique.append(item)

        # Score and rank
        scored = self._scorer.score(unique, query)

        # Separate personal vs project
        long_term = [s for s in scored if s.item.owner_id == employee_id]
        project = [s for s in scored if s.item.owner_id != employee_id]

        # Build combined text
        parts = []
        if long_term:
            top = [s for s in long_term[:3] if s.score >= MemoryScorer.MIN_SCORE]
            if top:
                parts.append("## Relevant Memories\n" + "\n".join(
                    f"- {s.item.content}" for s in top
                ))
        if project:
            top = [s for s in project[:3] if s.score >= MemoryScorer.MIN_SCORE]
            if top:
                parts.append("## Project Context\n" + "\n".join(
                    f"- {s.item.content}" for s in top
                ))

        user_profile_text = ""
        if user_profile_injector and captain_id:
            try:
                user_profile_text = user_profile_injector.build_context(captain_id)
            except Exception:
                pass

        return AssembledContext(
            long_term=long_term,
            project=project,
            user_profile=user_profile_text,
            combined_text="\n\n".join(parts),
        )
