-- Reforça no banco os vínculos que já são exigidos pelos fluxos da aplicação.
-- Os campos de empresa repetidos permitem que o MySQL impeça ligações cruzadas.
DROP PROCEDURE IF EXISTS trace_ensure_columns_067;
DELIMITER //
CREATE PROCEDURE trace_ensure_columns_067()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'romaneio_itens'
      AND column_name = 'company_id'
  ) THEN
    ALTER TABLE romaneio_itens ADD COLUMN company_id BIGINT UNSIGNED NULL AFTER id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'romaneios'
      AND column_name = 'assigned_installation_company_id'
  ) THEN
    ALTER TABLE romaneios ADD COLUMN assigned_installation_company_id BIGINT UNSIGNED NULL
      AFTER assigned_installation_id;
  END IF;
END//
DELIMITER ;
CALL trace_ensure_columns_067();
DROP PROCEDURE trace_ensure_columns_067;

UPDATE romaneio_itens ri
JOIN romaneios r ON r.id = ri.romaneio_id
SET ri.company_id = r.company_id
WHERE ri.company_id IS NULL;

UPDATE romaneios
SET assigned_installation_company_id = company_id
WHERE assigned_installation_id IS NOT NULL
  AND assigned_installation_company_id IS NULL;

DROP PROCEDURE IF EXISTS trace_validate_relations_067;
DELIMITER //
CREATE PROCEDURE trace_validate_relations_067()
BEGIN
  IF EXISTS (
    SELECT 1
    FROM romaneio_itens ri
    JOIN romaneios r ON r.id = ri.romaneio_id
    LEFT JOIN produtos p ON p.id = ri.product_id
    LEFT JOIN romaneio_caminhoes t ON t.id = ri.truck_id
    WHERE ri.company_id IS NULL OR ri.company_id <> r.company_id
       OR p.id IS NULL OR p.company_id <> r.company_id
       OR (ri.truck_id IS NOT NULL AND (t.id IS NULL OR t.romaneio_id <> ri.romaneio_id))
    LIMIT 1
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Migration 067 bloqueada: item de romaneio tem empresa, produto ou caminhão incompatível.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM carregamentos c
    LEFT JOIN romaneios r ON r.id = c.romaneio_id
    LEFT JOIN equipamentos e ON e.id = c.equipment_id
    LEFT JOIN romaneio_caminhoes t ON t.id = c.truck_id
    WHERE r.id IS NULL OR r.company_id <> c.company_id
       OR e.id IS NULL OR e.company_id <> c.company_id
       OR t.id IS NULL OR t.romaneio_id <> c.romaneio_id
    LIMIT 1
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Migration 067 bloqueada: carregamento tem empresa, Dala, romaneio ou caminhão incompatível.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM romaneios r
    LEFT JOIN instalacoes_industriais i ON i.id = r.assigned_installation_id
    WHERE r.assigned_installation_id IS NOT NULL
      AND (i.id IS NULL OR i.company_id <> r.company_id
           OR r.assigned_installation_company_id <> r.company_id)
    LIMIT 1
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Migration 067 bloqueada: romaneio está atribuído a um PC industrial de outra empresa.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM romaneios
    WHERE (assigned_installation_id IS NULL AND assigned_installation_company_id IS NOT NULL)
       OR (assigned_installation_id IS NOT NULL AND assigned_installation_company_id IS NULL)
    LIMIT 1
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Migration 067 bloqueada: atribuição de instalação está incompleta.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM api_romaneios_idempotencia i
    LEFT JOIN chaves_api_integracao k ON k.id = i.api_key_id
    LEFT JOIN romaneios r ON r.id = i.romaneio_id
    WHERE k.id IS NULL OR k.company_id <> i.company_id
       OR (i.romaneio_id IS NOT NULL AND (r.id IS NULL OR r.company_id <> i.company_id))
    LIMIT 1
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Migration 067 bloqueada: registro de idempotência está vinculado a outra empresa.';
  END IF;
END//
DELIMITER ;
CALL trace_validate_relations_067();
DROP PROCEDURE trace_validate_relations_067;

ALTER TABLE romaneio_itens MODIFY company_id BIGINT UNSIGNED NOT NULL;

DROP PROCEDURE IF EXISTS trace_ensure_integrity_indexes_067;
DELIMITER //
CREATE PROCEDURE trace_ensure_integrity_indexes_067()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'romaneios' AND index_name = 'uq_romaneio_id_company') THEN
    ALTER TABLE romaneios ADD UNIQUE KEY uq_romaneio_id_company (id, company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'produtos' AND index_name = 'uq_produto_id_company') THEN
    ALTER TABLE produtos ADD UNIQUE KEY uq_produto_id_company (id, company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'equipamentos' AND index_name = 'uq_equipamento_id_company') THEN
    ALTER TABLE equipamentos ADD UNIQUE KEY uq_equipamento_id_company (id, company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'romaneio_caminhoes' AND index_name = 'uq_caminhao_id_romaneio') THEN
    ALTER TABLE romaneio_caminhoes ADD UNIQUE KEY uq_caminhao_id_romaneio (id, romaneio_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'instalacoes_industriais' AND index_name = 'uq_instalacao_id_company') THEN
    ALTER TABLE instalacoes_industriais ADD UNIQUE KEY uq_instalacao_id_company (id, company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'chaves_api_integracao' AND index_name = 'uq_api_key_id_company') THEN
    ALTER TABLE chaves_api_integracao ADD UNIQUE KEY uq_api_key_id_company (id, company_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'romaneio_itens' AND index_name = 'idx_item_romaneio_company') THEN
    ALTER TABLE romaneio_itens ADD KEY idx_item_romaneio_company (romaneio_id, company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'romaneio_itens' AND index_name = 'idx_item_product_company') THEN
    ALTER TABLE romaneio_itens ADD KEY idx_item_product_company (product_id, company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'romaneio_itens' AND index_name = 'idx_item_truck_romaneio') THEN
    ALTER TABLE romaneio_itens ADD KEY idx_item_truck_romaneio (truck_id, romaneio_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'carregamentos' AND index_name = 'idx_loading_romaneio_company') THEN
    ALTER TABLE carregamentos ADD KEY idx_loading_romaneio_company (romaneio_id, company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'carregamentos' AND index_name = 'idx_loading_equipment_company') THEN
    ALTER TABLE carregamentos ADD KEY idx_loading_equipment_company (equipment_id, company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'carregamentos' AND index_name = 'idx_loading_truck_romaneio') THEN
    ALTER TABLE carregamentos ADD KEY idx_loading_truck_romaneio (truck_id, romaneio_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'romaneios' AND index_name = 'idx_romaneio_assigned_company') THEN
    ALTER TABLE romaneios ADD KEY idx_romaneio_assigned_company (assigned_installation_id, assigned_installation_company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'api_romaneios_idempotencia' AND index_name = 'idx_api_idempotency_key_company') THEN
    ALTER TABLE api_romaneios_idempotencia ADD KEY idx_api_idempotency_key_company (api_key_id, company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'api_romaneios_idempotencia' AND index_name = 'idx_api_idempotency_romaneio_company') THEN
    ALTER TABLE api_romaneios_idempotencia ADD KEY idx_api_idempotency_romaneio_company (romaneio_id, company_id);
  END IF;
