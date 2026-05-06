from __future__ import annotations


def test_load_all_migrations_returns_list():
    from cabinet.core.events.migrations.loader import load_all_migrations

    migrations = load_all_migrations()
    assert isinstance(migrations, list)
    assert len(migrations) >= 1
    assert migrations[0].version == 1


def test_load_all_migrations_first_is_v001():
    from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema
    from cabinet.core.events.migrations.loader import load_all_migrations

    migrations = load_all_migrations()
    assert isinstance(migrations[0], V001InitialSchema)
