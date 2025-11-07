/**
 * Key storage utilities for managing user's encryption keys
 *
 * NOTE: In production, private keys should be:
 * 1. Stored in IndexedDB (not localStorage)
 * 2. Encrypted with a key derived from user's password (PBKDF2)
 * 3. Never sent to the server
 *
 * For now, we're using localStorage so keys persist across sessions.
 * Keys are stored per-user using their user ID.
 */

const PRIVATE_KEY_PREFIX = 'privateKey_';
const PUBLIC_KEY_PREFIX = 'publicKey_';

/**
 * Get storage key for user-specific private key
 */
function getPrivateKeyStorageKey(userId) {
  return `${PRIVATE_KEY_PREFIX}${userId}`;
}

/**
 * Get storage key for user-specific public key
 */
function getPublicKeyStorageKey(userId) {
  return `${PUBLIC_KEY_PREFIX}${userId}`;
}

/**
 * Store private key in browser storage for a specific user
 * @param {string} privateKeyPem Base64-encoded PEM format private key
 * @param {number} userId User ID to associate key with
 */
export function storePrivateKey(privateKeyPem, userId) {
  localStorage.setItem(getPrivateKeyStorageKey(userId), privateKeyPem);
}

/**
 * Retrieve private key from browser storage for a specific user
 * @param {number} userId User ID whose key to retrieve
 * @returns {string|null} Base64-encoded PEM format private key, or null if not found
 */
export function getPrivateKey(userId) {
  return localStorage.getItem(getPrivateKeyStorageKey(userId));
}

/**
 * Store public key in browser storage for a specific user
 * @param {string} publicKeyPem Base64-encoded PEM format public key
 * @param {number} userId User ID to associate key with
 */
export function storePublicKey(publicKeyPem, userId) {
  localStorage.setItem(getPublicKeyStorageKey(userId), publicKeyPem);
}

/**
 * Retrieve public key from browser storage for a specific user
 * @param {number} userId User ID whose key to retrieve
 * @returns {string|null} Base64-encoded PEM format public key, or null if not found
 */
export function getPublicKey(userId) {
  return localStorage.getItem(getPublicKeyStorageKey(userId));
}

/**
 * Clear stored keys for a specific user (e.g., on account deletion)
 * @param {number} userId User ID whose keys to clear
 */
export function clearKeys(userId) {
  localStorage.removeItem(getPrivateKeyStorageKey(userId));
  localStorage.removeItem(getPublicKeyStorageKey(userId));
}

/**
 * Check if keys exist in storage for a specific user
 * @param {number} userId User ID to check
 * @returns {boolean} True if both keys are stored
 */
export function hasKeys(userId) {
  return Boolean(getPrivateKey(userId) && getPublicKey(userId));
}
