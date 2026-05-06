from __future__ import annotations


from cabinet.agents.structured import StructuredOutputConfig, StructuredOutputParser


def test_parse_direct_json():
    parser = StructuredOutputParser()
    result = parser.parse('{"name": "test", "value": 42}', StructuredOutputConfig())
    assert result == {"name": "test", "value": 42}


def test_parse_json_in_code_block():
    parser = StructuredOutputParser()
    content = '```json\n{"name": "test", "value": 42}\n```'
    result = parser.parse(content, StructuredOutputConfig())
    assert result == {"name": "test", "value": 42}


def test_parse_json_without_language_tag():
    parser = StructuredOutputParser()
    content = '```\n{"name": "test"}\n```'
    result = parser.parse(content, StructuredOutputConfig())
    assert result == {"name": "test"}


def test_parse_embedded_json():
    parser = StructuredOutputParser()
    content = 'The result is {"name": "test", "value": 42} as shown'
    result = parser.parse(content, StructuredOutputConfig())
    assert result == {"name": "test", "value": 42}


def test_parse_fallback_to_raw_content():
    parser = StructuredOutputParser()
    result = parser.parse("Just plain text", StructuredOutputConfig())
    assert result == {"raw_content": "Just plain text"}


def test_validate_with_schema():
    parser = StructuredOutputParser()
    schema = {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}
    result = parser.validate({"name": "test"}, schema)
    assert result["name"] == "test"


def test_validate_missing_required():
    parser = StructuredOutputParser()
    schema = {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}
    result = parser.validate({"value": 42}, schema)
    assert "error" in result
