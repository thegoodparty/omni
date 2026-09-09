"""Subject-agnostic plumbing for a forced-tool-call LLM judge.

Extracted from instrumentation_gaps.py when event_anchors.py became a second caller
(DATA-2426 slice 3). Everything here is about *running* a judge safely — the budget, the
truncation trap, and the graceful boundary. What is being judged, and the prompt that
judges it, belongs to the caller.
"""

from __future__ import annotations

from typing import Callable, Sequence

OK_STATUSES = ("ok", "no-candidates")
NO_ITEMS_STATUS = "no-candidates"

# Output budget. Measured on the gap judge: 25 verdicts cost 4.1k-4.8k output tokens
# (~185/verdict, and it varies run to run), so a constant cap sized near that is fragile —
# the old 4096 overflowed by ~45 tokens and truncated silently for a month. Per-item
# instead, with ~2x headroom, so the budget tracks the batch; the ceiling keeps worst-case
# spend per call provable. max_tokens is only ever a ceiling: billing is on tokens emitted.
_FLOOR = 1024
_PER_ITEM = 400
_CEILING = 32_000


def max_tokens_for(count: int, *, floor: int = _FLOOR, per_item: int = _PER_ITEM,
                   ceiling: int = _CEILING) -> int:
    """The output cap for a batch of this size."""
    return min(floor + per_item * count, ceiling)


def make_anthropic_client(api_key: str):
    """Construct the Anthropic SDK client. Import is local so the module still imports when
    the dependency is absent and judgment is skipped."""
    import anthropic

    return anthropic.Anthropic(api_key=api_key)


def parse_tool_response(resp, item_ids: Sequence[str], *, id_field: str = "id",
                        results_field: str = "verdicts", noun: str = "items") -> dict[str, dict]:
    """Verdicts keyed by item id from a forced tool call, keeping only ids that were in the
    input (a hallucinated id is dropped, never trusted into state).

    Truncation is checked first and named explicitly. A max_tokens stop leaves the tool
    input incomplete, and reporting that as a schema error points the reader at the schema
    instead of the budget — read that way it once hid a month of un-judged candidates. A
    truncated response may also carry no complete tool_use block, so this precedes the
    block lookup. `noun` only varies the message text (e.g. "candidates") for a caller whose
    status string surfaces verbatim to a human.
    """
    if getattr(resp, "stop_reason", None) == "max_tokens":
        raise RuntimeError(
            f"judge response truncated at max_tokens ({len(item_ids)} {noun}): "
            "the verdict batch did not fit the output budget"
        )
    allowed = set(item_ids)
    for block in getattr(resp, "content", []) or []:
        if getattr(block, "type", None) == "tool_use":
            results = (block.input or {}).get(results_field, [])
            return {v[id_field]: v for v in results if v.get(id_field) in allowed}
    raise RuntimeError("no tool_use block in judge response")


def judge_batch(items: Sequence[dict], *, system: str, tool: dict, client, model: str,
                message_builder: Callable[[Sequence[dict]], list], max_tokens: int | None = None,
                id_field: str = "id", results_field: str = "verdicts",
                noun: str = "items") -> dict[str, dict]:
    """One batched judgment call. Client is injected so this is unit-testable without
    network. Forces the tool for a validated result."""
    resp = client.messages.create(
        model=model,
        max_tokens=max_tokens or max_tokens_for(len(items)),
        system=system,
        tools=[tool],
        tool_choice={"type": "tool", "name": tool["name"]},
        messages=message_builder(items),
    )
    return parse_tool_response(resp, [i[id_field] for i in items], id_field=id_field,
                               results_field=results_field, noun=noun)


def run_graceful(items: Sequence[dict], *, api_key: str | None, model: str, tool: dict,
                 message_builder: Callable[[Sequence[dict]], list],
                 system_factory: Callable[[], str], unavailable_status: str,
                 client_factory=make_anthropic_client,
                 id_field: str = "id", results_field: str = "verdicts",
                 noun: str = "items") -> tuple[dict[str, dict], str]:
    """Graceful boundary around a judge. Never raises: returns (verdicts_by_id, status).
    A missing key, an unreadable prompt source, an SDK/network error or a bad response all
    degrade to an empty result and a status string the caller reports — the run continues.

    system_factory gets its own try so an unreadable prompt source (OSError) reports
    `unavailable_status` specifically; any other exception from it — same as any exception
    from building the client or calling the judge — degrades to the generic `failed: ...`,
    never propagates.
    """
    if not items:
        return {}, NO_ITEMS_STATUS
    if not api_key:
        return {}, "skipped: ANTHROPIC_API_KEY unset"
    try:
        system = system_factory()
    except OSError:
        return {}, unavailable_status
    except Exception as exc:  # noqa: BLE001 — judgment must never break the governance run
        return {}, f"failed: {exc}"
    try:
        client = client_factory(api_key)
        verdicts = judge_batch(items, system=system, tool=tool, client=client, model=model,
                               message_builder=message_builder, id_field=id_field,
                               results_field=results_field, noun=noun)
    except Exception as exc:  # noqa: BLE001 — judgment must never break the governance run
        return {}, f"failed: {exc}"
    return verdicts, "ok"
