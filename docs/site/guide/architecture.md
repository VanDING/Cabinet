# Architecture

Cabinet is organized into 4 layers:

| Layer          | Packages                                        | Purpose                        |
| :------------- | :---------------------------------------------- | :----------------------------- |
| Infrastructure | types, events, storage                          | Type system, event bus, SQLite |
| Agent Core     | gateway, agent, memory                          | LLM gateway, TAOR loop, memory |
| Business       | decision, secretary, meeting, workflow, harness | Core capabilities              |
| Interface      | ui, server, desktop                             | Components, API, desktop app   |

Dependencies flow strictly upward. Lower layers never depend on upper layers.
