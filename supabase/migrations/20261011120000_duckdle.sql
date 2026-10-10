-- Duckdle : statistiques communes et progression des comptes.
--
-- Les tables sont toutes fermées (RLS activée, aucun droit direct) : le site ne passe que
-- par les fonctions ci-dessous, qui vérifient ce qu'on leur envoie et ne rendent que des
-- totaux. Aucune donnée personnelle n'est gardée pour les parties : ni nom, ni adresse IP,
-- ni identifiant d'appareil. Seul un joueur connecté voit sa ligne de progression.

-- ------------------------------------------------------------------ parties

create table public.games (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('mode', 'daily', 'archive', 'challenge')),
  mode text not null check (mode ~ '^[a-z0-9-]{1,40}$'),
  -- Jour du défi, pour le défi du jour et les défis passés.
  challenge_day date,
  score integer not null check (score between 0 and 1600),
  correct smallint not null check (correct between 0 and 8),
  rounds smallint not null check (rounds between 1 and 8),
  lang text check (lang ~ '^[a-z]{2,3}$'),
  -- Parties envoyées par les contrôles automatiques : jamais comptées.
  test boolean not null default false,
  -- Joueur connecté, s'il y en a un (sinon partie anonyme).
  user_id uuid references auth.users (id) on delete set null,
  constraint games_score_fits check (score <= 200 * correct),
  constraint games_correct_fits check (correct <= rounds),
  constraint games_day_when_daily check ((kind in ('daily', 'archive')) = (challenge_day is not null))
);

create index games_daily_idx on public.games (challenge_day) where kind = 'daily' and not test;
create index games_created_idx on public.games (created_at);

create table public.answers (
  game_id bigint not null references public.games (id) on delete cascade,
  position smallint not null check (position between 0 and 7),
  item text not null check (char_length(item) between 1 and 80),
  artist text not null check (char_length(artist) between 1 and 60),
  guess text check (char_length(guess) between 1 and 60),
  correct boolean not null,
  elapsed integer not null default 0 check (elapsed between 0 and 60000),
  primary key (game_id, position),
  constraint answers_correct_guess check (not correct or guess = artist)
);

create index answers_item_idx on public.answers (item);
create index answers_artist_idx on public.answers (artist);

-- ------------------------------------------------------------------ progression

create table public.progress (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now(),
  constraint progress_size check (octet_length(state::text) < 300000)
);

alter table public.games enable row level security;
alter table public.answers enable row level security;
alter table public.progress enable row level security;
revoke all on public.games, public.answers, public.progress from anon, authenticated;

-- ------------------------------------------------------------------ envoyer une partie

