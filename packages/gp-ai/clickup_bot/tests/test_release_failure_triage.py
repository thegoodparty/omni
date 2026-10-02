"""What a failed release run is allowed to mean.

The cases that matter here are the ones where the obvious reading is wrong, and
they are all taken from real runs rather than invented:

  - release 35273516196 failed `Dev gp-ai` AND the gate job named `E2E`. Reading
    the second as the cause is the Sep 2026 incident's mistake (ENG-11106), so
    the phase ordering is pinned.
  - the same run's failure LOOKS environmental (a Terraform convergence check)
    and was a filename bug in release.yml. It must not be classified as infra,
    because infra never buys an agent run.
  - release 35275512629 was `cancelled` by the train coalescing merges. A
    cancelled run observed nothing and must not be ticketed.

The signature tests are the load-bearing ones. Per-streak dedup means a train
red for twenty runs buys one investigation, and that only holds if the same
breakage hashes the same across runs whose shas, run ids and timings all differ
— and if two DIFFERENT breakages do not collide into one ticket.
"""

import release_failure_triage as rft

# Verbatim from run 35273516196, via
# `gh api repos/thegoodparty/omni/check-runs/<job>/annotations`. Ten per-root
# errors, one generic step failure, one status line — and the ten are all the
# same incident, which is why the module hashes a set rather than a count.
CONVERGENCE_ANNOTATIONS = [
    "pmf-engine-fargate produced no re-plan result, so its convergence is unknown",
    "pmf-engine-control-plane produced no re-plan result, so its convergence is unknown",
    "engineer-agent-fargate produced no re-plan result, so its convergence is unknown",
    "ddhq-matcher-fargate produced no re-plan result, so its convergence is unknown",
    "campaign-plan-lambda produced no re-plan result, so its convergence is unknown",
    "broker produced no re-plan result, so its convergence is unknown",
    "autopilot-bot produced no re-plan result, so its convergence is unknown",
    "autopilot-agent-fargate produced no re-plan result, so its convergence is unknown",
    "agent-run-inputs produced no re-plan result, so its convergence is unknown",
    "agent-experiment-metadata produced no re-plan result, so its convergence is unknown",
    "Process completed with exit code 1.",
    "E2E shards result: skipped",
]

CONVERGENCE_JOBS = [
    {"name": "Await checks", "conclusion": "success", "html_url": "u", "id": 1},
    {"name": "Dev gp-api", "conclusion": "success", "html_url": "u", "id": 2},
    {"name": "Dev gp-ai", "conclusion": "failure", "html_url": "u/3", "id": 3},
    {"name": "E2E", "conclusion": "failure", "html_url": "u/4", "id": 4},
    {"name": "Promote gp-api", "conclusion": "skipped", "html_url": "u", "id": 5},
]


def payload(**overrides):
    base = {
        "run": {
            "id": 35273516196,
            "url": "https://github.com/thegoodparty/omni/actions/runs/35273516196",
            "head_sha": "f8ae8d329cb19a0cdb152a65646ced22bccf9958",
            "conclusion": "failure",
            "attempt": 1,
            "display_title": "Stop alerting on other people's PRs (#1941)",
        },
        "jobs": CONVERGENCE_JOBS,
        "annotations": CONVERGENCE_ANNOTATIONS,
    }
    base.update(overrides)
    return base


