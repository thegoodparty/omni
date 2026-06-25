"""Red/green tests for the offline external-faithfulness checker (candidate Gate B3).

The contract: extract identity figures (money, percent, legal citation, date) from a
claim's text, normalize, and confirm each appears in the *cited source's* captured text.
This is the external check the rubric's Gate B2 explicitly does not do (B2 only compares a
claim to its own embedded source_extract, which an optimizer can fake on both sides).
"""
import json

import pytest

from faithfulness_check import (
    extract_identity_tokens,
    verify_claim,
    faithfulness_gate,
    _main,
)


def test_extracts_money_token():
    toks = extract_identity_tokens(
        "approved an initial residential program rate of $4.00 per month"
    )
    assert "$4.00" in toks


def test_true_money_figure_verified():
    r = verify_claim(
        "approved a rate of $4.00 per month",
        "Residential Customers: A fixed initial rate of $4.00 per month.",
    )
    assert r["verified"] is True
    assert r["missing"] == []


def test_fabricated_money_figure_caught():
    # The claim says $40.00; the captured source only ever said $4.00.
    # Internal-only B2 would pass this if the extract were also faked; B3 against the
    # real source must catch it.
    r = verify_claim(
        "approved a rate of $40.00 per month",
        "Residential Customers: A fixed initial rate of $4.00 per month.",
    )
    assert r["verified"] is False
    assert "$40.00" in r["missing"]


def test_thousands_separator_normalized():
    # Claim writes the comma, source omits it; normalization must reconcile $292,000 == $292000.
    r = verify_claim(
        "a side-by-side comparison ($292,000/year)",
        "the annual program cost is $292000 per year",
    )
    assert r["verified"] is True


def test_near_miss_money_not_falsely_verified():
    # Precision guard: a fabricated $40.00 must NOT verify against a source mentioning $14.00.
    r = verify_claim(
        "a rate of $40.00 per month",
        "a surcharge of $14.00 and a base of $4.00 apply",
    )
    assert r["verified"] is False
    assert "$40.00" in r["missing"]


def test_legal_citation_verified():
    r = verify_claim(
        "the statutory deadline (per Utah Code 54-17-903(3))",
        "as established in Utah Code 54-17-903(3), the program deadline is fixed",
    )
    assert r["verified"] is True


def test_money_matched_by_value_despite_format():
    # Claim "$950,000"; packet writes it bare with cents "950000.00". Same amount.
    r = verify_claim(
        "the project total cost is $950,000",
        "PROJECT LEDGER\n      950000.00 TOTAL AMOUNT",
    )
    assert r["verified"] is True


def test_small_money_not_value_matched_to_bare_number():
    # Precision guard: "$5" must NOT verify against an incidental "5" (e.g. a page number).
    r = verify_claim(
        "a filing fee of $5",
        "see page 5 of the staff report for details",
    )
    assert r["verified"] is False


def test_named_month_date_verified():
    r = verify_claim(
        "the statutory deadline to keep Kearns is June 2, 2026",
        "participants must respond on or before June 2, 2026 or be removed",
    )
    assert r["verified"] is True


def test_date_with_ordinal_suffix_in_source_verified():
    # Claim writes "May 13, 2026"; the packet writes "May 13th, 2026". Same date.
    r = verify_claim(
        "On May 13, 2026, the committee adopted the statement",
        "minutes of the meeting held on May 13th, 2026.",
    )
    assert r["verified"] is True


def test_vote_tally_not_extracted_as_legal_citation():
    # "15-9-1" is a vote tally, not a statute; it must not be pulled as an identity token.
    toks = extract_identity_tokens("recommended REFERRAL by a vote of 15-9-1")
    assert "15-9-1" not in toks


def test_real_legal_citation_with_cue_still_extracted():
    # Guard: a genuine citation (cued by "Code") must still be extracted.
    toks = extract_identity_tokens("the deadline per Utah Code 54-17-903(3) is fixed")
    assert any("54-17-903" in t for t in toks)


def _artifact(claim_text, snapshot):
    return {
        "items": [{"id": "i1", "tier": "featured"}],
        "claims": [
            {
                "claim_id": "c1",
                "item_id": "i1",
                "claim_text": claim_text,
                "claim_type": "budget",
                "required_source_type": "agenda_packet",
                "source_ids": ["s1"],
            }
        ],
        "sources": [
            {
                "id": "s1",
                "source_type": "agenda_packet",
                "retrieved_text_or_snapshot": snapshot,
            }
        ],
    }


