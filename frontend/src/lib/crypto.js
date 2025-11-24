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
// Encryption functions (for client-side encryption)
// ============================================================================

/**
 * Generate a random AES-256 key
 * @returns {Promise<ArrayBuffer>} Raw AES key (32 bytes)
 */
export async function generateAESKey() {
  const key = await window.crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true,
    ['encrypt', 'decrypt']
  );
  return await window.crypto.subtle.exportKey('raw', key);
}

/**
 * Encrypt an AES key using ECIES (ECDH + HKDF + AES-GCM)
 * Compatible with Python backend's decrypt_aes_key_with_private_key
 * @param {ArrayBuffer} aesKeyBytes Raw AES key (32 bytes)
 * @param {string} recipientPublicKeyPem Base64-encoded recipient's public key
 * @returns {Promise<{encryptedAESKey: string, ephemeralPublicKey: string}>}
 */
export async function encryptAESKey(aesKeyBytes, recipientPublicKeyPem) {
  // Generate ephemeral key pair for ECDH
  const ephemeralKeyPair = await generateKeyPair();
  const ephemeralPublicKeyPem = await exportPublicKey(ephemeralKeyPair.publicKey);

  // Import recipient's public key
  const recipientPublicKey = await importPublicKey(recipientPublicKeyPem);

  // Perform ECDH to derive shared secret
  const sharedSecret = await window.crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: recipientPublicKey,
    },
    ephemeralKeyPair.privateKey,
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
    ['encrypt']
  );

  // Generate random nonce
  const nonce = window.crypto.getRandomValues(new Uint8Array(12));

  // Encrypt the AES key
  const encryptedAESKey = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce,
    },
    aesKey,
    aesKeyBytes
  );

  // Combine nonce + ciphertext
  const combined = new Uint8Array(nonce.length + encryptedAESKey.byteLength);
  combined.set(nonce);
  combined.set(new Uint8Array(encryptedAESKey), nonce.length);

  return {
    encryptedAESKey: arrayBufferToBase64(combined.buffer),
    ephemeralPublicKey: ephemeralPublicKeyPem,
  };
}

/**
 * Encrypt a message using AES-256-GCM
 * @param {string} plaintext The message to encrypt
 * @param {ArrayBuffer} aesKeyBytes Raw AES key (32 bytes)
 * @returns {Promise<{encryptedContent: string, iv: string}>}
 */
export async function encryptMessage(plaintext, aesKeyBytes) {
  // Import AES key
  const aesKey = await window.crypto.subtle.importKey(
    'raw',
    aesKeyBytes,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt']
  );

  // Generate random IV
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  // Encrypt
  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    aesKey,
    new TextEncoder().encode(plaintext)
  );

  return {
    encryptedContent: arrayBufferToBase64(encrypted),
    iv: arrayBufferToBase64(iv.buffer),
  };
}

/**
 * Full message encryption for a recipient (combines AES and ECIES encryption)
 * @param {string} plaintext The message to encrypt
 * @param {string} recipientPublicKeyPem Base64-encoded recipient's public key
 * @returns {Promise<{encryptedContent: string, iv: string, encryptedAESKey: string, ephemeralPublicKey: string}>}
 */
export async function encryptMessageForRecipient(plaintext, recipientPublicKeyPem) {
  // Step 1: Generate random AES key
  const aesKeyBytes = await generateAESKey();

  // Step 2: Encrypt message with AES key
  const { encryptedContent, iv } = await encryptMessage(plaintext, aesKeyBytes);

  // Step 3: Encrypt AES key with recipient's public key
  const { encryptedAESKey, ephemeralPublicKey } = await encryptAESKey(aesKeyBytes, recipientPublicKeyPem);

  return {
    encryptedContent,
    iv,
    encryptedAESKey,
    ephemeralPublicKey,
  };
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

// ============================================================================
// Password-derived key functions for key backup/recovery
// ============================================================================

/**
 * Derive an AES-256 key from password using PBKDF2
 * @param {string} password User's password
 * @param {Uint8Array} salt Random salt (16 bytes recommended)
 * @returns {Promise<CryptoKey>} Derived AES key for encrypting private key
 */
export async function deriveKeyFromPassword(password, salt) {
  // Import password as raw key material
  const passwordKey = await window.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  // Derive AES-256 key using PBKDF2
  return await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000, // High iteration count for security
      hash: 'SHA-256',
    },
    passwordKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt private key with password-derived key for backup
 * @param {string} privateKeyPem Base64-encoded PEM private key
 * @param {string} password User's password
 * @returns {Promise<{encryptedPrivateKey: string, salt: string, iv: string}>}
 */
export async function encryptPrivateKeyWithPassword(privateKeyPem, password) {
  // Generate random salt and IV
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  // Derive key from password
  const derivedKey = await deriveKeyFromPassword(password, salt);

  // Encrypt private key
  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
    },
    derivedKey,
    new TextEncoder().encode(privateKeyPem)
  );

  return {
    encryptedPrivateKey: arrayBufferToBase64(encrypted),
    salt: arrayBufferToHex(salt),
    iv: arrayBufferToHex(iv),
  };
}

