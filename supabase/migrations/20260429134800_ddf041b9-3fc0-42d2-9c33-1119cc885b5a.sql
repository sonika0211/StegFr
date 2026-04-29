-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are viewable by authenticated users"
  ON public.profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  base_username TEXT;
  final_username TEXT;
  counter INT := 0;
BEGIN
  base_username := COALESCE(
    NEW.raw_user_meta_data->>'username',
    split_part(NEW.email, '@', 1)
  );
  base_username := regexp_replace(lower(base_username), '[^a-z0-9_]', '', 'g');
  IF base_username = '' OR base_username IS NULL THEN
    base_username := 'user' || substr(NEW.id::text, 1, 6);
  END IF;
  final_username := base_username;
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = final_username) LOOP
    counter := counter + 1;
    final_username := base_username || counter::text;
  END LOOP;

  INSERT INTO public.profiles (id, username, display_name, email)
  VALUES (
    NEW.id,
    final_username,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', final_username),
    NEW.email
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ CONVERSATIONS ============
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_b UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_order CHECK (user_a < user_b),
  CONSTRAINT unique_pair UNIQUE (user_a, user_b)
);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view their conversations"
  ON public.conversations FOR SELECT TO authenticated
  USING (auth.uid() = user_a OR auth.uid() = user_b);

CREATE POLICY "Authenticated users can create conversations"
  ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_a OR auth.uid() = user_b);

CREATE POLICY "Participants can update last_message_at"
  ON public.conversations FOR UPDATE TO authenticated
  USING (auth.uid() = user_a OR auth.uid() = user_b);

-- Helper to check participation (avoids RLS recursion in messages policies)
CREATE OR REPLACE FUNCTION public.is_conversation_participant(_conv UUID, _user UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversations
    WHERE id = _conv AND (_user = user_a OR _user = user_b)
  );
$$;

-- ============ MESSAGES ============
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT,
  image_path TEXT,
  image_kind TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conv_time ON public.messages(conversation_id, created_at);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view messages"
  ON public.messages FOR SELECT TO authenticated
  USING (public.is_conversation_participant(conversation_id, auth.uid()));

CREATE POLICY "Participants can send messages"
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = sender_id
    AND public.is_conversation_participant(conversation_id, auth.uid())
  );

CREATE POLICY "Senders can delete own messages"
  ON public.messages FOR DELETE TO authenticated
  USING (auth.uid() = sender_id);

-- Trigger to bump conversation last_message_at
CREATE OR REPLACE FUNCTION public.bump_conversation_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.conversations
  SET last_message_at = NEW.created_at
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_message_insert
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.bump_conversation_timestamp();

-- ============ REALTIME ============
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.conversations REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;

-- ============ STORAGE ============
INSERT INTO storage.buckets (id, name, public)
VALUES ('stego-images', 'stego-images', false)
ON CONFLICT (id) DO NOTHING;

-- Path convention: {conversation_id}/{message_id}.png
CREATE POLICY "Participants can read stego images"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'stego-images'
    AND public.is_conversation_participant(
      (split_part(name, '/', 1))::uuid,
      auth.uid()
    )
  );

CREATE POLICY "Participants can upload stego images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'stego-images'
    AND public.is_conversation_participant(
      (split_part(name, '/', 1))::uuid,
      auth.uid()
    )
  );

CREATE POLICY "Senders can delete own stego images"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'stego-images'
    AND owner = auth.uid()
  );