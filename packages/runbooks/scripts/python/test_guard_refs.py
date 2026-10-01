"""Reference extraction for the pre-merge governance guard (DATA-2432)."""

import guard_refs as gr


def test_counts_a_plain_key_path_and_a_quoted_name():
    refs = gr.extract("trackEvent(EVENTS.Outreach.CampaignScheduled)\nfire('Door Knocking - Door Logged')")
    assert refs.key_paths["EVENTS.Outreach.CampaignScheduled"] == 1
    assert refs.literals["Door Knocking - Door Logged"] == 1


def test_a_key_path_wrapped_across_lines_still_counts():
    refs = gr.extract("trackEvent(\n  EVENTS.Dashboard\n    .CampaignPlan.Viewed,\n)")
    assert refs.key_paths["EVENTS.Dashboard.CampaignPlan.Viewed"] == 1


def test_optional_chaining_counts():
    assert gr.extract("x(EVENTS?.Outreach?.Done)").key_paths["EVENTS.Outreach.Done"] == 1


def test_a_commented_out_call_is_not_a_call_site():
    refs = gr.extract("// trackEvent(EVENTS.A.B)\n/* trackEvent('Old - Event') */")
    assert refs.key_paths == {} and "Old - Event" not in refs.literals


def test_a_namespace_alias_resolves_its_members():
    src = "const planEvents = EVENTS.Dashboard.CampaignPlan\ntrackEvent(planEvents.Viewed)"
    assert gr.extract(src).key_paths["EVENTS.Dashboard.CampaignPlan.Viewed"] == 1


def test_the_alias_declaration_is_not_a_reference_to_the_group():
    refs = gr.extract("const planEvents = EVENTS.Dashboard.CampaignPlan\n")
    assert refs.key_paths["EVENTS.Dashboard.CampaignPlan"] == 0


def test_destructured_names_resolve_and_the_declaration_is_not_a_use():
    src = "const { Viewed, Shared: share } = EVENTS.Dashboard.CampaignPlan\ntrackEvent(share)"
    refs = gr.extract(src)
    assert refs.key_paths["EVENTS.Dashboard.CampaignPlan.Shared"] == 1
    assert refs.key_paths["EVENTS.Dashboard.CampaignPlan.Viewed"] == 0


def test_imports_are_collected():
    src = "import A from './a'\nimport { b } from '@/helpers/b'\nconst c = await import('../c')"
    assert gr.extract(src).imports == ["./a", "@/helpers/b", "../c"]
