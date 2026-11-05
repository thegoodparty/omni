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
    """One segmented session. `session_id` is `<conversation_id>:<index>`,
    where `index` is 0-based over the messages this run fetched for that
    conversation (TDD Implementation Notes 2.2's example key shape).

    This index is run-local, not a lifetime counter — see
    `segment_into_sessions`'s docstring for why that is the correct choice
    given the 60-minute query overlap (Implementation Notes section 7's
    midnight-spanning edge case)."""

    session_id: str
    conversation_id: str
    scope: str
    messages: tuple[Message, ...]

    @property
    def started_at(self):
        return self.messages[0].created_at


def segment_into_sessions(messages: list[Message]) -> list[Session]:
    """Groups messages by conversation, in chronological order, and splits
    each conversation into sessions on a >60-minute gap before a *user*
    message (Samuel's `starts_session` rule, see module docstring).

    Session ids are assigned 0, 1, 2, ... per conversation **within the set
    of messages passed in**, not against any session this conversation ever
    had in a previous run. That is deliberately safe rather than merely
    convenient: the caller (pipeline.py) always fetches from
    `lastSessionStart` minus the 60-minute overlap, which is specifically
    wide enough to pull in the entirety of any session that might still
    have been open on the marker's cutoff (Implementation Notes section 7,
    "a conversation spanning midnight"). A session that was already fully
    processed in an earlier run therefore never appears partially in this
    run's window — it is either excluded entirely (its tail message was
    more than 60 minutes before the window start) or included in full
    (its tail falls inside the overlap), so re-deriving index 0 for it here
    always lines up with the id recorded in `processedSessionIds` for a
    still-open session. A closed, fully-excluded session is never
    renumbered because it was never refetched. See
    `pipeline.select_new_sessions` for how `processedSessionIds` is applied
    on top of this.
    """
    by_conversation: dict[str, list[Message]] = {}
    for message in messages:
        by_conversation.setdefault(message.conversation_id, []).append(message)

    sessions: list[Session] = []
    for conversation_id, conversation_messages in by_conversation.items():
        ordered = sorted(conversation_messages, key=lambda m: m.created_at)
        current: list[Message] = []
        index = 0
        previous: Message | None = None
        for message in ordered:
            starts_new_session = previous is None or (
                message.role == "user" and message.created_at - previous.created_at > SESSION_GAP
            )
            if starts_new_session and current:
                sessions.append(
                    Session(
                        session_id=f"{conversation_id}:{index}",
                        conversation_id=conversation_id,
                        scope=current[0].scope,
                        messages=tuple(current),
                    )
                )
                index += 1
                current = []
            current.append(message)
            previous = message
        if current:
            sessions.append(
                Session(
                    session_id=f"{conversation_id}:{index}",
                    conversation_id=conversation_id,
                    scope=current[0].scope,
                    messages=tuple(current),
                )
            )

    return sessions
