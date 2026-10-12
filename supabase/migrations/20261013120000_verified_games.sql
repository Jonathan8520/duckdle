-- Parties vérifiées par la base, et envois en rafale freinés.
--
-- Jusqu'ici, submit_game gardait le score et le « trouvé » envoyés par le navigateur (dans
-- les limites des contraintes de la table). Désormais la base les recalcule elle-même à
-- partir des réponses : une case est trouvée si la réponse donnée est le bon dessinateur,
-- et le score suit la règle du jeu (100 points, plus un bonus de rapidité jusqu'à 100 points
-- tant que la réponse arrive avant 7,5 secondes).
--
-- Une même adresse ne peut plus envoyer qu'un nombre limité de parties en dix minutes. Pour
-- cela, la base garde une empreinte salée de l'adresse IP (jamais l'adresse elle-même),
-- effacée au bout de dix minutes. Rien ne la relie aux parties enregistrées.

create schema if not exists duckdle_private;
revoke all on schema duckdle_private from public;

-- Sel des empreintes : tiré une fois pour toutes, jamais lisible depuis le site.
create table duckdle_private.secret (salt text not null);
insert into duckdle_private.secret (salt)
values (md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text));

create table duckdle_private.submissions (
  sender text not null,
  sent_at timestamptz not null default now()
);
create index submissions_sender_idx on duckdle_private.submissions (sender, sent_at);
create index submissions_sent_at_idx on duckdle_private.submissions (sent_at);

-- Vrai si l'adresse de la requête peut encore envoyer une partie, et note l'envoi.
-- Sans adresse connue (appel direct à la base, tests), pas de limite.
create function duckdle_private.allow_submission()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  headers jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
  address text;
  fingerprint text;
  recent int;
begin
  -- cf-connecting-ip est posé par le proxy et ne peut pas être fourni par le navigateur ;
  -- à défaut, la première adresse de x-forwarded-for.
  address := coalesce(
    nullif(trim(headers ->> 'cf-connecting-ip'), ''),
    nullif(trim(split_part(headers ->> 'x-forwarded-for', ',', 1)), '')
  );
  if address is null then
    return true;
  end if;
  select encode(sha256(convert_to(s.salt || address, 'UTF8')), 'hex') into fingerprint from duckdle_private.secret s;
  delete from duckdle_private.submissions where sent_at < now() - interval '10 minutes';
  select count(*) into recent from duckdle_private.submissions where sender = fingerprint;
  -- Une partie prend au moins une demi-minute : soixante en dix minutes laisse de la marge
  -- à plusieurs joueurs derrière la même adresse (box, lycée, réseau mobile).
  if recent >= 60 then
    return false;
  end if;
  insert into duckdle_private.submissions (sender) values (fingerprint);
  return true;
end;
$$;

revoke all on function duckdle_private.allow_submission() from public;

create or replace function public.submit_game(game jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  list jsonb := coalesce(game -> 'answers', '[]'::jsonb);
  total int;
  found_count int;
  points int;
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
  -- Un défi passé ne peut pas être un défi à venir.
  if game ->> 'kind' = 'archive' and played > today + 1 then
    raise exception 'défi pas encore paru';
  end if;
  if not duckdle_private.allow_submission() then
    return null;
  end if;

  -- Score recalculé : le score envoyé par le navigateur n'est pas lu.
  select
    count(*) filter (where ok),
    coalesce(sum(case when ok then 100 + case when ms < 7500 then round(100 * (1 - ms / 7500.0))::int else 0 end else 0 end), 0)
  into found_count, points
  from (
    select
      (nullif(a ->> 'guess', '') = a ->> 'artist') is true as ok,
      least(greatest(coalesce((a ->> 'elapsed')::int, 0), 0), 60000) as ms
    from jsonb_array_elements(list) a
  ) answers;

  insert into public.games (kind, mode, challenge_day, score, correct, rounds, lang, test, user_id)
  values (
    game ->> 'kind',
    game ->> 'mode',
    played,
    points,
    found_count,
    total,
    nullif(game ->> 'lang', ''),
    coalesce((game ->> 'test')::boolean, false),
    auth.uid()
  )
  on conflict do nothing
  returning id into new_id;

  if new_id is null then
    return null;
  end if;

  insert into public.answers (game_id, position, item, artist, guess, correct, elapsed)
  select
    new_id,
    (ord - 1)::smallint,
    a ->> 'item',
    a ->> 'artist',
    nullif(a ->> 'guess', ''),
    (nullif(a ->> 'guess', '') = a ->> 'artist') is true,
    least(greatest(coalesce((a ->> 'elapsed')::int, 0), 0), 60000)
  from jsonb_array_elements(list) with ordinality as t (a, ord);

  return new_id;
end;
$$;
