from __future__ import annotations

from cabinet.core.harness.models import EscalationVerdict
from cabinet.models.decisions import Decision, DecisionStatus, DecisionType
from cabinet.rooms.decision.models import AuthorizationRule


class DefaultEscalationProtocol:
    def __init__(self, rules: list[AuthorizationRule]):
        self._rules = rules

    async def should_escalate(self, decision: Decision) -> EscalationVerdict:
        if decision.decision_type == DecisionType.STRATEGIC:
            return EscalationVerdict(
                escalate=True,
                reason="Strategic decisions always require Captain",
            )

        if decision.decision_type == DecisionType.ANOMALY:
            return EscalationVerdict(
                escalate=True,
                reason="Anomaly decisions require Captain attention",
            )

        matched_rule = self._find_rule(decision)
        if matched_rule is not None:
            if matched_rule.auto_approve:
                return EscalationVerdict(
                    escalate=False,
                    reason="Matches auto-approve authorization rule",
                    auto_action="auto_approve",
                )
            if matched_rule.notify_only:
                return EscalationVerdict(
                    escalate=False,
                    reason="Matches notify-only rule, Captain notified after execution",
                    auto_action="notify_after",
                )

        if decision.decision_type == DecisionType.EVOLUTION:
            return EscalationVerdict(
                escalate=False,
                reason="Evolution decisions can be auto-handled with notification",
                auto_action="notify_after",
            )

        return EscalationVerdict(
            escalate=True,
            reason=f"No matching authorization rule for {decision.decision_type.value} decision",
        )

    async def auto_handle(self, decision: Decision) -> Decision:
        return decision.model_copy(update={"status": DecisionStatus.APPROVED})

    def _find_rule(self, decision: Decision) -> AuthorizationRule | None:
        for rule in self._rules:
            if (
                rule.decision_type == decision.decision_type
                and rule.captain_id == decision.captain_id
            ):
                return rule
        return None
