-- Briefing chat turns now run on /v1/chats/:conversationId, which checks
-- ownership by (owner_user_id, scope, organization_slug). Conversations created
-- before #2464 (the ChatScope migration) carry scope='briefing_annotation' from
-- the column default but a NULL organization_slug, so every one of them 404s on
-- the shared route and the official loses their past briefing threads.
--
-- The slug is reachable from the annotation: the conversation's annotation
-- points at a MeetingBriefing, which belongs to an ElectedOffice that owns the
-- slug. Nothing is guessed — a conversation with no such chain stays NULL and
-- simply remains unreachable, exactly as it is today.
UPDATE "chat_conversation" AS c
SET "organization_slug" = eo."organization_slug"
FROM "annotation" AS a
JOIN "meeting_briefing" AS mb ON mb."id" = a."resource_id"
JOIN "elected_office" AS eo ON eo."id" = mb."elected_office_id"
WHERE a."chat_conversation_id" = c."id"
  AND a."resource_type" = 'briefing'
  AND a."kind" = 'chat'
  AND c."scope" = 'briefing_annotation'
  AND c."organization_slug" IS NULL;