def test_gate_dq_when_packet_claim_unverified():
    art = _artifact("rate of $40.00 per month", "A fixed initial rate of $4.00 per month.")
    res = faithfulness_gate(art)
    assert res["verdict"] == "DQ-faithfulness"
    assert any(c["claim_id"] == "c1" for c in res["unverified"])


def test_gate_pass_when_all_verified():
    art = _artifact("rate of $4.00 per month", "A fixed initial rate of $4.00 per month.")
    res = faithfulness_gate(art)
    assert res["verdict"] == "PASS"
    assert res["unverified"] == []
    assert res["coverage"] == 1.0


def test_gate_uses_injected_source_resolver_over_embedded_snapshot():
    # Gaming-resistant mode: the embedded snapshot is faked to $40.00, but the
    # resolver (standing in for the runner-persisted raw download) still says $4.00.
    art = _artifact("rate of $40.00 per month", "A fixed initial rate of $40.00 per month.")
    raw = {"s1": "A fixed initial rate of $4.00 per month."}
    res = faithfulness_gate(art, source_text_for=lambda sid: raw[sid])
    assert res["verdict"] == "DQ-faithfulness"


# --- audit gap closures: token types and gate population rules never exercised ---

def test_percent_token_extracted_and_verified():
    toks = extract_identity_tokens("turnout rose 12.5% year over year")
    assert "12.5%" in toks
    ok = verify_claim("turnout rose 12.5%", "the report shows 12.5% turnout")
    assert ok["verified"] and ok["missing"] == []
    bad = verify_claim("turnout rose 12.5%", "the report shows 21.5% turnout")
    assert bad["missing"] == ["12.5%"]


def test_near_miss_percent_not_falsely_verified():
    # Demonstrated defect: "2.5%" is a substring of "12.5%" after normalization, and
    # percents have no left anchor ($ anchors money). A fabricated percent must not
    # verify against a different figure that merely contains its digits.
    r = verify_claim("turnout fell 2.5%", "the report shows 12.5% turnout")
    assert r["verified"] is False
    assert "2.5%" in r["missing"]


def test_iso_date_extracted_and_verified():
    toks = extract_identity_tokens("the hearing is set for 2026-05-13")
    assert "2026-05-13" in toks
    ok = verify_claim("hearing on 2026-05-13", "scheduled 2026-05-13 in chambers")
    assert ok["verified"]


def test_gate_coverage_is_the_verified_fraction():
    art = _artifact("rate of $4.00 per month", "A fixed initial rate of $4.00 per month.")
    art["claims"].append({
        "claim_id": "c2", "item_id": "i1",
        "claim_text": "a new fee of $9.00 per month",  # NOT in the source
        "claim_type": "budget", "required_source_type": "agenda_packet",
        "source_ids": ["s1"],
    })
    res = faithfulness_gate(art)
    assert res["verdict"] == "DQ-faithfulness"
    assert res["checked"] == 2
    assert res["coverage"] == 0.5


def test_gate_with_zero_checkable_claims_passes_vacuously():
    # Explicit contract: no packet-sourced identity claims -> nothing to verify ->
    # PASS with coverage 1.0. (The eligibility gate, not this one, owns empty artifacts.)
    art = _artifact("we should consider the budget", "irrelevant")  # no identity tokens
    res = faithfulness_gate(art)
    assert res["verdict"] == "PASS"
    assert res["checked"] == 0
    assert res["coverage"] == 1.0


def test_gate_skips_claims_of_other_source_types():
    art = _artifact("rate of $4.00 per month", "A fixed initial rate of $4.00 per month.")
    art["claims"].append({
        "claim_id": "c2", "item_id": "i1",
        "claim_text": "news says it costs $99.00",  # would fail, but is news-sourced
        "claim_type": "budget", "required_source_type": "news",
        "source_ids": ["s1"],
    })
    res = faithfulness_gate(art)
    assert res["checked"] == 1  # only the packet claim
    assert res["verdict"] == "PASS"


def test_gate_concatenates_multiple_cited_sources():
    art = _artifact("rate of $4.00 per month", "this source never mentions the figure")
    art["sources"].append({
        "id": "s2", "source_type": "agenda_packet",
        "retrieved_text_or_snapshot": "the fixed rate is $4.00 per month",
    })
    art["claims"][0]["source_ids"] = ["s1", "s2"]  # token lives only in the SECOND source
    res = faithfulness_gate(art)
    assert res["verdict"] == "PASS"