END//
DELIMITER ;
CALL trace_ensure_integrity_indexes_067();
DROP PROCEDURE trace_ensure_integrity_indexes_067;

DROP PROCEDURE IF EXISTS trace_ensure_integrity_constraints_067;
DELIMITER //
CREATE PROCEDURE trace_ensure_integrity_constraints_067()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = 'romaneio_itens' AND constraint_name = 'fk_item_romaneio_company') THEN
    ALTER TABLE romaneio_itens ADD CONSTRAINT fk_item_romaneio_company FOREIGN KEY (romaneio_id, company_id) REFERENCES romaneios (id, company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = 'romaneio_itens' AND constraint_name = 'fk_item_product_company') THEN
    ALTER TABLE romaneio_itens ADD CONSTRAINT fk_item_product_company FOREIGN KEY (product_id, company_id) REFERENCES produtos (id, company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = 'romaneio_itens' AND constraint_name = 'fk_item_truck_romaneio') THEN
    ALTER TABLE romaneio_itens ADD CONSTRAINT fk_item_truck_romaneio FOREIGN KEY (truck_id, romaneio_id) REFERENCES romaneio_caminhoes (id, romaneio_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = 'carregamentos' AND constraint_name = 'fk_loading_romaneio_company') THEN
    ALTER TABLE carregamentos ADD CONSTRAINT fk_loading_romaneio_company FOREIGN KEY (romaneio_id, company_id) REFERENCES romaneios (id, company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = 'carregamentos' AND constraint_name = 'fk_loading_equipment_company') THEN
    ALTER TABLE carregamentos ADD CONSTRAINT fk_loading_equipment_company FOREIGN KEY (equipment_id, company_id) REFERENCES equipamentos (id, company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = 'carregamentos' AND constraint_name = 'fk_loading_truck_romaneio') THEN
    ALTER TABLE carregamentos ADD CONSTRAINT fk_loading_truck_romaneio FOREIGN KEY (truck_id, romaneio_id) REFERENCES romaneio_caminhoes (id, romaneio_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = 'romaneios' AND constraint_name = 'fk_romaneio_assigned_installation_company') THEN
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = 'romaneios' AND constraint_name = 'fk_romaneio_assigned_installation') THEN
      ALTER TABLE romaneios DROP FOREIGN KEY fk_romaneio_assigned_installation;
    END IF;
    ALTER TABLE romaneios ADD CONSTRAINT fk_romaneio_assigned_installation_company
      FOREIGN KEY (assigned_installation_id, assigned_installation_company_id)
      REFERENCES instalacoes_industriais (id, company_id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = 'api_romaneios_idempotencia' AND constraint_name = 'fk_api_idempotency_key_company') THEN
    ALTER TABLE api_romaneios_idempotencia ADD CONSTRAINT fk_api_idempotency_key_company
      FOREIGN KEY (api_key_id, company_id) REFERENCES chaves_api_integracao (id, company_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = 'api_romaneios_idempotencia' AND constraint_name = 'fk_api_idempotency_romaneio_company') THEN
    ALTER TABLE api_romaneios_idempotencia ADD CONSTRAINT fk_api_idempotency_romaneio_company
      FOREIGN KEY (romaneio_id, company_id) REFERENCES romaneios (id, company_id);
  END IF;
