-- ============================================================================
-- ThreadSafe MySQL Database Schema
-- ============================================================================
-- This file documents the database schema for record keeping.
-- Tables are auto-created by SQLAlchemy from backend/models.py
--
-- For SQLite (development): Tables created automatically on app startup
-- For MySQL (production): Use this file for manual setup or reference
-- ============================================================================

-- Recommended Table Creation Order:
-- 1. USER
-- 2. PUBLIC_KEY
-- 3. USER_SESSION
-- 4. GROUP_CHAT
-- 5. CONTACT
-- 6. KEY_VERIFICATION
-- 7. GROUP_MEMBER
-- 8. MESSAGE
-- 9. BACKUP

-- ============================================================================
-- 1. USER table (base entity)
-- ============================================================================
CREATE TABLE user (
    userID INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,  -- stores hashed password
    prof_pic_url TEXT,
    settings JSON,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_username (username)
);

-- ============================================================================
-- 2. PUBLIC_KEY table (depends on USER)
-- ============================================================================
CREATE TABLE public_key (
    keyID INT AUTO_INCREMENT PRIMARY KEY,
    userID INT NOT NULL,
    publicKey TEXT NOT NULL,
    algorithm VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userID) REFERENCES user(userID) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_userID (userID)
);

-- ============================================================================
-- 3. USER_SESSION table (depends on USER)
-- ============================================================================
CREATE TABLE user_session (
    sessionID INT AUTO_INCREMENT PRIMARY KEY,
    userID INT NOT NULL,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    device_info TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userID) REFERENCES user(userID) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_token_hash (token_hash),
    INDEX idx_expires (expires_at)
);

-- ============================================================================
-- 4. GROUP_CHAT table (depends on USER for creator)
-- ============================================================================
CREATE TABLE group_chat (
    groupChatID INT AUTO_INCREMENT PRIMARY KEY,
    groupName VARCHAR(255) NOT NULL,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES user(userID) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_created_by (created_by)
);

-- ============================================================================
-- 5. CONTACT table (self-referential on USER)
-- ============================================================================
CREATE TABLE contact (
    userID INT NOT NULL,
    contact_userID INT NOT NULL,
    contactStatus ENUM('Active', 'Blocked') DEFAULT 'Active',
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (userID, contact_userID),
    FOREIGN KEY (userID) REFERENCES user(userID) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (contact_userID) REFERENCES user(userID) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_status (contactStatus)
);

-- ============================================================================
-- 6. KEY_VERIFICATION table (self-referential on USER)
-- ============================================================================
CREATE TABLE key_verification (
    userID INT NOT NULL,
    contact_userID INT NOT NULL,
    is_verified BOOLEAN DEFAULT FALSE,
    safety_number VARCHAR(255),
    verified_at TIMESTAMP,
    PRIMARY KEY (userID, contact_userID),
    FOREIGN KEY (userID) REFERENCES user(userID) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (contact_userID) REFERENCES user(userID) ON DELETE CASCADE ON UPDATE CASCADE
);

-- ============================================================================
-- 7. GROUP_MEMBER table (depends on USER and GROUP_CHAT)
-- ============================================================================
CREATE TABLE group_member (
    groupChatID INT NOT NULL,
    userID INT NOT NULL,
    role ENUM('Owner', 'Admin', 'Member') NOT NULL,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (groupChatID, userID),
    FOREIGN KEY (groupChatID) REFERENCES group_chat(groupChatID) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (userID) REFERENCES user(userID) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_role (role)
);

-- ============================================================================
-- 8. MESSAGE table (depends on USER and GROUP_CHAT)
-- ============================================================================
CREATE TABLE message (
    msgID INT AUTO_INCREMENT PRIMARY KEY,
    senderID INT NOT NULL,
    receiverID INT NULL,
    groupChatID INT NULL,
    encryptedContent TEXT NOT NULL,
    iv VARCHAR(255) NOT NULL,
    hmac VARCHAR(255) NOT NULL,
    status ENUM('Sent', 'Delivered', 'Read') DEFAULT 'Sent',
    msg_Type ENUM('text', 'image') NOT NULL,
    timeStamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expiryTime TIMESTAMP NOT NULL,
    FOREIGN KEY (senderID) REFERENCES user(userID) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (receiverID) REFERENCES user(userID) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (groupChatID) REFERENCES group_chat(groupChatID) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_sender (senderID),
    INDEX idx_receiver (receiverID),
    INDEX idx_group (groupChatID),
    INDEX idx_timestamp (timeStamp),
    INDEX idx_expiry (expiryTime)
);

-- ============================================================================
-- 9. BACKUP table (depends on USER)
-- ============================================================================
CREATE TABLE backup (
    backupID INT AUTO_INCREMENT PRIMARY KEY,
    userID INT NOT NULL,
    encrypted_data LONGTEXT NOT NULL,
    iv VARCHAR(255) NOT NULL,
    hmac VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (userID) REFERENCES user(userID) ON DELETE CASCADE ON UPDATE CASCADE,
    INDEX idx_user_created (userID, created_at)
);

-- ============================================================================
-- Optional: Sample Data for Testing
-- ============================================================================

-- INSERT INTO user (username, email, password, is_active) VALUES
-- ('alice', 'alice@test.com', 'pbkdf2:sha256:hashed_password_here', TRUE),
-- ('bob', 'bob@test.com', 'pbkdf2:sha256:hashed_password_here', TRUE);

-- INSERT INTO contact (userID, contact_userID, contactStatus) VALUES
-- (1, 2, 'Active'),
-- (2, 1, 'Active');

-- ============================================================================
-- Notes:
-- ============================================================================
--
-- SQLAlchemy Differences:
-- - ENUM types are stored as VARCHAR(20) in SQLite
-- - JSON type is stored as TEXT in SQLite
-- - TIMESTAMP maps to DateTime in SQLAlchemy
-- - AUTO_INCREMENT is automatic for Integer primary keys
--
-- Current Implementation Status:
-- All 9 tables implemented in backend/models.py
-- Compatible with both SQLite (dev) and MySQL (prod)
-- Foreign keys with CASCADE delete/update
-- All indexes and constraints included
--
-- Table Relationships:
-- - user → public_key (1:many)
-- - user → user_session (1:many)
-- - user → contact (many:many via contact table)
-- - user → group_chat (1:many as creator)
-- - user → group_member (many:many via group_member)
-- - user → message (1:many as sender/receiver)
-- - user → backup (1:many)
-- - group_chat → group_member (1:many)
-- - group_chat → message (1:many)
--
-- Security Notes:
-- - Passwords stored as hashed values (pbkdf2:sha256)
-- - Messages stored with E2EE fields: encryptedContent, iv, hmac
-- - Backups encrypted client-side with iv and hmac
-- - Session tokens stored as hashed values
--
-- Message Expiry:
-- - 1-to-1 chats: 72 hours (3 days)
-- - Group chats: 24 hours (1 day)
-- - Enforced in application logic (Message.default_expiry_time())
--
-- ============================================================================
