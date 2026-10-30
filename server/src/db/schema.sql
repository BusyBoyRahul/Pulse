-- Pulse database schema (MySQL 8+).
-- Charset utf8mb4 throughout so names/notes support the full Unicode range.

CREATE DATABASE IF NOT EXISTS pulse
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE pulse;

-- ---------------------------------------------------------------------------
-- Users: identified by verified phone number. password_hash is optional
-- (phone-OTP is the primary factor; password is an optional recovery factor).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  phone_number    VARCHAR(20)  NOT NULL UNIQUE,
  display_name    VARCHAR(100),
  password_hash   VARCHAR(255),
  mesh_public_key VARCHAR(64),                 -- device signing/box key (base64, 32 bytes)
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Push tokens: a user may have several devices. Used to fan out SOS + relay
-- confirmations. platform tells us FCM vs APNs vs OneSignal routing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_tokens (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  token       VARCHAR(512) NOT NULL,
  platform    ENUM('android','ios','web') NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_token (token),
  KEY idx_device_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- Trusted circle: 1..5 emergency contacts per user. Notified on SOS.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trusted_contacts (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT NOT NULL,
  name          VARCHAR(100) NOT NULL,
  phone_number  VARCHAR(20)  NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_contact_user (user_id),
  UNIQUE KEY uq_user_contact (user_id, phone_number),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- SOS alerts. mesh_packet_id is the de-dup key: the same alert may arrive via
-- several relay phones, but we must notify contacts exactly once.
-- ---------------------------------------------------------------------------
-- Offline-first: user_id is nullable because a victim need not have an account.
-- Their name/phone/contacts arrive (encrypted) inside the relayed packet.
CREATE TABLE IF NOT EXISTS sos_alerts (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  user_id        INT NULL,
  mesh_packet_id CHAR(36) NOT NULL,
  victim_name    VARCHAR(100),
  victim_phone   VARCHAR(20),
  latitude       DECIMAL(9,6),
  longitude      DECIMAL(9,6),
  accuracy_m     DECIMAL(6,1),
  status         ENUM('sent','delivered','cancelled') DEFAULT 'sent',
  relayed_by     INT,                          -- user id of the phone that surfaced it (if any)
  origin_ts      BIGINT,                        -- device clock at trigger (ms)
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  delivered_at   TIMESTAMP NULL,
  UNIQUE KEY uq_packet (mesh_packet_id),
  KEY idx_sos_user (user_id),
  FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (relayed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Upgrade an already-created table to the offline-first shape (MariaDB syntax).
ALTER TABLE sos_alerts MODIFY user_id INT NULL;
ALTER TABLE sos_alerts ADD COLUMN IF NOT EXISTS victim_name VARCHAR(100) AFTER mesh_packet_id;
ALTER TABLE sos_alerts ADD COLUMN IF NOT EXISTS victim_phone VARCHAR(20) AFTER victim_name;

-- Per-contact delivery ledger, so we can retry the ones that failed.
CREATE TABLE IF NOT EXISTS sos_notifications (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  alert_id     INT NOT NULL,
  contact_id   INT,
  target       VARCHAR(20),                     -- phone number notified (from packet)
  channel      ENUM('sms','push') NOT NULL,
  status       ENUM('queued','sent','failed') DEFAULT 'queued',
  provider_ref VARCHAR(128),
  error        VARCHAR(255),
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_notif_alert (alert_id),
  FOREIGN KEY (alert_id)   REFERENCES sos_alerts(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES trusted_contacts(id) ON DELETE SET NULL
) ENGINE=InnoDB;

ALTER TABLE sos_notifications ADD COLUMN IF NOT EXISTS target VARCHAR(20) AFTER contact_id;

-- ---------------------------------------------------------------------------
-- Safety notes: community-left geo-tagged messages, mirrored server-side so
-- new users in an area can pull them even before meeting a relay.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS safety_notes (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  mesh_id     CHAR(36) NOT NULL,
  latitude    DECIMAL(9,6) NOT NULL,
  longitude   DECIMAL(9,6) NOT NULL,
  message     VARCHAR(280) NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  -- DATETIME (not TIMESTAMP) so MariaDB/strict sql_mode accepts a no-default
  -- NOT NULL column; the app always supplies expires_at explicitly.
  expires_at  DATETIME NOT NULL,
  UNIQUE KEY uq_note_mesh (mesh_id),
  KEY idx_note_geo (latitude, longitude),
  KEY idx_note_expiry (expires_at)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------------
-- OTP attempts (rate-limit + dev-mode auditing). Twilio Verify holds the real
-- codes; this table tracks request cadence so we can throttle abuse.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS otp_requests (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  phone_number VARCHAR(20) NOT NULL,
  ip           VARCHAR(64),
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_otp_phone_time (phone_number, created_at)
) ENGINE=InnoDB;
