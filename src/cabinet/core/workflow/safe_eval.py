from __future__ import annotations

import ast
import operator

_SAFE_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
    ast.And: lambda a, b: a and b,
    ast.Or: lambda a, b: a or b,
    ast.USub: operator.neg,
    ast.Not: operator.not_,
    ast.In: lambda a, b: a in b,
    ast.NotIn: lambda a, b: a not in b,
}


def safe_eval(expr: str, context_data: dict):
    try:
        tree = ast.parse(expr, mode="eval")
        return _eval_node(tree.body, context_data)
    except Exception:
        return None


def _eval_node(node, context_data):
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        if node.id == "context" and "context" not in context_data:
            return context_data
        return context_data.get(node.id)
    if isinstance(node, ast.Attribute):
        value = _eval_node(node.value, context_data)
        if isinstance(value, dict):
            return value.get(node.attr)
        return getattr(value, node.attr, None)
    if isinstance(node, ast.Subscript):
        value = _eval_node(node.value, context_data)
        key = _eval_node(node.slice, context_data)
        if isinstance(value, (dict, list)):
            return value[key] if key is not None else None
        return None
    if isinstance(node, ast.BoolOp):
        if isinstance(node.op, ast.And):
            result = True
            for val in node.values:
                result = _eval_node(val, context_data)
                if not result:
                    return result
            return result
        else:
            result = False
            for val in node.values:
                result = _eval_node(val, context_data)
                if result:
                    return result
            return result
    if isinstance(node, ast.UnaryOp):
        operand = _eval_node(node.operand, context_data)
        op_func = _SAFE_OPS.get(type(node.op))
        if op_func:
            return op_func(operand)
        return None
    if isinstance(node, ast.Compare):
        left = _eval_node(node.left, context_data)
        for op, comparator in zip(node.ops, node.comparators):
            right = _eval_node(comparator, context_data)
            op_func = _SAFE_OPS.get(type(op))
            if op_func is None:
                return None
            if not op_func(left, right):
                return False
            left = right
        return True
    if isinstance(node, ast.BinOp):
        left = _eval_node(node.left, context_data)
        right = _eval_node(node.right, context_data)
        op_func = _SAFE_OPS.get(type(node.op))
        if op_func:
            return op_func(left, right)
        return None
    if isinstance(node, ast.List):
        return [_eval_node(e, context_data) for e in node.elts]
    if isinstance(node, ast.Tuple):
        return tuple(_eval_node(e, context_data) for e in node.elts)
    if isinstance(node, ast.IfExp):
        test = _eval_node(node.test, context_data)
        if test:
            return _eval_node(node.body, context_data)
        return _eval_node(node.orelse, context_data)
    if isinstance(node, ast.Call):
        return None
    return None