END//
DELIMITER ;
CALL trace_ensure_integrity_constraints_067();
DROP PROCEDURE trace_ensure_integrity_constraints_067;

-- MySQL não permite CHECK nas colunas alcançadas por ON DELETE SET NULL.
-- Os gatilhos validam o par em escritas normais; a cascata de FK desassocia
-- os dois campos sem disparar gatilhos, mantendo o par nulo ao excluir o PC.
DROP TRIGGER IF EXISTS trg_romaneios_installation_pair_insert_067;
DROP TRIGGER IF EXISTS trg_romaneios_installation_pair_update_067;
DELIMITER //
CREATE TRIGGER trg_romaneios_installation_pair_insert_067
BEFORE INSERT ON romaneios
FOR EACH ROW
BEGIN
  IF (NEW.assigned_installation_id IS NULL AND NEW.assigned_installation_company_id IS NOT NULL)
     OR (NEW.assigned_installation_id IS NOT NULL AND NEW.assigned_installation_company_id IS NULL) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'A atribuição do PC industrial deve informar o PC e a empresa juntos.';
  END IF;
END//
CREATE TRIGGER trg_romaneios_installation_pair_update_067
BEFORE UPDATE ON romaneios
FOR EACH ROW
BEGIN
  IF (NEW.assigned_installation_id IS NULL AND NEW.assigned_installation_company_id IS NOT NULL)
     OR (NEW.assigned_installation_id IS NOT NULL AND NEW.assigned_installation_company_id IS NULL) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'A atribuição do PC industrial deve informar o PC e a empresa juntos.';
  END IF;
END//
DELIMITER ;
