-- 一次性追加：每個目前帳號 +600000 金幣、+200 張十連券。
-- 執行前備份資料庫；固定 grant_key 防同一帳號重複領取。不要更名後重跑。
BEGIN;
SELECT pg_advisory_xact_lock(148062,1);
DO $grant$
DECLARE
  grant_key constant text := 'admin_grant_20261017_600000_200';
  template constant jsonb := $save${"v":3,"name":"Trainer","created":0,"updated":0,"coins":500,"owned":{},"shiny":{},"partner":null,"partnerShiny":false,"starter":null,"personality":null,"upgrades":{},"pupg":{},"tickets":{"t1":0,"t10":0},"pity":{},"legends":{},"arenas":{},"itemsFound":{},"evoMoves":{},"ach":{},"missions":{},"profile":{"favs":[],"title":""},"stats":{"runs":0,"bestTime":0,"bestLevel":0,"totalKills":0,"pulls":0,"coinsEarned":0,"shinies":0,"bossesTotal":0,"riftWins":0,"evolutions":0,"missionsDone":0,"groupRuns":0,"bestGroupTime":0}}$save$::jsonb;
  row record;
  doc jsonb;
  s jsonb;
  ledger jsonb;
  e jsonb;
  balance_c numeric;
  balance_t10 numeric;
  sum_c numeric;
  sum_t10 numeric;
  now_ms bigint := floor(extract(epoch FROM clock_timestamp())*1000);
  affected integer := 0;
  initialized integer := 0;
BEGIN
  FOR row IN SELECT u.id,u.display_name,v.data FROM users u LEFT JOIN saves v ON v.id=u.id ORDER BY u.id LOOP
    doc := row.data;
    IF doc IS NULL THEN
      s := template || jsonb_build_object('name',row.display_name,'created',now_ms,'updated',now_ms);
      doc := jsonb_build_object('v',3,'save',s);
      initialized := initialized+1;
    ELSE
      s := doc->'save';
    END IF;
    IF jsonb_typeof(s) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '存檔結構異常，整批配發回滾'; END IF;
    IF COALESCE(s->'led','{}'::jsonb) ? grant_key THEN CONTINUE; END IF;
    IF jsonb_typeof(s->'coins') IS DISTINCT FROM 'number' OR jsonb_typeof(s->'tickets'->'t10') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION '餘額格式異常，整批配發回滾';
    END IF;
    balance_c := (s->>'coins')::numeric;
    balance_t10 := (s->'tickets'->>'t10')::numeric;
    IF balance_c<0 OR balance_c>999999400000 OR balance_t10<0 OR balance_t10>999999999800 THEN
      RAISE EXCEPTION '餘額超出安全範圍，整批配發回滾';
    END IF;
    ledger := s->'led';
    IF ledger IS NULL OR ledger='null'::jsonb THEN
      ledger := jsonb_build_object('base',jsonb_build_object('c',jsonb_build_array(balance_c,0),'t1',jsonb_build_array(COALESCE((s->'tickets'->>'t1')::numeric,0),0),'t10',jsonb_build_array(balance_t10,0)));
    END IF;
    IF jsonb_typeof(ledger) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '帳本格式異常，整批配發回滾'; END IF;
    sum_c := 0; sum_t10 := 0;
    FOR e IN SELECT value FROM jsonb_each(ledger) LOOP
      IF jsonb_typeof(e) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '帳本分項格式異常，整批配發回滾'; END IF;
      IF e ? 'c' THEN
        IF jsonb_typeof(e->'c') IS DISTINCT FROM 'array' OR jsonb_array_length(e->'c')<>2 OR jsonb_typeof(e->'c'->0) IS DISTINCT FROM 'number' OR jsonb_typeof(e->'c'->1) IS DISTINCT FROM 'number' OR (e->'c'->>0)::numeric<0 OR (e->'c'->>1)::numeric<0 THEN RAISE EXCEPTION '金幣帳本異常，整批配發回滾'; END IF;
        sum_c := sum_c+(e->'c'->>0)::numeric-(e->'c'->>1)::numeric;
      END IF;
      IF e ? 't10' THEN
        IF jsonb_typeof(e->'t10') IS DISTINCT FROM 'array' OR jsonb_array_length(e->'t10')<>2 OR jsonb_typeof(e->'t10'->0) IS DISTINCT FROM 'number' OR jsonb_typeof(e->'t10'->1) IS DISTINCT FROM 'number' OR (e->'t10'->>0)::numeric<0 OR (e->'t10'->>1)::numeric<0 THEN RAISE EXCEPTION '十連券帳本異常，整批配發回滾'; END IF;
        sum_t10 := sum_t10+(e->'t10'->>0)::numeric-(e->'t10'->>1)::numeric;
      END IF;
    END LOOP;
    IF sum_c<>balance_c OR sum_t10<>balance_t10 THEN RAISE EXCEPTION '餘額與帳本不一致，整批配發回滾；請先排查，不要直接覆蓋帳本'; END IF;
    ledger := ledger || jsonb_build_object(grant_key,jsonb_build_object('c',jsonb_build_array(600000,0),'t10',jsonb_build_array(200,0)));
    s := s || jsonb_build_object('coins',greatest(0,sum_c+600000),'tickets',(s->'tickets')||jsonb_build_object('t10',greatest(0,sum_t10+200)),'led',ledger,'updated',now_ms);
    doc := doc || jsonb_build_object('save',s,'updatedAt',now_ms);
    INSERT INTO saves(id,data) VALUES(row.id,doc) ON CONFLICT(id) DO UPDATE SET data=excluded.data,revision=saves.revision+1;
    affected := affected+1;
  END LOOP;
  RAISE NOTICE '配發完成：% 個帳號，包含 % 個原無存檔帳號；重跑相同標記不會重複入帳',affected,initialized;
END
$grant$;
COMMIT;