def test_gate_resolver_verifies_true_from_raw_download():
    # Positive direction of gaming-resistant mode: the runner-persisted raw download
    # contains the figure, so the claim verifies even though the embedded snapshot
    # (agent-controlled, ignored in this mode) never mentions it. Guards against a
    # resolver wiring that "passes" the DQ test by resolving everything to empty.
    art = _artifact("rate of $4.00 per month", "embedded snapshot with no figures at all")
    raw = {"s1": "A fixed initial rate of $4.00 per month."}
    res = faithfulness_gate(art, source_text_for=lambda sid: raw[sid])
    assert res["verdict"] == "PASS"
    assert res["unverified"] == []
    assert res["checked"] == 1
    assert res["coverage"] == 1.0


def test_skippable_claims_listed_first_do_not_exempt_later_claims():
    # Mutation guard: every other fixture lists the skippable claim AFTER the checked
    # one, so a continue->break mutant on either skip path survives. Here the news
    # claim and a token-less packet claim come FIRST; the fabricated packet claim
    # after them must still be checked and DQ the artifact.
    art = _artifact("rate of $40.00 per month", "A fixed initial rate of $4.00 per month.")
    fabricated = art["claims"][0]
    art["claims"] = [
        {
            "claim_id": "c0", "item_id": "i1",
            "claim_text": "news says it costs $99.00",
            "claim_type": "budget", "required_source_type": "news",
            "source_ids": ["s1"],
        },
        {
            "claim_id": "c0b", "item_id": "i1",
            "claim_text": "the council will consider the budget",  # no identity tokens
            "claim_type": "budget", "required_source_type": "agenda_packet",
            "source_ids": ["s1"],
        },
        fabricated,
    ]
    res = faithfulness_gate(art)
    assert res["verdict"] == "DQ-faithfulness"
    assert res["checked"] == 1
    assert [u["claim_id"] for u in res["unverified"]] == ["c1"]


# --- CLI behavior: flag parsing and unreadable-artifact accounting ---

def test_gate_source_type_flag_without_value_exits_usage():
    # "--gate-source-type" as the LAST argument must exit with usage (2), not IndexError.
    with pytest.raises(SystemExit) as exc:
        _main(["some-dir", "--gate-source-type"])
    assert exc.value.code == 2


def test_main_surfaces_unreadable_artifacts_in_summary(tmp_path, capsys):
    # A file that fails to load must not silently shrink the coverage denominator:
    # it is reported to stderr and counted in the summary line.
    art = _artifact("rate of $4.00 per month", "A fixed initial rate of $4.00 per month.")
    art["briefing_status"] = "briefing_ready"
    (tmp_path / "good.json").write_text(json.dumps(art))
    (tmp_path / "garbage.json").write_text("{this is not json")
    _main([str(tmp_path)])
    cap = capsys.readouterr()
    assert "garbage.json" in cap.err
    assert "1 unreadable" in cap.out
    assert "gate: PASS 1" in cap.out


def _write(p, obj):
    import json as _json
    p.write_text(_json.dumps(obj))


def test_main_status_filter_is_configurable_per_experiment(tmp_path, capsys):
    # meeting_schedule artifacts have `status`, not `briefing_status`; the CLI must
    # be pointable at them instead of silently skipping everything.
    art = _artifact("rate of $4.00 per month", "A fixed initial rate of $4.00 per month.")
    art["status"] = "found"
    _write(tmp_path / "a.json", art)
    from faithfulness_check import _main
    _main([str(tmp_path), "--status-field", "status", "--ready-value", "found"])
    out = capsys.readouterr().out
    assert "PASS 1" in out


def test_main_refuses_vacuous_pass_when_filter_skips_everything(tmp_path, capsys):
    # Wrong filter field -> every artifact skipped -> previously printed
    # "coverage: 100.0% / PASS 0", indistinguishable from a real all-verified run.
    import pytest
    art = _artifact("rate of $4.00 per month", "A fixed initial rate of $4.00 per month.")
    art["status"] = "found"  # no briefing_status field at all
    _write(tmp_path / "a.json", art)
    from faithfulness_check import _main
    with pytest.raises(SystemExit) as e:
        _main([str(tmp_path)])
    assert e.value.code == 2
    assert "skipped" in capsys.readouterr().err.lower()


def test_main_refuses_vacuous_pass_on_empty_directory(tmp_path, capsys):
    # No files at all must not exit 0 with "gate: PASS 0" — indistinguishable
    # from a genuine all-verified run to a CI gate checking the exit code.
    import pytest
    from faithfulness_check import _main
    with pytest.raises(SystemExit) as e:
        _main([str(tmp_path)])
    assert e.value.code == 2
