-- Un défi du jour par compte et par jour : seule la première partie envoyée compte.
--
-- Une partie en double (même compte, même jour) n'est pas enregistrée du tout, ni dans les
-- chiffres du défi ni dans la part de joueurs qui ont trouvé chaque case. Les parties
-- anonymes ne peuvent pas être reconnues : pour elles, c'est le site qui empêche de rejouer.

-- Doublons déjà enregistrés : écartés des statistiques comme les parties de test, sans être
-- supprimés. On garde la première partie de chaque compte pour chaque jour.
update public.games g
set test = true
where g.kind = 'daily'
  and g.user_id is not null
  and not g.test
  and exists (
    select 1 from public.games o
    where o.kind = 'daily'
      and o.user_id = g.user_id
      and o.challenge_day = g.challenge_day
      and not o.test
      and (o.created_at, o.id) < (g.created_at, g.id)
  );

create unique index games_one_daily_per_account
  on public.games (user_id, challenge_day)
  where kind = 'daily' and user_id is not null and not test;

-- Même fonction qu'avant, sauf qu'un doublon est ignoré : elle renvoie alors null.
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
    (a ->> 'correct')::boolean,
    least(greatest(coalesce((a ->> 'elapsed')::int, 0), 0), 60000)
  from jsonb_array_elements(list) with ordinality as t (a, ord);

  return new_id;
end;
$$;

-- Le bouton « Effacer mes statistiques » a disparu du site : cette fonction ne sert plus.
drop function public.delete_progress();
