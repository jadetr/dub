-- Translated from packages/tinybird/datasources/*.datasource.
-- Tinybird's `json:$.field` ingestion hints are dropped (we ingest with
-- input_format_skip_unknown_fields=1 + JSONEachRow). Engine config preserved.

CREATE DATABASE IF NOT EXISTS dub;

-- ============ EVENTS ============

CREATE TABLE IF NOT EXISTS dub.dub_click_events
(
    `timestamp`        DateTime64(3),
    `click_id`         String,
    `link_id`          String,
    `alias_link_id`    Nullable(String),
    `url`              String,
    `country`          LowCardinality(String),
    `city`             String,
    `region`           String,
    `latitude`         String,
    `longitude`        String,
    `device`           LowCardinality(String),
    `device_model`     LowCardinality(String),
    `device_vendor`    LowCardinality(String),
    `browser`          LowCardinality(String),
    `browser_version`  String,
    `os`               LowCardinality(String),
    `os_version`       String,
    `engine`           LowCardinality(String),
    `engine_version`   String,
    `cpu_architecture` LowCardinality(String),
    `ua`               String,
    `bot`              UInt8,
    `referer`          String,
    `referer_url`      String,
    `user_id`          Nullable(Int64),
    `identity_hash`    Nullable(String),
    `ip`               String,
    `qr`               UInt8,
    `continent`        LowCardinality(String),
    `vercel_region`    Nullable(String),
    `trigger`          String,
    `workspace_id`     Nullable(String),
    `domain`           Nullable(String),
    `key`              Nullable(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (timestamp, link_id, click_id);

CREATE TABLE IF NOT EXISTS dub.dub_lead_events
(
    `timestamp`        DateTime64(3) DEFAULT now(),
    `event_id`         String,
    `event_name`       String,
    `customer_id`      String,
    `click_id`         String,
    `link_id`          String,
    `url`              String,
    `continent`        LowCardinality(String),
    `country`          LowCardinality(String),
    `city`             String,
    `region`           String,
    `latitude`         String,
    `longitude`        String,
    `device`           LowCardinality(String),
    `device_model`     LowCardinality(String),
    `device_vendor`    LowCardinality(String),
    `browser`          LowCardinality(String),
    `browser_version`  String,
    `os`               LowCardinality(String),
    `os_version`       String,
    `engine`           LowCardinality(String),
    `engine_version`   String,
    `cpu_architecture` LowCardinality(String),
    `ua`               String,
    `bot`              UInt8,
    `referer`          String,
    `referer_url`      String,
    `ip`               String,
    `qr`               UInt8,
    `metadata`         String,
    `trigger`          String,
    `domain`           Nullable(String),
    `key`              Nullable(String),
    `workspace_id`     Nullable(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (timestamp, link_id, customer_id);

CREATE TABLE IF NOT EXISTS dub.dub_sale_events
(
    `timestamp`         DateTime64(3) DEFAULT now(),
    `event_id`          String,
    `event_name`        String,
    `customer_id`       String,
    `payment_processor` LowCardinality(String),
    `invoice_id`        String,
    `amount`            UInt32,
    `currency`          LowCardinality(String),
    `click_id`          String,
    `link_id`           String,
    `url`               String,
    `continent`         LowCardinality(String),
    `country`           LowCardinality(String),
    `city`              String,
    `region`            String,
    `latitude`          String,
    `longitude`         String,
    `device`            LowCardinality(String),
    `device_model`      LowCardinality(String),
    `device_vendor`     LowCardinality(String),
    `browser`           LowCardinality(String),
    `browser_version`   String,
    `os`                LowCardinality(String),
    `os_version`        String,
    `engine`            LowCardinality(String),
    `engine_version`    String,
    `cpu_architecture`  LowCardinality(String),
    `ua`                String,
    `bot`               UInt8,
    `referer`           String,
    `referer_url`       String,
    `ip`                String,
    `qr`                UInt8,
    `metadata`          String,
    `trigger`           String,
    `domain`            Nullable(String),
    `key`               Nullable(String),
    `workspace_id`      Nullable(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (timestamp, link_id);

-- ============ LINK METADATA ============

CREATE TABLE IF NOT EXISTS dub.dub_links_metadata
(
    `timestamp`        DateTime DEFAULT now(),
    `link_id`          String,
    `domain`           String,
    `key`              String,
    `url`              String,
    `tag_ids`          Array(String),
    `workspace_id`     String,
    `created_at`       DateTime64(3),
    `deleted`          UInt8,
    `program_id`       String,
    `tenant_id`        String,
    `partner_id`       String,
    `folder_id`        String,
    `partner_group_id` String
)
ENGINE = MergeTree
PARTITION BY toYear(timestamp)
ORDER BY (timestamp, link_id, workspace_id);

CREATE TABLE IF NOT EXISTS dub.dub_links_metadata_latest
(
    `timestamp`        DateTime,
    `workspace_id`     LowCardinality(String),
    `link_id`          String,
    `domain`           String,
    `key`              String,
    `url`              String,
    `program_id`       LowCardinality(String),
    `partner_id`       String,
    `partner_group_id` String,
    `folder_id`        String,
    `tag_ids`          Array(String),
    `tenant_id`        String,
    `created_at`       DateTime64(3),
    `deleted`          UInt8
)
ENGINE = ReplacingMergeTree(timestamp)
ORDER BY (workspace_id, link_id);

-- ============ LOGS ============

CREATE TABLE IF NOT EXISTS dub.dub_api_logs
(
    `id`             String,
    `timestamp`      DateTime64(3),
    `workspace_id`   String,
    `method`         LowCardinality(String),
    `path`           String,
    `route_pattern`  LowCardinality(String),
    `status_code`    UInt16,
    `duration`       UInt32,
    `user_agent`     String,
    `request_body`   String,
    `response_body`  String,
    `token_id`       String,
    `user_id`        String,
    `request_type`   LowCardinality(String)
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (workspace_id, timestamp)
TTL toDateTime(timestamp) + toIntervalDay(90);

CREATE TABLE IF NOT EXISTS dub.dub_audit_logs
(
    `id`           String,
    `timestamp`    DateTime64(3),
    `workspace_id` String,
    `program_id`   String,
    `action`       LowCardinality(String),
    `actor_id`     String,
    `actor_type`   LowCardinality(String),
    `actor_name`   String,
    `targets`      String,
    `description`  String,
    `ip_address`   String,
    `user_agent`   String,
    `metadata`     String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (workspace_id, program_id, timestamp)
TTL toDateTime(timestamp) + toIntervalYear(1);

CREATE TABLE IF NOT EXISTS dub.dub_conversion_events_log
(
    `timestamp`    DateTime64(3) DEFAULT now(),
    `workspace_id` String,
    `link_id`      String,
    `path`         String,
    `body`         String,
    `error`        String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (timestamp, workspace_id)
TTL toDateTime(timestamp) + toIntervalDay(90);

CREATE TABLE IF NOT EXISTS dub.dub_import_error_logs
(
    `timestamp`    DateTime64(3) DEFAULT now(),
    `workspace_id` String,
    `import_id`    String,
    `source`       String,
    `entity`       String,
    `entity_id`    String,
    `code`         String,
    `message`      String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (timestamp, workspace_id, import_id)
TTL toDateTime(timestamp) + toIntervalDay(180);

CREATE TABLE IF NOT EXISTS dub.dub_postback_events
(
    `timestamp`        DateTime64(3) DEFAULT now(),
    `event_id`         String,
    `postback_id`      String,
    `url`              String,
    `event`            LowCardinality(String),
    `response_status`  UInt16,
    `request_body`     String,
    `response_body`    String,
    `message_id`       String,
    `retry_attempt`    UInt8
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (postback_id, event_id, timestamp);

CREATE TABLE IF NOT EXISTS dub.dub_webhook_events
(
    `timestamp`     DateTime64(3) DEFAULT now(),
    `event_id`      String,
    `webhook_id`    String,
    `url`           String,
    `event`         LowCardinality(String),
    `http_status`   UInt16,
    `request_body`  String,
    `response_body` String,
    `message_id`    String
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (timestamp, webhook_id, event_id);
