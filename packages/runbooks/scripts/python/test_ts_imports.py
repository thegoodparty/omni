import ts_imports as ti


def _exists(known):
    return lambda rel: rel in known


def test_parse_named_and_default_and_aliased_imports():
    text = (
        "import { useThing, other as renamed } from './hooks/useThing'\n"
        "import Default from '../shared/Default'\n"
        "import type { OnlyType } from './types'\n"
        "import 'side-effect-only'\n"
        "import { NotRelative } from '@goodparty_org/sdk'\n"
    )
    pairs = ti.parse_relative_imports(text)
    assert ("useThing", "./hooks/useThing") in pairs
    # an aliased import binds the alias, so that is the name a caller would reference
    assert ("renamed", "./hooks/useThing") in pairs
    assert ("Default", "../shared/Default") in pairs
    assert ("OnlyType", "./types") in pairs
    # bare and package imports carry no local name / no relative path
    assert all(spec.startswith(".") for _name, spec in pairs)
    assert not any(name == "NotRelative" for name, _spec in pairs)


def test_resolve_import_tries_bundler_suffixes():
    known = {"app/a/useThing.ts", "app/a/widget/index.tsx"}
    ex = _exists(known)
    assert ti.resolve_import("app/a/Comp.tsx", "./useThing", ex) == "app/a/useThing.ts"
    assert ti.resolve_import("app/a/Comp.tsx", "./widget", ex) == "app/a/widget/index.tsx"
    assert ti.resolve_import("app/a/Comp.tsx", "./missing", ex) is None


def test_resolve_import_refuses_to_escape_the_repo_root():
    # Review Focus 5: a traversing spec must not resolve to something outside the tree.
    ex = _exists({"../../../etc/passwd.ts"})
    assert ti.resolve_import("app/a/Comp.tsx", "../../../../etc/passwd", ex) is None


def test_is_hook_name():
    assert ti.is_hook_name("useCandidateProfileForm")
    assert not ti.is_hook_name("useless")       # lowercase after "use" is not a hook
    assert not ti.is_hook_name("Component")
    assert not ti.is_hook_name("use")


def test_build_reverse_index_maps_importers():
    texts = {
        "app/Parent.tsx": "import { Child } from './Child'\n",
        "app/Other.tsx": "import { Child } from './Child'\n",
        "app/Child.tsx": "export const Child = () => null\n",
    }
    ex = _exists(set(texts))
    idx = ti.build_reverse_index(texts, ex)
    assert idx["app/Child.tsx"] == ["app/Other.tsx", "app/Parent.tsx"]