class TestPhase:
    def test_a_failed_dev_deploy_outranks_the_gate_job_named_e2e(self):
        """The Sep 2026 misdiagnosis, pinned.

        `Dev gp-ai` failing SKIPS the shards, and the run's red gate job is
        still called `E2E`. Naming E2E here sends the investigation at the test
        suite instead of the deploy.
        """
        result = rft.triage(payload())
        assert result["phase"].startswith("dev deploy")
        assert result["failed_jobs"] == ["Dev gp-ai", "E2E"]

    def test_the_e2e_phase_is_left_to_the_spec_triage(self):
        jobs = [
            {"name": "E2E Shard (2)", "conclusion": "failure", "html_url": "u", "id": 1},
            {"name": "E2E", "conclusion": "failure", "html_url": "u", "id": 2},
        ]
        result = rft.triage(payload(jobs=jobs))
        assert result["actionable"] is False
        assert "gpbot-dev-test-triage" in result["reason"]

    def test_a_startup_failure_has_no_jobs_to_read(self):
        run = dict(payload()["run"], conclusion="startup_failure")
        result = rft.triage(payload(run=run, jobs=[], annotations=[]))
        assert result["actionable"] is True
        assert result["phase"] == rft.STARTUP_FAILURE_PHASE

    def test_a_promote_failure_is_named_as_one(self):
        jobs = [{"name": "Promote gp-webapp", "conclusion": "failure", "html_url": "u", "id": 1}]
        result = rft.triage(payload(jobs=jobs))
        assert result["phase"] == "prod promotion"

    def test_a_timed_out_job_counts_as_failed(self):
        jobs = [{"name": "Dev gp-api", "conclusion": "timed_out", "html_url": "u", "id": 1}]
        result = rft.triage(payload(jobs=jobs))
        assert result["failed_jobs"] == ["Dev gp-api"]


class TestNotActionable:
    def test_a_cancelled_run_observed_nothing(self):
        """Run 35275512629: cancelled by the train coalescing a burst of merges.

        The train cancels routinely. Ticketing those would file an incident per
        merge in a busy hour.
        """
        run = dict(payload()["run"], conclusion="cancelled")
        result = rft.triage(payload(run=run))
        assert result["actionable"] is False
        assert "cancelled" in result["reason"]
        assert result["signature"] is None

    def test_a_red_run_with_no_failed_job_says_so_rather_than_guessing(self):
        jobs = [{"name": "Dev gp-api", "conclusion": "success", "html_url": "u", "id": 1}]
        result = rft.triage(payload(jobs=jobs))
        assert result["actionable"] is False
        assert "no failed job" in result["reason"]


class TestSignature:
    def test_the_same_breakage_on_a_later_run_is_the_same_incident(self):
        """The dedup's whole premise.

        Same errors, different commit, different run id, different ordering —
        which is what the next red run actually looks like. A signature that
        moved here would file a fresh ticket per run and buy an investigation
        per run, the exact waste this is built to avoid.
        """
        first = rft.triage(payload())

        shuffled = list(reversed(CONVERGENCE_ANNOTATIONS))
        later_run = dict(
            payload()["run"],
            id=35275512629,
            url="https://github.com/thegoodparty/omni/actions/runs/35275512629",
            head_sha="4720f140e9bb1c4d8a2f6e5c3b1a0d9f8e7c6b5a",
            display_title="Something else entirely (#1944)",
        )
        second = rft.triage(payload(run=later_run, annotations=shuffled))

        assert first["signature"] == second["signature"]

    def test_a_sha_inside_the_error_text_does_not_move_the_signature(self):
        """release.yml threads the commit into image tags, so it appears inside
        otherwise identical error text — `broker-f8ae8d32...` and
        `broker-4720f140...` are the same failure."""
        a = rft.signature("dev deploy", ["apply dev/broker failed for broker-f8ae8d329cb19a0cdb152a65646ced22bccf9958"])
        b = rft.signature("dev deploy", ["apply dev/broker failed for broker-4720f140e9bb1c4d8a2f6e5c3b1a0d9f8e7c6b5a"])
        assert a == b

    def test_a_timestamp_or_duration_does_not_move_the_signature(self):
        a = rft.signature("dev deploy", ["step timed out after 1800s at 2026-09-17T20:53:01Z"])
        b = rft.signature("dev deploy", ["step timed out after 2400s at 2026-09-18T04:11:59Z"])
        assert a == b

    def test_two_different_breakages_do_not_share_a_ticket(self):
        """The failure mode that would be silent: a second, unrelated breakage
        joining the first one's open ticket and never being investigated."""
        convergence = rft.triage(payload())
        other = rft.triage(payload(annotations=["Error: failed to assume role arn:aws:iam::x:role/deploy"]))
        assert convergence["signature"] != other["signature"]

    def test_the_same_text_in_two_phases_is_two_incidents(self):
        assert rft.signature("dev deploy", ["exit status 2"]) != rft.signature("prod promotion", ["exit status 2"])

    def test_generic_step_noise_is_dropped_when_a_real_error_exists(self):
        """`Process completed with exit code 1` is emitted by every failed bash
        step. Built into the signature, every unrelated failure in the repo
        would look like one incident."""
        with_noise = rft.signature_lines(["broker produced no re-plan result", "Process completed with exit code 1."])
        assert with_noise == rft.signature_lines(["broker produced no re-plan result"])

    def test_generic_noise_is_kept_when_it_is_all_there_is(self):
        """A weak signature still beats no ticket: a step that emitted nothing
        else is still a red train that nobody has been told about."""
        assert rft.signature_lines(["Process completed with exit code 1."]) != []

    def test_a_run_that_annotates_per_file_cannot_split_its_own_streak(self):
        many = [f"file-{i}.tf is invalid" for i in range(40)]
        assert len(rft.signature_lines(many)) <= rft.MAX_SIGNATURE_LINES


