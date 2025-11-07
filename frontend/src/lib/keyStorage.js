/**
 * Key storage utilities for managing user's encryption keys
 *
 * NOTE: In production, private keys should be:
 * 1. Stored in IndexedDB (not sessionStorage)
 * 2. Encrypted with a key derived from user's password (PBKDF2)
 * 3. Never sent to the server
 *
 * For now, we're using sessionStorage for simplicity and development.
 */

const PRIVATE_KEY_STORAGE_KEY = 'privateKey';
const PUBLIC_KEY_STORAGE_KEY = 'publicKey';

/**
 * Store private key in browser storage
 * @param {string} privateKeyPem Base64-encoded PEM format private key
 */
export function storePrivateKey(privateKeyPem) {
  sessionStorage.setItem(PRIVATE_KEY_STORAGE_KEY, privateKeyPem);
}

/**
 * Retrieve private key from browser storage
 * @returns {string|null} Base64-encoded PEM format private key, or null if not found
 */
export function getPrivateKey() {
  return sessionStorage.getItem(PRIVATE_KEY_STORAGE_KEY);
}

/**
 * Store public key in browser storage
 * @param {string} publicKeyPem Base64-encoded PEM format public key
 */
export function storePublicKey(publicKeyPem) {
  sessionStorage.setItem(PUBLIC_KEY_STORAGE_KEY, publicKeyPem);
}

/**
 * Retrieve public key from browser storage
 * @returns {string|null} Base64-encoded PEM format public key, or null if not found
 */
export function getPublicKey() {
  return sessionStorage.getItem(PUBLIC_KEY_STORAGE_KEY);
}

/**
 * Clear all stored keys (e.g., on logout)
 */
export function clearKeys() {
  sessionStorage.removeItem(PRIVATE_KEY_STORAGE_KEY);
  sessionStorage.removeItem(PUBLIC_KEY_STORAGE_KEY);
}

/**
 * Check if keys exist in storage
 * @returns {boolean} True if both keys are stored
 */
export function hasKeys() {
  return Boolean(getPrivateKey() && getPublicKey());
}
