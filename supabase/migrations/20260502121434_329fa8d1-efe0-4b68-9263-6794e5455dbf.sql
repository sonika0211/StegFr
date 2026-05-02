-- Remove username -> email lookup (username sign-in disabled)
DROP FUNCTION IF EXISTS public.get_email_for_username(text);

-- Shared Q-table for RL agent
CREATE TABLE IF NOT EXISTS public.qtable (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_key text NOT NULL,
  action_key text NOT NULL,
  q_value double precision NOT NULL DEFAULT 0,
  visits integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (state_key, action_key)
);

CREATE INDEX IF NOT EXISTS idx_qtable_state ON public.qtable(state_key);

ALTER TABLE public.qtable ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Q-table readable by authenticated users"
  ON public.qtable FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert Q entries"
  ON public.qtable FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update Q entries"
  ON public.qtable FOR UPDATE TO authenticated
  USING (true);