class TestInfraBoundary:
    def test_the_convergence_failure_is_not_called_environmental(self):
        """The edge this module is built around.

        Run 35273516196 failed a Terraform convergence check — which reads as
        broken infrastructure — and the defect was a filename comparison in
        release.yml, fixed in two lines. Classified as infra it would have been
        held back from the pipeline and waited for a human.
        """
        assert rft.triage(payload())["infra"] is False

    def test_a_known_environmental_signature_is_flagged(self):
        result = rft.triage(payload(annotations=["curl: (22) 503 Service Unavailable from the mirror"]))
        assert result["infra"] is True
        # Still filed. The flag warns the agent in the body; it does not refuse
        # the ticket, because "I have never seen this" must not become silence.
        assert result["actionable"] is True

    def test_the_signatures_are_the_imported_ones(self):
        """Not a copy. ci_triage.decide is the authority on what infra means,
        and a second list would drift from it unnoticed."""
        from ci_triage import INFRA_LOG_SIGNATURES

        assert rft.INFRA_LOG_SIGNATURES is INFRA_LOG_SIGNATURES


class TestTicket:
    def test_the_title_is_deterministic_because_it_is_the_dedup_key(self):
        assert rft.triage(payload())["ticket_title"] == rft.triage(payload())["ticket_title"]

    def test_the_title_carries_the_signature_so_two_incidents_look_like_two(self):
        result = rft.triage(payload())
        assert result["signature"] in result["ticket_title"]

    def test_the_title_fits_a_clickup_list_row(self):
        long_error = "x" * 500
        result = rft.triage(payload(annotations=[long_error]))
        assert len(result["ticket_title"]) <= rft.MAX_TICKET_TITLE_CHARS

    def test_the_body_names_the_phase_the_run_and_the_commit(self):
        body = rft.triage(payload())["ticket_body"]
        assert "dev deploy" in body
        assert "35273516196" in body
        assert "f8ae8d32" in body
        assert "Dev gp-ai" in body

    def test_the_body_shows_the_error_the_run_reported(self):
        body = rft.triage(payload())["ticket_body"]
        assert "produced no re-plan result" in body

    def test_the_body_warns_when_the_failure_looks_environmental(self):
        body = rft.triage(payload(annotations=["503 service unavailable"]))["ticket_body"]
        assert "known-environmental" in body

    def test_the_body_does_not_cry_infra_when_it_is_not(self):
        assert "known-environmental" not in rft.triage(payload())["ticket_body"]


class TestInput:
    def test_a_non_object_is_refused_rather_than_guessed_at(self):
        for bad in ([], "x", 3, None):
            try:
                rft.triage(bad)
            except ValueError:
                continue
            raise AssertionError(f"{bad!r} should have been refused")

    def test_a_payload_with_no_run_is_refused(self):
        try:
            rft.triage({"jobs": []})
        except ValueError:
            return
        raise AssertionError("a payload with no run should have been refused")

    def test_missing_annotations_still_reach_a_decision(self):
        """The annotations API can answer empty for a job whose failure was a
        process exit with no `::error::`. That is a red train, so it must still
        produce a ticket."""
        result = rft.triage(payload(annotations=None))
        assert result["actionable"] is True
        assert result["signature"]
