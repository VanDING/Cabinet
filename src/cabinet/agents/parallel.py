from __future__ import annotations

import asyncio
from dataclasses import dataclass, field


@dataclass
class AgentTask:
    agent: object
    task: str
    role_label: str = ""


@dataclass
class SynthesizedResult:
    summary: str
    individual_results: list[dict] = field(default_factory=list)
    consensus: str | None = None
    disagreements: list[str] = field(default_factory=list)


class ParallelExecutor:
    """Fan-out tasks to multiple agents concurrently, fan-in via LLM synthesis."""

    def __init__(self, synthesizer_gateway, model: str = "default"):
        self._gateway = synthesizer_gateway
        self._model = model

    async def execute_parallel(self, tasks: list[AgentTask]) -> SynthesizedResult:
        if not tasks:
            return SynthesizedResult(summary="", individual_results=[])

        async def _run(task: AgentTask) -> dict:
            try:
                output = await task.agent.execute(task.task, None)
                return {
                    "role": task.role_label,
                    "task": task.task,
                    "content": output.content if hasattr(output, 'content') else str(output),
                    "status": output.status if hasattr(output, 'status') else "success",
                }
            except Exception as e:
                return {
                    "role": task.role_label,
                    "task": task.task,
                    "content": str(e),
                    "status": "error",
                }

        raw = await asyncio.gather(*[_run(t) for t in tasks], return_exceptions=True)

        results = []
        for i, r in enumerate(raw):
            if isinstance(r, Exception):
                results.append({
                    "role": tasks[i].role_label,
                    "task": tasks[i].task,
                    "content": str(r),
                    "status": "error",
                })
            else:
                results.append(r)

        synthesis = await self._synthesize(results)
        synthesis.individual_results = results
        return synthesis

    async def _synthesize(self, results: list[dict]) -> SynthesizedResult:
        parts = []
        for r in results:
            parts.append(f"[{r['role']}] ({r['status']}): {r['content'][:300]}")

        response = await self._gateway.complete(
            messages=[{
                "role": "system",
                "content": "Synthesize the following agent outputs. Identify consensus points, note disagreements, and produce a unified summary. Be concise.",
            }, {
                "role": "user",
                "content": "Agent outputs:\n\n" + "\n\n".join(parts),
            }],
            model=self._model,
            temperature=0.3,
        )

        summary = response.content if hasattr(response, 'content') else str(response)
        disagreements = []
        if "disagree" in summary.lower() or "不同意" in summary:
            disagreements = ["Multiple viewpoints exist"]

        return SynthesizedResult(summary=summary, disagreements=disagreements)