create function public.submit_game(game jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  list jsonb := coalesce(game -> 'answers', '[]'::jsonb);
  total int;
  found_count int;
  played date := nullif(game ->> 'day', '')::date;
  today date := (now() at time zone 'utc')::date;
  new_id bigint;
begin
  if jsonb_typeof(list) <> 'array' then
    raise exception 'answers doit être une liste';
  end if;
  total := jsonb_array_length(list);
  if total not between 1 and 8 then
    raise exception 'de 1 à 8 réponses attendues';
  end if;
  -- Le défi du jour ne s'envoie que le jour même (un jour de marge pour les fuseaux).
  if game ->> 'kind' = 'daily' and played not between today - 1 and today + 1 then
    raise exception 'défi du jour hors de sa journée';
  end if;
  select count(*) into found_count from jsonb_array_elements(list) a where (a ->> 'correct')::boolean;

  insert into public.games (kind, mode, challenge_day, score, correct, rounds, lang, test, user_id)
  values (
    game ->> 'kind',
    game ->> 'mode',
    played,
    (game ->> 'score')::int,
    found_count,
    total,
    nullif(game ->> 'lang', ''),
    coalesce((game ->> 'test')::boolean, false),
    auth.uid()
  )
  returning id into new_id;

  insert into public.answers (game_id, position, item, artist, guess, correct, elapsed)
  select
    new_id,
    (ord - 1)::smallint,
    a ->> 'item',
    a ->> 'artist',
    nullif(a ->> 'guess', ''),
    (a ->> 'correct')::boolean,
    least(greatest(coalesce((a ->> 'elapsed')::int, 0), 0), 60000)
  from jsonb_array_elements(list) with ordinality as t (a, ord);

  return new_id;
end;
$$;

-- ------------------------------------------------------------------ statistiques communes

-- Accueil : parties des dernières 24 heures, au total, et joueurs du défi du jour.
create function public.live_stats(day_key date default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'games_24h', (select count(*) from public.games where not test and created_at > now() - interval '24 hours'),
    'games_total', (select count(*) from public.games where not test),
    'daily_players', (select count(*) from public.games where not test and kind = 'daily' and challenge_day = day_key)
  );
$$;

-- Défi du jour : joueurs, moyenne, répartition par nombre de cases trouvées (0 à 8)
-- et part des joueurs battus par un score donné.
create function public.daily_stats(day_key date, my_score integer default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with played as (
    select score, correct from public.games
    where not test and kind = 'daily' and challenge_day = day_key
  ),
  spread as (
    select k, (select count(*) from played where correct = k) as n
    from generate_series(0, 8) as k
  )
  select jsonb_build_object(
    'players', (select count(*) from played),
    'average', (select coalesce(round(avg(score)), 0) from played),
    'correct', (select jsonb_agg(n order by k) from spread),
    'better_than', case
      when my_score is null or (select count(*) from played) = 0 then null
      else (select round(100.0 * count(*) filter (where score < my_score) / count(*)) from played)
    end
  );
$$;

-- Cases : combien de joueurs les ont vues, et combien ont trouvé le dessinateur.
create function public.panel_stats(items text[])
returns table (item text, attempts integer, found integer)
language sql
stable
security definer
set search_path = ''
as $$
  select a.item, count(*)::int, (count(*) filter (where a.correct))::int
  from public.answers a
  join public.games g on g.id = a.game_id
  where cardinality(items) <= 50 and a.item = any (items) and not g.test
  group by a.item;
$$;

-- Dessinateurs : taux de reconnaissance, dès dix cases jouées.
create function public.artist_stats()
returns table (artist text, attempts integer, found integer)
language sql
stable
security definer
set search_path = ''
as $$
  select a.artist, count(*)::int, (count(*) filter (where a.correct))::int
  from public.answers a
  join public.games g on g.id = a.game_id
  where not g.test
  group by a.artist
  having count(*) >= 10;
$$;

-- ------------------------------------------------------------------ progression des comptes

create function public.load_progress()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('state', state, 'updated_at', updated_at)
  from public.progress
  where user_id = auth.uid();
$$;

-- Écriture prudente : on ne remplace que la version lue (base). Si un autre appareil a
-- écrit entre-temps, la fonction renvoie null et le site relit, refusionne, réessaie.
create function public.save_progress(new_state jsonb, base timestamptz default null)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  stamp timestamptz := clock_timestamp();
begin
  if uid is null then
    raise exception 'connexion requise';
  end if;
  if base is null then
    insert into public.progress (user_id, state, updated_at)
    values (uid, new_state, stamp)
    on conflict (user_id) do nothing;
  else
    update public.progress
    set state = new_state, updated_at = stamp
    where user_id = uid and updated_at = base;
  end if;
  if found then
    return stamp;
  end if;
  return null;
end;
$$;

-- Effacer ses statistiques en étant connecté.
create function public.delete_progress()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.progress where user_id = auth.uid();
$$;

-- Supprimer son compte : la progression part avec, les parties restent anonymes.
create function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'connexion requise';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

-- ------------------------------------------------------------------ droits

revoke all on function
  public.submit_game(jsonb),
  public.live_stats(date),
  public.daily_stats(date, integer),
  public.panel_stats(text[]),
  public.artist_stats(),
  public.load_progress(),
  public.save_progress(jsonb, timestamptz),
  public.delete_progress(),
  public.delete_account()
from public, anon, authenticated;

grant execute on function
  public.submit_game(jsonb),
  public.live_stats(date),
  public.daily_stats(date, integer),
  public.panel_stats(text[]),
  public.artist_stats()
to anon, authenticated;

grant execute on function
  public.load_progress(),
  public.save_progress(jsonb, timestamptz),
  public.delete_progress(),
  public.delete_account()
to authenticated;
