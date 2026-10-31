"""Coding practice problems: the model's draft, validated and normalised. Nothing here executes model code;
the browser runs reference solutions and user code in Web Workers."""

import ast
import json
import re

from jivika.schemas import CodingProblemDraft

_IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,59}")
_DATA_ROLE = re.compile(
    r"\b(data|analyst|analytics|analytic|sql|bi|business intelligence|etl|warehouse|reporting|tableau|power bi|"
    r"statistic\w*|insights?)\b", re.I,
)
_PY_DEF = re.compile(r"^\s*def\s+([A-Za-z_]\w*)\s*\(", re.M)
_JS_DEF = re.compile(r"\bfunction\s+([A-Za-z_$][\w$]*)\s*\(|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=")
MIN_TESTS, MAX_TESTS = 3, 8


def focus(job_description: str) -> str:
    """'data' for analyst, BI and data roles (SQL plus pandas-free Python data problems), else 'software' (DS&A).
    Read from the start of the job description, where the title and summary usually are."""
    head = job_description[:600]
    return "data" if len(_DATA_ROLE.findall(head)) >= 2 or re.search(r"\bdata\b", head[:120], re.I) else "software"


def focus_brief(kind: str, languages: list[str], count: int) -> str:
    sql = "SQL problems (joins, aggregation, window functions, deduplication, date handling)"
    python = "Python data-manipulation problems on lists of records and dictionaries, without pandas"
    dsa = "data structures and algorithms problems (arrays, strings, hash maps, two pointers, stacks, trees, graphs, dynamic programming)"
    functions = [lang for lang in languages if lang != "sql"]
    if not functions:
        mix = f"{sql} only"
    elif kind == "data":
        mix = f"about half {sql} and the rest {python}" if "sql" in languages else python
    else:
        mix = f"mostly {dsa}, with at most one of the {sql}" if "sql" in languages else dsa
    return f"Write exactly {count} problems: {mix}. Allowed languages: {', '.join(languages)}."


def snake(name: str) -> str:
    name = re.sub(r"(?<=[a-z0-9])([A-Z])", r"_\1", name.strip())
    return re.sub(r"_+", "_", re.sub(r"[^A-Za-z0-9_]", "_", name)).strip("_").lower()


def camel(name: str) -> str:
    head, *rest = snake(name).split("_")
    return head + "".join(w[:1].upper() + w[1:] for w in rest)


