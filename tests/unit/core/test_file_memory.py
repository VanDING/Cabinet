from __future__ import annotations

from cabinet.core.memory.file_store import FileMemoryItem, FileMemoryStore


def test_file_memory_item_from_file(tmp_path):
    md_file = tmp_path / "test.md"
    md_file.write_text("""---
name: my-memory
description: Test memory entry
type: user
---

This is the **content** body.
""", encoding="utf-8")

    item = FileMemoryItem.from_file(md_file)
    assert item.name == "my-memory"
    assert item.description == "Test memory entry"
    assert item.type == "user"
    assert "**content**" in item.content
    assert item.filepath == md_file


def test_file_memory_item_from_file_no_frontmatter(tmp_path):
    md_file = tmp_path / "plain.md"
    md_file.write_text("Just plain content, no frontmatter.", encoding="utf-8")

    item = FileMemoryItem.from_file(md_file)
    assert item.name == "plain"
    assert item.content == "Just plain content, no frontmatter."


def test_file_memory_item_to_markdown():
    item = FileMemoryItem(
        name="my-memory",
        description="A test item",
        type="user",
        content="Body text here.",
    )
    md = item.to_markdown()
    assert "---" in md
    assert "name: my-memory" in md
    assert "description: A test item" in md
    assert "type: user" in md
    assert "Body text here." in md


def test_file_store_and_retrieve(tmp_path):
    store = FileMemoryStore(str(tmp_path))
    item = FileMemoryItem(
        name="role",
        description="User's role",
        type="user",
        content="The user is a **senior engineer**.",
    )
    filepath = store.store_file_item(item)
    assert filepath.exists()
    assert filepath.suffix == ".md"

    retrieved = store.get("role", "user")
    assert retrieved is not None
    assert retrieved.name == "role"
    assert "senior engineer" in retrieved.content


def test_file_list_headers(tmp_path):
    store = FileMemoryStore(str(tmp_path))
    store.store_file_item(FileMemoryItem("a", "First", "user", "content A"))
    store.store_file_item(FileMemoryItem("b", "Second", "project", "content B"))

    headers = store.list_headers()
    assert len(headers) == 2
    names = {h["name"] for h in headers}
    assert names == {"a", "b"}


def test_file_list_headers_excludes_memory_index(tmp_path):
    store = FileMemoryStore(str(tmp_path))
    store.store_file_item(FileMemoryItem("test", "desc", "user", "body"))
    store._rebuild_index()

    headers = store.list_headers()
    names = {h["name"] for h in headers}
    assert "MEMORY" not in names


def test_file_delete(tmp_path):
    store = FileMemoryStore(str(tmp_path))
    store.store_file_item(FileMemoryItem("temp", "Temporary", "user", "content"))

    store.delete_file_item("temp", "user")
    assert store.get("temp", "user") is None


def test_file_get_nonexistent(tmp_path):
    store = FileMemoryStore(str(tmp_path))
    assert store.get("nonexistent", "user") is None


def test_file_rebuild_index(tmp_path):
    store = FileMemoryStore(str(tmp_path))
    store.store_file_item(FileMemoryItem("alpha", "First item", "user", "body1"))
    store.store_file_item(FileMemoryItem("beta", "Second item", "project", "body2"))

    index = store.base_dir / "MEMORY.md"
    assert index.exists()
    index_content = index.read_text(encoding="utf-8")
    assert "alpha" in index_content
    assert "beta" in index_content
    assert "First item" in index_content


def test_file_list_headers_empty_dir(tmp_path):
    store = FileMemoryStore(str(tmp_path / "nonexistent"))
    assert store.list_headers() == []
