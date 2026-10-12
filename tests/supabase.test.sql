-- Contrôles des fonctions de la base, joués par les tests sur un Postgres local.
\set ON_ERROR_STOP 1
set role anon;
select public.submit_game(jsonb_build_object('kind','daily','mode','it','day',(now() at time zone 'utc')::date,'score',180,'lang','fr',
  'answers', jsonb_build_array(
    jsonb_build_object('item','D 2006-227','artist','Cas','guess','Cas','correct',true,'elapsed',4200),
    jsonb_build_object('item','fr/JM  415f','artist','CB','guess','DR','correct',false,'elapsed',9000))));
select public.submit_game(jsonb_build_object('kind','mode','mode','tous','score',100,'test',true,
  'answers', jsonb_build_array(jsonb_build_object('item','D 2006-227','artist','Cas','guess','Cas','correct',true))));
do $$
declare live jsonb := public.live_stats((now() at time zone 'utc')::date);
begin
  assert (live ->> 'games_total')::int = 1, 'les parties de test ne comptent pas';
  assert (live ->> 'daily_players')::int = 1, 'un joueur au défi du jour';
  assert (public.daily_stats((now() at time zone 'utc')::date, 500) ->> 'better_than')::int = 100, 'rang';
  assert (select attempts from public.panel_stats(array['D 2006-227'])) = 1, 'stats de case sans les tests';
end $$;
-- Ce qui doit être refusé. Le refus est noté à part : une exception levée par le contrôle
-- lui-même serait sinon rattrapée comme un refus, et le contrôle ne pourrait jamais échouer.
\set QUIET 1
do $$
declare refused boolean;
begin
  begin perform count(*) from public.games; refused := false; exception when insufficient_privilege then refused := true; end;
  assert refused, 'lecture directe permise';
  begin perform public.submit_game(jsonb_build_object('kind','mode','mode','it','score',0,'answers', (select jsonb_agg(jsonb_build_object('item','a','artist','b','correct',false)) from generate_series(1, 9)))); refused := false; exception when raise_exception then refused := true; end;
  assert refused, 'neuf réponses acceptées';
  begin perform public.submit_game(jsonb_build_object('kind','archive','mode','it','day',(now() at time zone 'utc')::date + 5,'score',0,'answers', jsonb_build_array(jsonb_build_object('item','a','artist','b','correct',false)))); refused := false; exception when raise_exception then refused := true; end;
  assert refused, 'défi à venir accepté';
  begin perform public.submit_game(jsonb_build_object('kind','daily','mode','it','day','2020-01-01','score',0,'answers', jsonb_build_array(jsonb_build_object('item','a','artist','b','correct',false)))); refused := false; exception when raise_exception then refused := true; end;
  assert refused, 'vieux défi accepté';
end $$;
do $$ begin
  begin perform public.load_progress(); raise exception 'progression lisible sans compte'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Compte : écriture prudente, suppression.
insert into auth.users values ('11111111-1111-1111-1111-111111111111', 'j@example.org');
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$
declare first_stamp timestamptz;
begin
  assert public.load_progress() is null, 'pas encore de progression';
  first_stamp := public.save_progress('{"v":1}', null);
  assert first_stamp is not null, 'première écriture';
  assert public.save_progress('{"v":1}', null) is null, 'deuxième création refusée';
  assert public.save_progress('{"v":1,"x":1}', first_stamp) is not null, 'mise à jour sur la bonne version';
  assert public.save_progress('{"v":1,"x":2}', first_stamp) is null, 'mise à jour sur une version périmée refusée';
end $$;
-- Un défi du jour par compte et par jour : le deuxième envoi est ignoré, sans erreur.
do $$
declare
  today date := (now() at time zone 'utc')::date;
  one jsonb := jsonb_build_array(jsonb_build_object('item','D 2006-227','artist','Cas','guess','Cas','correct',true));
  first_id bigint;
