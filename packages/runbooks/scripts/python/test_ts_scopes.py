import ts_scopes as ts


_COMPONENT = """\
import { trackEvent } from 'helpers/analyticsHelper'

const TrackedForm = () => {
  const onSave = () => {
    trackEvent('Saved', {})
  }
  return <form onSubmit={onSave} />
}

const UntrackedForm = () => {
  const onSend = () => {
    void doSomething()
  }
  return <form onSubmit={onSend} />
}
"""


def _scope_at(text, needle):
    code = ts.blank_noncode(text)
    pairs = ts.brace_pairs(code)
    span = ts.enclosing_scope(code, text.index(needle), pairs)
    return code, span


def test_blank_noncode_preserves_offsets_and_newlines():
    text = "const a = '} not a brace' // } neither\nconst b = 1\n"
    code = ts.blank_noncode(text)
    assert len(code) == len(text)
    assert code.count("\n") == text.count("\n")
    # the braces inside the string and the comment are gone
    assert "}" not in code


def test_brace_pairs_ignores_braces_inside_strings():
    code = ts.blank_noncode("const f = () => { const s = '}' ; return 1 }\n")
    pairs = ts.brace_pairs(code)
    assert len(pairs) == 1


def test_enclosing_scope_is_the_component_not_the_sibling_handler():
    # The nearest declaration above the JSX is `const onSave`, whose block closes before the
    # JSX. The scope that contains the match is the component.
    code, span = _scope_at(_COMPONENT, "onSubmit={onSave}")
    assert ts.scope_name(code, span[0]) == "TrackedForm"
    code, span = _scope_at(_COMPONENT, "onSubmit={onSend}")
    assert ts.scope_name(code, span[0]) == "UntrackedForm"


def test_scope_kind_separates_type_declarations_from_code():
    text = "interface Props {\n  currentStep?: string\n}\nconst C = () => { currentStep }\n"
    code = ts.blank_noncode(text)
    pairs = ts.brace_pairs(code)
    in_type = ts.enclosing_scope(code, text.index("currentStep?"), pairs, decisive=False)
    in_code = ts.enclosing_scope(code, text.rindex("currentStep"), pairs, decisive=False)
    assert ts.scope_kind(code, in_type[0]) == "type"
    assert ts.scope_kind(code, in_code[0]) == "code"


def test_enclosing_scope_none_at_top_level():
    code = ts.blank_noncode("const x = 1\n")
    assert ts.enclosing_scope(code, 0, ts.brace_pairs(code)) is None
