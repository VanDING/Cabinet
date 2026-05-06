from cabinet.cli.commands.init_cmd import register as register_init
from cabinet.cli.commands.serve_cmd import register as register_serve
from cabinet.cli.commands.chat_cmd import register as register_chat
from cabinet.cli.commands.config_cmd import register as register_config
from cabinet.cli.commands.employee_cmd import register as register_employee
from cabinet.cli.commands.skill_cmd import register as register_skill
from cabinet.cli.commands.knowledge_cmd import register as register_knowledge
from cabinet.cli.commands.db_cmd import register as register_db
from cabinet.cli.commands.backup_cmd import register as register_backup
from cabinet.cli.commands.workflow_cmd import register as register_workflow
from cabinet.cli.commands.agent_cmd import register as register_agent


def register_all(app):
    register_init(app)
    register_serve(app)
    register_chat(app)
    register_config(app)
    register_employee(app)
    register_skill(app)
    register_knowledge(app)
    register_db(app)
    register_backup(app)
    register_workflow(app)
    register_agent(app)