begin
  first_id := public.submit_game(jsonb_build_object('kind','daily','mode','it','day',today,'score',150,'answers',one));
  assert first_id is not null, 'premier défi du compte enregistré';
  assert public.submit_game(jsonb_build_object('kind','daily','mode','it','day',today,'score',200,'answers',one)) is null, 'deuxième défi du compte ignoré';
  assert (public.live_stats(today) ->> 'daily_players')::int = 2, 'le compte ne compte qu''une fois';
  assert (select attempts from public.panel_stats(array['D 2006-227'])) = 2, 'les réponses du doublon ne comptent pas';
  assert public.submit_game(jsonb_build_object('kind','mode','mode','it','score',150,'answers',one)) is not null, 'les autres parties restent illimitées';
  perform public.delete_account();
end $$;
reset role;
do $$ begin
  assert (select count(*) from auth.users) = 0, 'compte supprimé';
  assert (select count(*) from public.progress) = 0, 'progression supprimée avec le compte';
  assert (select count(*) from public.games where user_id is null and kind = 'daily') = 2, 'les parties restent, anonymes';
end $$;
-- Après suppression, les parties du compte deviennent anonymes : un nouveau compte n'est pas bloqué.
insert into auth.users values ('22222222-2222-2222-2222-222222222222', 'k@example.org');
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $$ begin
  assert public.submit_game(jsonb_build_object('kind','daily','mode','it','day',(now() at time zone 'utc')::date,'score',150,
    'answers', jsonb_build_array(jsonb_build_object('item','x','artist','Cas','guess','Cas','correct',true)))) is not null, 'autre compte accepté';
  begin perform public.delete_progress(); raise exception 'delete_progress existe encore'; exception when undefined_function then null; end;
end $$;
reset role;
-- Le score et le « trouvé » sont recalculés par la base : ce qu'envoie le navigateur est ignoré.
set role anon;
select public.submit_game(jsonb_build_object('kind','mode','mode','tous','score',1600,'test',true,
  'answers', jsonb_build_array(
    jsonb_build_object('item','calc-1','artist','CB','guess','CB','correct',true,'elapsed',3750),
    jsonb_build_object('item','calc-2','artist','DR','guess','CB','correct',true,'elapsed',1000),
    jsonb_build_object('item','calc-3','artist','VR','guess',null,'correct',true,'elapsed',15000),
    jsonb_build_object('item','calc-4','artist','PM','guess','PM','correct',false,'elapsed',9000))));
reset role;
do $$ begin
  assert (select g.score from public.games g join public.answers a on a.game_id = g.id where a.item = 'calc-1') = 250, 'score recalculé (150 + 100)';
  assert (select g.correct from public.games g join public.answers a on a.game_id = g.id where a.item = 'calc-1') = 2, 'cases trouvées recalculées';
  assert (select array_agg(correct order by position) from public.answers where item like 'calc-%') = array[true, false, false, true], 'trouvé = bonne réponse';
end $$;
-- Envois en rafale : soixante parties par adresse en dix minutes, puis plus rien.
set role anon;
select set_config('request.headers', '{"x-forwarded-for": "203.0.113.7, 10.0.0.1"}', false);
do $$
declare
  one jsonb := jsonb_build_object('kind','mode','mode','tous','score',0,'test',true,
    'answers', jsonb_build_array(jsonb_build_object('item','rafale','artist','CB','guess','DR','correct',false)));
begin
  for i in 1..60 loop
    assert public.submit_game(one) is not null, 'envoi accepté sous la limite';
  end loop;
  assert public.submit_game(one) is null, 'soixante et unième envoi ignoré';
  perform set_config('request.headers', '{"x-forwarded-for": "198.51.100.4"}', false);
  assert public.submit_game(one) is not null, 'une autre adresse peut envoyer';
  -- L'adresse posée par le proxy passe avant celle que le navigateur pourrait inventer.
  perform set_config('request.headers', '{"cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "192.0.2.99"}', false);
  assert public.submit_game(one) is null, 'cf-connecting-ip compte avant x-forwarded-for';
  begin perform count(*) from duckdle_private.submissions; raise exception 'empreintes lisibles'; exception when insufficient_privilege then null; end;
  perform set_config('request.headers', '', false);
end $$;
reset role;
do $$ begin
  assert (select count(*) from duckdle_private.submissions where sender like '%203.0.113.7%') = 0, 'jamais l''adresse en clair';
end $$;
\echo 'Base : tous les contrôles passent'
