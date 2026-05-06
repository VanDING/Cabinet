from __future__ import annotations

import json
import logging
import re

from pydantic import BaseModel

logger = logging.getLogger(__name__)


class StructuredOutputConfig(BaseModel):
    schema_type: str = "json"
    schema_def: dict | None = None
    pydantic_model: str | None = None


class StructuredOutputParser:
    def parse(self, content: str, config: StructuredOutputConfig) -> dict:
        result = self._try_direct_json(content)
        if result is not None:
            return result
        result = self._try_code_block_json(content)
        if result is not None:
            return result
        result = self._try_embedded_json(content)
        if result is not None:
            return result
        return {"raw_content": content}

    def validate(self, data: dict, schema: dict) -> dict:
        try:
            import jsonschema
            jsonschema.validate(instance=data, schema=schema)
            return data
        except ImportError:
            required = schema.get("required", [])
            missing = [f for f in required if f not in data]
            if missing:
                return {"error": f"Missing required fields: {missing}", "data": data}
            return data
        except Exception as e:
            return {"error": str(e), "data": data}

    def _try_direct_json(self, content: str) -> dict | None:
        try:
            result = json.loads(content.strip())
            if isinstance(result, dict):
                return result
        except (json.JSONDecodeError, TypeError):
            pass
        return None

    def _try_code_block_json(self, content: str) -> dict | None:
        pattern = r"```(?:json)?\s*\n?(.*?)\n?```"
        matches = re.findall(pattern, content, re.DOTALL)
        for match in matches:
            try:
                result = json.loads(match.strip())
                if isinstance(result, dict):
                    return result
            except (json.JSONDecodeError, TypeError):
                continue
        return None

    def _try_embedded_json(self, content: str) -> dict | None:
        pattern = r"\{[^{}]*\}"
        matches = re.finditer(pattern, content)
        for match in matches:
            try:
                result = json.loads(match.group())
                if isinstance(result, dict):
                    return result
            except (json.JSONDecodeError, TypeError):
                continue
        return None
