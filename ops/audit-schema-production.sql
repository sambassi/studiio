-- ============================================================================
-- AUDIT DU SCHEMA REEL DE PRODUCTION -- STRICTEMENT EN LECTURE SEULE
--
-- Compare la base a ce dont les deux migrations ont besoin :
--   migrations/2026-08-27-credits-atomiques.sql
--   migrations/2026-08-28-rendus-preuve-serveur.sql
--
-- Le script n'ecrit rien, ne cree aucune table temporaire, et n'affiche
-- aucune donnee personnelle : uniquement des noms, des types, des etats et
-- des totaux. La transaction est ouverte READ ONLY et refermee par ROLLBACK :
-- le moteur lui-meme refuserait toute ecriture.
--
-- ASCII pur, volontairement : aucun caractere accentue ni de dessin de
-- boite, qui se corrompent au copier-coller entre terminaux.
-- ============================================================================

BEGIN TRANSACTION READ ONLY;

DO $audit$
DECLARE
  v_ok      boolean;
  v_txt     text;
  v_n       bigint;
  v_col_ref boolean;
  v_col_des boolean;
  v_refs    bigint;
  v_dbl     bigint;
  v_bloque  int := 0;
BEGIN
  RAISE NOTICE '--------- 1. OBJETS QUI DOIVENT DEJA EXISTER ---------';

  FOREACH v_txt IN ARRAY ARRAY['public.users','public.credit_transactions'] LOOP
    v_ok := to_regclass(v_txt) IS NOT NULL;
    RAISE NOTICE 'table % : %',
      rpad(v_txt,30),
      CASE WHEN v_ok THEN 'PRESENTE' ELSE 'ABSENTE  <<< BLOQUANT' END;
    IF NOT v_ok THEN v_bloque := v_bloque + 1; END IF;
  END LOOP;

  FOR v_txt, v_ok IN
    SELECT c.tbl || '.' || c.col,
           EXISTS (SELECT 1
                     FROM information_schema.columns i
                    WHERE i.table_schema = 'public'
                      AND i.table_name   = c.tbl
                      AND i.column_name  = c.col
                      AND i.data_type    = c.typ)
      FROM (VALUES
              ('users','id','uuid'),
              ('users','credits','integer'),
              ('credit_transactions','id','uuid'),
              ('credit_transactions','user_id','uuid'),
              ('credit_transactions','amount','integer')
           ) AS c(tbl,col,typ)
  LOOP
    RAISE NOTICE 'colonne % : %',
      rpad(v_txt,30),
      CASE WHEN v_ok THEN 'OK (type attendu)' ELSE 'MANQUANTE OU MAUVAIS TYPE  <<< BLOQUANT' END;
    IF NOT v_ok THEN v_bloque := v_bloque + 1; END IF;
  END LOOP;

  SELECT column_default IS NOT NULL INTO v_ok
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'credit_transactions'
     AND column_name  = 'id';
  RAISE NOTICE 'defaut credit_transactions.id  : %',
    CASE WHEN coalesce(v_ok,false) THEN 'PRESENT'
         ELSE 'ABSENT  <<< BLOQUANT (les fonctions inserent sans id)' END;
  IF NOT coalesce(v_ok,false) THEN v_bloque := v_bloque + 1; END IF;

  SELECT EXISTS (SELECT 1
                   FROM pg_constraint con
                   JOIN pg_class cl ON cl.oid = con.conrelid
                   JOIN pg_namespace ns ON ns.oid = cl.relnamespace
                  WHERE ns.nspname = 'public'
                    AND cl.relname = 'credit_transactions'
                    AND con.contype = 'c'
                    AND pg_get_constraintdef(con.oid) ILIKE '%render%')
    INTO v_ok;
  RAISE NOTICE 'check type autorise "render"   : %',
    CASE WHEN v_ok THEN 'OUI'
         ELSE 'NON  <<< BLOQUANT (les fonctions ecrivent type=render)' END;
  IF NOT v_ok THEN v_bloque := v_bloque + 1; END IF;

  FOR v_txt, v_ok IN
    SELECT t.n,
           EXISTS (SELECT 1
                     FROM pg_constraint con
                     JOIN pg_class cl ON cl.oid = con.conrelid
                     JOIN pg_namespace ns ON ns.oid = cl.relnamespace
                    WHERE ns.nspname = 'public'
                      AND cl.relname = t.n
                      AND con.contype IN ('p','u')
                      AND con.conkey = ARRAY[(SELECT a.attnum
                                                FROM pg_attribute a
                                               WHERE a.attrelid = cl.oid
                                                 AND a.attname = 'id')])
      FROM (VALUES ('users'),('credit_transactions')) AS t(n)
  LOOP
    RAISE NOTICE 'cle sur %.id (cible de FK) : %',
      rpad(v_txt,20),
      CASE WHEN v_ok THEN 'OK' ELSE 'ABSENTE  <<< BLOQUANT' END;
    IF NOT v_ok THEN v_bloque := v_bloque + 1; END IF;
  END LOOP;

  SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'gen_random_uuid') INTO v_ok;
  RAISE NOTICE 'fonction gen_random_uuid()     : %',
    CASE WHEN v_ok THEN 'DISPONIBLE' ELSE 'ABSENTE  <<< BLOQUANT' END;
  IF NOT v_ok THEN v_bloque := v_bloque + 1; END IF;

  RAISE NOTICE '';
  RAISE NOTICE '--------- 2. COLONNES CREEES PAR LA MIGRATION (absence = conforme) ---------';

  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='credit_transactions'
                    AND column_name='reference_id') INTO v_col_ref;
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='credit_transactions'
                    AND column_name='description') INTO v_col_des;

  RAISE NOTICE 'credit_transactions.reference_id : %',
    CASE WHEN v_col_ref THEN 'DEJA PRESENTE (la migration la laissera telle quelle)'
         ELSE 'ABSENTE -- ETAT INITIAL CONFORME, la migration la cree' END;
  RAISE NOTICE 'credit_transactions.description  : %',
    CASE WHEN v_col_des THEN 'DEJA PRESENTE (la migration la laissera telle quelle)'
         ELSE 'ABSENTE -- ETAT INITIAL CONFORME, la migration la cree' END;

  IF v_col_ref THEN
    EXECUTE 'SELECT count(*) FROM public.credit_transactions WHERE reference_id IS NOT NULL'
      INTO v_refs;
    EXECUTE 'SELECT count(*) FROM (SELECT 1 FROM public.credit_transactions '
         || 'WHERE reference_id IS NOT NULL GROUP BY user_id, reference_id '
         || 'HAVING count(*) > 1) d'
      INTO v_dbl;
    RAISE NOTICE '  references non nulles : %   doublons : %', v_refs, v_dbl;
    IF v_dbl > 0 THEN
      RAISE NOTICE '  <<< BLOQUANT : l''index unique partiel echouera';
      v_bloque := v_bloque + 1;
    END IF;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '--------- 3. OBJETS QUI DOIVENT ETRE ABSENTS ---------';

  FOREACH v_txt IN ARRAY ARRAY['public.tarifs_rendu','public.rendus'] LOOP
    v_ok := to_regclass(v_txt) IS NULL;
    RAISE NOTICE 'table % : %',
      rpad(v_txt,30),
      CASE WHEN v_ok THEN 'ABSENTE (attendu)' ELSE 'DEJA PRESENTE  <<< BLOQUANT' END;
    IF NOT v_ok THEN v_bloque := v_bloque + 1; END IF;
  END LOOP;

  FOR v_txt, v_ok IN
    SELECT f.n,
           NOT EXISTS (SELECT 1
                         FROM pg_proc p
                         JOIN pg_namespace ns ON ns.oid = p.pronamespace
                        WHERE ns.nspname = 'public' AND p.proname = f.n)
      FROM (VALUES ('debiter_credits'),('confirmer_rendu'),('clore_rendu')) AS f(n)
  LOOP
    RAISE NOTICE 'fonction % : %',
      rpad(v_txt,30),
      CASE WHEN v_ok THEN 'ABSENTE (attendu)' ELSE 'DEJA PRESENTE  <<< BLOQUANT' END;
    IF NOT v_ok THEN v_bloque := v_bloque + 1; END IF;
  END LOOP;

  SELECT NOT EXISTS (SELECT 1 FROM pg_indexes
                      WHERE schemaname = 'public'
                        AND indexname = 'credit_transactions_reference_unique')
    INTO v_ok;
  RAISE NOTICE 'index credit_transactions_reference_unique : %',
    CASE WHEN v_ok THEN 'ABSENT (attendu)' ELSE 'DEJA PRESENT  <<< BLOQUANT' END;
  IF NOT v_ok THEN v_bloque := v_bloque + 1; END IF;

  SELECT NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'users_credits_non_negatif')
    INTO v_ok;
  RAISE NOTICE 'contrainte users_credits_non_negatif       : %',
    CASE WHEN v_ok THEN 'ABSENTE (attendu)' ELSE 'DEJA PRESENTE  <<< BLOQUANT' END;
  IF NOT v_ok THEN v_bloque := v_bloque + 1; END IF;

  RAISE NOTICE '';
  RAISE NOTICE '--------- 4. TEMOINS (totaux seuls, aucune donnee personnelle) ---------';

  SELECT count(*) INTO v_n FROM public.users;
  RAISE NOTICE 'users              : %', v_n;

  SELECT coalesce(sum(credits),0) INTO v_n FROM public.users;
  RAISE NOTICE 'credits_total      : %', v_n;

  SELECT count(*) INTO v_n FROM public.users WHERE credits < 0;
  RAISE NOTICE 'soldes_negatifs    : %   (non bloquant, contrainte NOT VALID)', v_n;

  SELECT count(*) INTO v_n FROM public.credit_transactions;
  RAISE NOTICE 'transactions       : %', v_n;

  RAISE NOTICE '';
  IF v_bloque = 0 THEN
    RAISE NOTICE '=========  VERDICT : SCHEMA COMPATIBLE -- 0 blocage  =========';
  ELSE
    RAISE NOTICE '=========  VERDICT : % BLOCAGE(S) -- NE PAS MIGRER  =========', v_bloque;
  END IF;
END
$audit$;

ROLLBACK;
