-- Case-insensitive uniqueness backstop for user emails (ENG-10682). The app
-- lowercases on write since ENG-10672; this index blocks any future caller
-- that bypasses those checks. Expression indexes cannot be declared in
-- schema.prisma — Prisma's migrate diff ignores them, so this stays raw SQL.
CREATE UNIQUE INDEX "user_email_lower_unique" ON "user" (LOWER(email));
