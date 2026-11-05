"""Session segmentation (TDD "Terms used in this doc": a session is "Part of
a chat with no gap over 60 minutes"; Implementation Notes 1.6 / section 3
step 3).

Reproduces Samuel's `starts_session` SQL exactly, so the scout scores the
same sessions his digest would have:

    CASE WHEN gap_minutes IS NULL THEN 1
         WHEN role = 'user' AND gap_minutes > 60 THEN 1
         ELSE 0 END AS starts_session

Note what that formula does NOT do: an assistant message after a long gap
never starts a new session on its own. Only the first message of a
conversation, or a *user* message more than 60 minutes after the previous
one, opens a new session.
"""

from dataclasses import dataclass
from datetime import timedelta

from case_scout.reader.messages import Message

SESSION_GAP = timedelta(minutes=60)


@dataclass(frozen=True)
class Session:
    """One segmented session. `session_id` is
    `<conversation_id>:<first message_id>` — keyed off the session's own
    first message, not a position in whatever window happened to be
    fetched. That is deliberate: a positional index (0, 1, 2, ... per
    conversation within one run's fetch) is NOT stable across runs. Once
    `lastSessionStart` moves far enough that an old, already-processed
    session falls out of the next run's window, that conversation's next
    (genuinely new) session would be fetched as index 0 again — the same id
    a prior, unrelated session was already recorded under in
    `processedSessionIds` — and get wrongly dropped as already-processed.
    A message_id never gets reassigned, so this id is stable forever,
    independent of which window any given run happened to fetch."""

    session_id: str
    conversation_id: str
    scope: str
    messages: tuple[Message, ...]

    @property
    def started_at(self):
        return self.messages[0].created_at


def _session_id(conversation_id: str, first_message: Message) -> str:
    return f"{conversation_id}:{first_message.message_id}"


def segment_into_sessions(messages: list[Message]) -> list[Session]:
    """Groups messages by conversation, in chronological order, and splits
    each conversation into sessions on a >60-minute gap before a *user*
    message (Samuel's `starts_session` rule, see module docstring).

    See `pipeline.select_new_sessions` for how `processedSessionIds` is
    applied on top of this.
    """
    by_conversation: dict[str, list[Message]] = {}
    for message in messages:
        by_conversation.setdefault(message.conversation_id, []).append(message)

    sessions: list[Session] = []
    for conversation_id, conversation_messages in by_conversation.items():
        ordered = sorted(conversation_messages, key=lambda m: m.created_at)
        current: list[Message] = []
        previous: Message | None = None
        for message in ordered:
            starts_new_session = previous is None or (
                message.role == "user" and message.created_at - previous.created_at > SESSION_GAP
            )
            if starts_new_session and current:
                sessions.append(
                    Session(
                        session_id=_session_id(conversation_id, current[0]),
                        conversation_id=conversation_id,
                        scope=current[0].scope,
                        messages=tuple(current),
                    )
                )
                current = []
            current.append(message)
            previous = message
        if current:
            sessions.append(
                Session(
                    session_id=_session_id(conversation_id, current[0]),
                    conversation_id=conversation_id,
                    scope=current[0].scope,
                    messages=tuple(current),
                )
            )

    return sessions