/**
 * Decrypt private key with password-derived key for recovery
 * @param {string} encryptedPrivateKey Base64-encoded encrypted private key
 * @param {string} saltHex Hex-encoded salt
 * @param {string} ivHex Hex-encoded IV
 * @param {string} password User's password
 * @returns {Promise<string>} Decrypted base64-encoded PEM private key
 */
export async function decryptPrivateKeyWithPassword(encryptedPrivateKey, saltHex, ivHex, password) {
  // Convert hex to Uint8Array
  const salt = hexToArrayBuffer(saltHex);
  const iv = hexToArrayBuffer(ivHex);

  // Derive key from password
  const derivedKey = await deriveKeyFromPassword(password, new Uint8Array(salt));

  // Decrypt private key
  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: new Uint8Array(iv),
    },
    derivedKey,
    base64ToArrayBuffer(encryptedPrivateKey)
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Convert ArrayBuffer to hex string
 */
function arrayBufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to ArrayBuffer
 */
function hexToArrayBuffer(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes.buffer;
}

// ============================================================================
// Group Encryption Functions
// ============================================================================

/**
 * Generate a random AES-256 group key
 * @returns {Promise<string>} Base64-encoded group key
 */
export async function generateGroupKey() {
  const keyBytes = await generateAESKey();
  return arrayBufferToBase64(keyBytes);
}

/**
 * Encrypt group key for multiple members
 * @param {string} groupKeyBase64 Base64-encoded group key
 * @param {Array<{userId: number, publicKey: string}>} members Array of members with public keys
 * @returns {Promise<Object>} Object mapping userId to encrypted key data
 */
export async function encryptGroupKeyForMembers(groupKeyBase64, members) {
  const groupKeyBytes = base64ToArrayBuffer(groupKeyBase64);
  const encryptedKeys = {};

  for (const member of members) {
    const memberId = member.id || member.userId; // Support both formats

    if (!member.publicKey) {
      console.error(`[ERROR] encryptGroupKeyForMembers: No public key for member ${memberId}`);
      continue;
    }

    try {
      const { encryptedAESKey, ephemeralPublicKey } = await encryptAESKey(
        groupKeyBytes,
        member.publicKey
      );
      encryptedKeys[memberId] = JSON.stringify({
        encryptedAESKey,
        ephemeralPublicKey,
      });
      console.log(`[DEBUG] encryptGroupKeyForMembers: Successfully encrypted key for member ${memberId}`);
    } catch (error) {
      console.error(`[ERROR] encryptGroupKeyForMembers: Failed to encrypt group key for user ${memberId}:`, error);
    }
  }

  console.log(`[DEBUG] encryptGroupKeyForMembers: Generated keys for ${Object.keys(encryptedKeys).length} of ${members.length} members`);
  return encryptedKeys;
}

/**
 * Decrypt group key using private key
 * @param {string} encryptedKeyData JSON string with encryptedAESKey and ephemeralPublicKey
 * @param {CryptoKey} privateKey User's private key
 * @returns {Promise<string>} Base64-encoded group key
 */
export async function decryptGroupKey(encryptedKeyData, privateKey) {
  const { encryptedAESKey, ephemeralPublicKey } = JSON.parse(encryptedKeyData);
  const groupKeyBytes = await decryptAESKey(encryptedAESKey, ephemeralPublicKey, privateKey);
  return arrayBufferToBase64(groupKeyBytes);
}

/**
 * Encrypt a message with group key
 * @param {string} plaintext Message to encrypt
 * @param {string} groupKeyBase64 Base64-encoded group key
 * @returns {Promise<{encryptedContent: string, iv: string, hmac: string}>}
 */
export async function encryptGroupMessage(plaintext, groupKeyBase64) {
  const groupKeyBytes = base64ToArrayBuffer(groupKeyBase64);
  const { encryptedContent, iv } = await encryptMessage(plaintext, groupKeyBytes);

  // AES-GCM includes authentication tag in the ciphertext, use iv as hmac placeholder
  return {
    encryptedContent,
    iv,
    hmac: iv, // GCM mode includes auth tag in ciphertext
  };
}

/**
 * Decrypt a message with group key
 * @param {string} encryptedContent Base64-encoded ciphertext
 * @param {string} iv Base64-encoded IV
 * @param {string} groupKeyBase64 Base64-encoded group key
 * @returns {Promise<string>} Decrypted plaintext
 */
export async function decryptGroupMessage(encryptedContent, iv, groupKeyBase64) {
  const groupKeyBytes = base64ToArrayBuffer(groupKeyBase64);
  return await decryptMessage(encryptedContent, iv, groupKeyBytes);
}
