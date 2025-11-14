/**
 * Web Crypto API utilities for E2EE messaging
 * Compatible with Python backend's cryptography library (SECP256R1/P-256, ECIES-style)
 */

/**
 * Generate an ECC key pair using P-256 (SECP256R1) curve
 * @returns {Promise<CryptoKeyPair>} Key pair with private and public keys
 */
export async function generateKeyPair() {
  return await window.crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256', // Same as SECP256R1
    },
    true, // extractable
    ['deriveKey', 'deriveBits']
  );
}

/**
 * Export public key to PEM format (base64 encoded)
 * @param {CryptoKey} publicKey
 * @returns {Promise<string>} Base64-encoded PEM format public key
 */
export async function exportPublicKey(publicKey) {
  const exported = await window.crypto.subtle.exportKey('spki', publicKey);
  const pem = arrayBufferToPem(exported, 'PUBLIC KEY');
  return btoa(pem); // Base64 encode the PEM
}

/**
 * Export private key to PEM format (base64 encoded)
 * @param {CryptoKey} privateKey
 * @returns {Promise<string>} Base64-encoded PEM format private key
 */
export async function exportPrivateKey(privateKey) {
  const exported = await window.crypto.subtle.exportKey('pkcs8', privateKey);
  const pem = arrayBufferToPem(exported, 'PRIVATE KEY');
  return btoa(pem); // Base64 encode the PEM
}

/**
 * Import public key from PEM format (base64 encoded)
 * @param {string} publicKeyPem Base64-encoded PEM format public key
 * @returns {Promise<CryptoKey>}
 */
export async function importPublicKey(publicKeyPem) {
  const pem = atob(publicKeyPem); // Decode base64
  const binaryDer = pemToBinary(pem);
  return await window.crypto.subtle.importKey(
    'spki',
    binaryDer,
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    []
  );
}

/**
 * Import private key from PEM format (base64 encoded)
 * @param {string} privateKeyPem Base64-encoded PEM format private key
 * @returns {Promise<CryptoKey>}
 */
export async function importPrivateKey(privateKeyPem) {
  const pem = atob(privateKeyPem); // Decode base64
  const binaryDer = pemToBinary(pem);
  return await window.crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    ['deriveKey', 'deriveBits']
  );
}

/**
 * Decrypt an AES key using ECIES (ECDH + HKDF + AES-GCM)
 * Compatible with Python backend's encrypt_aes_key_with_public_key
 * @param {string} encryptedData Base64-encoded encrypted AES key (nonce + ciphertext)
 * @param {string} ephemeralPublicKeyPem Base64-encoded ephemeral public key
 * @param {CryptoKey} recipientPrivateKey Recipient's private key
 * @returns {Promise<ArrayBuffer>} Decrypted AES key (32 bytes)
 */
export async function decryptAESKey(encryptedData, ephemeralPublicKeyPem, recipientPrivateKey) {
  // Decode the encrypted data
  const encryptedBytes = base64ToArrayBuffer(encryptedData);
  const nonce = encryptedBytes.slice(0, 12); // First 12 bytes
  const ciphertext = encryptedBytes.slice(12); // Rest is ciphertext

  // Import ephemeral public key
  const ephemeralPublicKey = await importPublicKey(ephemeralPublicKeyPem);

  // Perform ECDH to derive shared secret
  const sharedSecret = await window.crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: ephemeralPublicKey,
    },
    recipientPrivateKey,
    256 // 256 bits = 32 bytes
  );

  // Derive encryption key using HKDF (matching Python's HKDF with info='encryption')
  const derivedKey = await window.crypto.subtle.importKey(
    'raw',
    sharedSecret,
    'HKDF',
    false,
    ['deriveKey']
  );

  const aesKey = await window.crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array([]), // No salt (same as Python's salt=None)
      info: new TextEncoder().encode('encryption'), // Same as Python's info=b'encryption'
    },
    derivedKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['decrypt']
  );

  // Decrypt the AES key
  const decryptedAESKey = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
    },
    aesKey,
    ciphertext
  );

  return decryptedAESKey;
}

/**
 * Decrypt a message using AES-256-GCM
 * @param {string} encryptedContent Base64-encoded ciphertext
 * @param {string} ivBase64 Base64-encoded IV/nonce
 * @param {ArrayBuffer} aesKeyBytes Raw AES key (32 bytes)
 * @returns {Promise<string>} Decrypted plaintext message
 */
export async function decryptMessage(encryptedContent, ivBase64, aesKeyBytes) {
  // Import AES key
  const aesKey = await window.crypto.subtle.importKey(
    'raw',
    aesKeyBytes,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['decrypt']
  );

  // Decode encrypted content and IV
  const ciphertext = base64ToArrayBuffer(encryptedContent);
  const iv = base64ToArrayBuffer(ivBase64);

  // Decrypt
  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    aesKey,
    ciphertext
  );

  // Convert to string
  return new TextDecoder().decode(decrypted);
}

/**
 * Full message decryption (combines ECIES and AES-GCM decryption)
 * @param {object} message Message object with encryption fields
 * @param {CryptoKey} privateKey User's private key
 * @returns {Promise<string>} Decrypted plaintext message
 */
export async function decryptMessageComplete(message, privateKey) {
  // Step 1: Decrypt the AES key using ECIES
  const aesKeyBytes = await decryptAESKey(
    message.encrypted_aes_key,
    message.ephemeral_public_key,
    privateKey
  );

  // Step 2: Decrypt the message content using the recovered AES key
  const plaintext = await decryptMessage(
    message.encryptedContent,
    message.iv,
    aesKeyBytes
  );

  return plaintext;
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Convert ArrayBuffer to PEM format string
 */
function arrayBufferToPem(buffer, label) {
  const base64 = arrayBufferToBase64(buffer);
  const lines = base64.match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

/**
 * Convert PEM string to ArrayBuffer
 */
function pemToBinary(pem) {
  const base64 = pem
    .replace(/-----BEGIN .*-----/, '')
    .replace(/-----END .*-----/, '')
    .replace(/\s/g, '');
  return base64ToArrayBuffer(base64);
}

/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64 string to ArrayBuffer
 */
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
