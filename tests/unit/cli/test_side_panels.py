from __future__ import annotations

import pytest
from textual.app import App

from cabinet.cli.widgets.side_panels import MeetingPanel, DecisionPanel, OfficePanel


@pytest.mark.asyncio
async def test_meeting_panel_update_state_with_topic():
    app = App()
    async with app.run_test() as pilot:
        panel = MeetingPanel()
        await pilot.app.mount(panel)
        panel.update_state(topic="Q3预算", advisors=3, round_num=2)
        # Should not raise


@pytest.mark.asyncio
async def test_meeting_panel_update_state_idle():
    app = App()
    async with app.run_test() as pilot:
        panel = MeetingPanel()
        await pilot.app.mount(panel)
        panel.update_state(topic="", advisors=0, round_num=0)


@pytest.mark.asyncio
async def test_decision_panel_update_state_active():
    app = App()
    async with app.run_test() as pilot:
        panel = DecisionPanel()
        await pilot.app.mount(panel)
        panel.update_state(red=2, yellow=1, blue=3)


@pytest.mark.asyncio
async def test_decision_panel_update_state_idle():
    app = App()
    async with app.run_test() as pilot:
        panel = DecisionPanel()
        await pilot.app.mount(panel)
        panel.update_state(red=0, yellow=0, blue=0)


@pytest.mark.asyncio
async def test_office_panel_update_state_with_workflow():
    app = App()
    async with app.run_test() as pilot:
        panel = OfficePanel()
        await pilot.app.mount(panel)
        panel.update_state(workflow="代码审查", progress=0.5, current_node="review")


@pytest.mark.asyncio
async def test_office_panel_update_state_idle():
    app = App()
    async with app.run_test() as pilot:
        panel = OfficePanel()
        await pilot.app.mount(panel)
        panel.update_state(workflow="", progress=0.0, current_node="")
