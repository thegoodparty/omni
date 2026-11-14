"""AWS rejects some values at apply time that `terraform validate` and `plan`
accept (ENG-11603: release run 42152973089 failed applying dev/case-scout).
This text check catches the two classes that bit us, across every .tf file
under infrastructure/, so they fail in CI instead of on the dev apply:

- security group descriptions limited to a-zA-Z0-9. _-:/()#,@[]+=&;{}!$*
- SNS topic policies with more than one statement need a unique Sid on each
  (a single statement without one is accepted; IAM policies never need it)
"""

import re
from pathlib import Path

INFRA = Path(__file__).resolve().parent.parent.parent / "infrastructure"
SG_DESCRIPTION_OK = re.compile(r"^[a-zA-Z0-9. _\-:/()#,@\[\]+=&;{}!$*]{0,255}$")
RESOURCE = re.compile(r'^resource "(\w+)" "[^"]+" \{\n(.*?)^\}', re.M | re.S)
SG_TYPES = (
    "aws_security_group",
    "aws_security_group_rule",
    "aws_vpc_security_group_ingress_rule",
    "aws_vpc_security_group_egress_rule",
)


def _blocks(*types):
    for path in sorted(INFRA.rglob("*.tf")):
        for m in RESOURCE.finditer(path.read_text()):
            if m.group(1) in types:
                yield path.relative_to(INFRA), m.group(1), m.group(2)


def test_the_scan_still_finds_the_resources_it_polices():
    # A scan that matches nothing passes for the wrong reason, and this one
    # depends on formatting (`terraform fmt` layout, closing brace at column 0).
    sg = [path for path, _, _ in _blocks(*SG_TYPES)]
    sns = [path for path, _, _ in _blocks("aws_sns_topic_policy")]
    assert sg, f"no security group blocks matched under {INFRA}"
    assert sns, f"no SNS topic policy blocks matched under {INFRA}"


def test_security_group_descriptions_use_only_aws_allowed_characters():
    bad = []
    for path, _, body in _blocks(*SG_TYPES):
        for desc in re.findall(r'^\s*description\s*=\s*"([^"$]*)"', body, re.M):
            if not SG_DESCRIPTION_OK.match(desc):
                bad.append(f"{path}: {desc!r}")
    assert not bad, bad


def test_multi_statement_sns_topic_policies_have_a_unique_sid_per_statement():
    bad = []
    for path, _, body in _blocks("aws_sns_topic_policy"):
        effects = len(re.findall(r"\bEffect\s*=", body))
        sids = re.findall(r'\bSid\s*=\s*"([^"]+)"', body)
        if effects > 1 and (effects != len(sids) or len(set(sids)) != len(sids)):
            bad.append(f"{path}: {effects} statements, sids={sids}")
    assert not bad, bad
