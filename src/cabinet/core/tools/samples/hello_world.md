# hello_world

---
name: hello_world
description: A simple greeting skill
input_schema:
  type: object
  properties:
    name:
      type: string
      description: Name to greet
  required:
    - name
output_schema:
  type: object
  properties:
    greeting:
      type: string
requires_human_approval: false
---

Say hello to {name} in a friendly and professional manner.
