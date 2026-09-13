-- DIAGNOSTICO DE TABELAS
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'patients';

-- Chave primaria e RLS
SELECT * FROM pg_policies WHERE tablename = 'patients';