def _json(value, *, want_list: bool = False):
    """A JSON value from the model (already parsed, or a JSON string). Raises ValueError when malformed."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            if want_list:
                raise
    if want_list and not isinstance(value, list):
        raise ValueError("expected a JSON array")
    json.dumps(value, allow_nan=False)  # NaN or Infinity cannot round-trip
    return value


def _dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def _lines(values: list[str], limit: int, size: int = 400) -> list[str]:
    return [v.strip()[:size] for v in values if v and v.strip()][:limit]


def _arity(code: str, name: str) -> tuple[int, int] | None:
    """(required, maximum) positional arguments of a Python function, read with ast (parsed, never run).
    None when unknown (syntax error, *args, or not found)."""
    try:
        tree = ast.parse(code)
    except (SyntaxError, ValueError):
        return None
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == name and not node.args.vararg:
            total = len(node.args.posonlyargs) + len(node.args.args)
            return total - len(node.args.defaults), total
    return None


def _starter_py(name: str, params: list[str]) -> str:
    return f"def {name}({', '.join(params)}):\n    # Write your solution here\n    pass\n"


def _starter_js(name: str, params: list[str]) -> str:
    return f"function {name}({', '.join(params)}) {{\n  // Write your solution here\n}}\n"


def _sql_problem(draft: CodingProblemDraft) -> dict | None:
    sql = draft.sql
    if not sql or "create table" not in sql.setup.lower() or not draft.solution or not draft.solution.code.strip():
        return None
    try:
        rows = _json(sql.expected_rows, want_list=True)
    except ValueError:
        return None
    if not all(isinstance(r, list) for r in rows):
        return None
    return {
        "languages": ["sql"],
        "function_name": "",
        "function_names": {"python": "", "javascript": ""},
        "starter": {"sql": draft.starter.get("sql") or "-- Write your query here\nSELECT\n"},
        "tests": [],
        "sql": {"setup": sql.setup.strip(), "expected_rows": _dumps(rows), "order_matters": bool(sql.order_matters)},
        "solution": {"language": "sql", "code": draft.solution.code.strip()},
    }


def _function_problem(draft: CodingProblemDraft, languages: list[str]) -> dict | None:
    solution = draft.solution
    if not solution or solution.language not in ("python", "javascript") or not solution.code.strip():
        return None
    # The reference solution's own function name wins, so the starter, tests and solution agree.
    found = (_PY_DEF if solution.language == "python" else _JS_DEF).search(solution.code)
    name = (next((g for g in found.groups() if g), "") if found else "") or draft.function_name.strip()
    if not _IDENT.fullmatch(name or ""):
        return None
    py_name, js_name = snake(name), camel(name)
    if not _IDENT.fullmatch(py_name) or not _IDENT.fullmatch(js_name):
        return None
    params = [snake(p) for p in draft.params if _IDENT.fullmatch(snake(p) or "")][:8]
    arity = _arity(solution.code, name) if solution.language == "python" else None
    tests = []
    for test in draft.tests:
        try:
            args, expected = _json(test.args, want_list=True), _json(test.expected)
        except (ValueError, TypeError):
            continue
        if arity and not arity[0] <= len(args) <= arity[1]:
            continue  # one element per parameter, so a wrong count means a malformed test
        tests.append({"args": _dumps(args), "expected": _dumps(expected)})
    tests = list({t["args"]: t for t in tests}.values())[:MAX_TESTS]  # one expectation per input
    if len(tests) < MIN_TESTS:
        return None
    langs = [lang for lang in ("python", "javascript") if lang in languages]
    if not langs:
        return None
    py_starter, js_starter = draft.starter.get("python", ""), draft.starter.get("javascript", "")
    starter = {
        "python": (py_starter if re.search(rf"\bdef\s+{py_name}\s*\(", py_starter) else _starter_py(py_name, params)) if "python" in langs else None,
        "javascript": (js_starter if re.search(rf"\b{js_name}\b", js_starter) else _starter_js(js_name, [camel(p) for p in params])) if "javascript" in langs else None,
        "sql": None,
    }
    return {
        "languages": langs,
        "function_name": py_name,
        "function_names": {"python": py_name, "javascript": js_name},
        "starter": starter,
        "tests": tests,
        "sql": None,
        "solution": {"language": solution.language, "code": solution.code.strip()},
    }


def build(drafts: list[CodingProblemDraft], languages: list[str], count: int) -> list[dict]:
    """Valid problems in the requested languages (malformed ones dropped), at most count, with unique ids."""
    out, ids = [], set()
    for draft in drafts:
        title, statement = " ".join(draft.title.split())[:120], draft.statement.strip()
        if not title or not statement:
            continue
        is_sql = draft.language == "sql" or (draft.sql is not None and draft.sql.setup.strip() and not draft.tests)
        if is_sql and "sql" not in languages:
            continue
        body = _sql_problem(draft) if is_sql else _function_problem(draft, languages)
        if body is None:
            continue
        base = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:60] or "problem"
        pid, n = base, 2
        while pid in ids:
            pid, n = f"{base}-{n}", n + 1
        ids.add(pid)
        out.append({
            "id": pid,
            "title": title,
            "difficulty": draft.difficulty if draft.difficulty in ("easy", "medium", "hard") else "medium",
            "topic": " ".join(draft.topic.split())[:60],
            "statement": statement[:6000],
            "examples": [e.model_dump() for e in draft.examples[:4]],
            "constraints": _lines(draft.constraints, 8),
            "hints": _lines(draft.hints, 3),
            **body,
            "practice_queries": [q.model_dump() for q in draft.practice_queries[:2]]
            or [{"query": f"{draft.topic or title} practice problems"[:80], "kind": "practice"}],
        })
        if len(out) == count:
            break
    return out
