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
-- Ce qui doit être refusé.
\set ON_ERROR_STOP 0
\set QUIET 1
do $$ begin
  begin perform count(*) from public.games; raise exception 'lecture directe permise'; exception when insufficient_privilege then null; end;
  begin perform public.submit_game(jsonb_build_object('kind','mode','mode','it','score',1600,'answers', jsonb_build_array(jsonb_build_object('item','a','artist','b','guess','b','correct',true)))); raise exception 'score impossible accepté'; exception when check_violation then null; end;
  begin perform public.submit_game(jsonb_build_object('kind','daily','mode','it','day','2020-01-01','score',0,'answers', jsonb_build_array(jsonb_build_object('item','a','artist','b','correct',false)))); raise exception 'vieux défi accepté'; exception when raise_exception then null; end;
end $$;
\set ON_ERROR_STOP 1
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
  perform public.delete_account();
end $$;
reset role;
do $$ begin
  assert (select count(*) from auth.users) = 0, 'compte supprimé';
  assert (select count(*) from public.progress) = 0, 'progression supprimée avec le compte';
end $$;
\echo 'Base : tous les contrôles passent'
