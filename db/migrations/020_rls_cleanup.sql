-- Migration: RLS cleanup
-- Drop RLS from tables that don't need team-scoping.
-- Keep RLS only on scores and team_players.

ALTER TABLE teams DISABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_teams DISABLE ROW LEVEL SECURITY;

-- Drop policies on teams
DO $$ BEGIN
  EXECUTE (
    SELECT string_agg('DROP POLICY IF EXISTS ' || quote_ident(policyname) || ' ON ' || quote_ident(tablename) || ';', ' ')
    FROM pg_policies WHERE tablename = 'teams'
  );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Drop policies on tournament_teams
DO $$ BEGIN
  EXECUTE (
    SELECT string_agg('DROP POLICY IF EXISTS ' || quote_ident(policyname) || ' ON ' || quote_ident(tablename) || ';', ' ')
    FROM pg_policies WHERE tablename = 'tournament_teams'
  );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
