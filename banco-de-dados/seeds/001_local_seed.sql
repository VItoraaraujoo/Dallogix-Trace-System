SET NAMES utf8mb4;

INSERT INTO
  companies (name)
SELECT
  'Empresa Demonstração'
WHERE
  NOT EXISTS (
    SELECT
      1
    FROM
      companies
    WHERE
      name = 'Empresa Demonstração'
  );

INSERT INTO
  equipments (company_id, equipment_code, name)
SELECT
  c.id,
  'EST-001',
  'Esteira principal'
FROM
  companies c
WHERE
  c.name = 'Empresa Demonstração'
  AND NOT EXISTS (
    SELECT
      1
    FROM
      equipments e
    WHERE
      e.equipment_code = 'EST-001'
  );

INSERT INTO
  users (company_id, name, email, password_hash, role)
SELECT
  c.id,
  'Administrador local',
  'admin@dallogix.local',
  '$2y$10$ebOT1MqNyajFths8pCaJu.qE7MOSNMWkXYLan9LVzGSXFHIdgxK8C',
  'ADMIN_EMPRESA'
FROM
  companies c
WHERE
  c.name = 'Empresa Demonstração'
  AND NOT EXISTS (
    SELECT
      1
    FROM
      users
    WHERE
      email = 'admin@dallogix.local'
  );

INSERT INTO
  products (company_id, code, name)
SELECT
  c.id,
  'PROD3',
  'Ração cães adulto • 10,1 KG'
FROM
  companies c
WHERE
  c.name = 'Empresa Demonstração'
  AND NOT EXISTS (
    SELECT
      1
    FROM
      products p
    WHERE
      p.code = 'PROD3'
  );

INSERT INTO
  product_codes (product_id, barcode)
SELECT
  p.id,
  '7898250782592'
FROM
  products p
WHERE
  p.code = 'PROD3'
  AND NOT EXISTS (
    SELECT
      1
    FROM
      product_codes pc
    WHERE
      pc.barcode = '7898250782592'
  );

INSERT INTO
  users (company_id, name, email, password_hash, role)
SELECT
  NULL,
  'Administrador Dallogix',
  'master@dallogix.local',
  '$2y$10$ebOT1MqNyajFths8pCaJu.qE7MOSNMWkXYLan9LVzGSXFHIdgxK8C',
  'ADMIN_DALLOGIX'
WHERE
  NOT EXISTS (
    SELECT
      1
    FROM
      users
    WHERE
      email = 'master@dallogix.local'
  );
