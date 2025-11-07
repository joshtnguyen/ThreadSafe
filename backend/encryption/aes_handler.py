"""
AES-256-GCM Handler
Provides authenticated encryption using AES-256 in GCM mode.
GCM provides both confidentiality and authenticity (no separate HMAC needed).
"""

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import os
import base64


def generate_aes_key():
    """
    Generate a random AES-256 key (32 bytes).

    Returns:
        bytes: 32-byte AES-256 key
    """
    return AESGCM.generate_key(bit_length=256)


def encrypt_message(plaintext, aes_key):
    """
    Encrypt a message using AES-256-GCM.

    Args:
        plaintext: str or bytes - The message to encrypt
        aes_key: bytes - The AES-256 key (32 bytes)

    Returns:
        dict: {
            'ciphertext': base64-encoded encrypted message,
            'nonce': base64-encoded nonce/IV (12 bytes),
            'tag': base64-encoded authentication tag (16 bytes)
        }
    """
    # Convert plaintext to bytes if it's a string
    if isinstance(plaintext, str):
        plaintext = plaintext.encode('utf-8')

    # Generate a random nonce (96 bits for GCM)
    nonce = os.urandom(12)

    # Create AESGCM cipher
    aesgcm = AESGCM(aes_key)

    # Encrypt (GCM mode automatically generates authentication tag)
    # The output includes ciphertext + tag combined
    ciphertext_with_tag = aesgcm.encrypt(nonce, plaintext, None)

    # In GCM, the tag is appended to the ciphertext
    # cryptography library handles this automatically
    # For storage, we'll keep them combined but provide the full output
    ciphertext = ciphertext_with_tag[:-16]  # All except last 16 bytes
    tag = ciphertext_with_tag[-16:]  # Last 16 bytes are the tag

    return {
        'ciphertext': base64.b64encode(ciphertext_with_tag).decode('utf-8'),
        'nonce': base64.b64encode(nonce).decode('utf-8'),
        'tag': base64.b64encode(tag).decode('utf-8')
    }


def decrypt_message(ciphertext_b64, nonce_b64, aes_key, tag_b64=None):
    """
    Decrypt a message using AES-256-GCM.

    Args:
        ciphertext_b64: base64-encoded ciphertext (may include tag)
        nonce_b64: base64-encoded nonce/IV
        aes_key: bytes - The AES-256 key (32 bytes)
        tag_b64: base64-encoded authentication tag (optional, for backward compatibility)

    Returns:
        str: Decrypted plaintext message

    Raises:
        cryptography.exceptions.InvalidTag: If authentication fails
    """
    # Decode from base64
    ciphertext_bytes = base64.b64decode(ciphertext_b64.encode('utf-8'))
    nonce = base64.b64decode(nonce_b64.encode('utf-8'))

    # Create AESGCM cipher
    aesgcm = AESGCM(aes_key)

    # Decrypt and verify authenticity
    # GCM will automatically verify the tag and raise exception if tampered
    try:
        plaintext_bytes = aesgcm.decrypt(nonce, ciphertext_bytes, None)
        return plaintext_bytes.decode('utf-8')
    except Exception as e:
        raise ValueError(f"Decryption failed: {str(e)}")


def encrypt_message_simple(plaintext, aes_key):
    """
    Simplified encryption for easy integration.
    Returns combined format that's easier to store in database.

    Args:
        plaintext: str - The message to encrypt
        aes_key: bytes - The AES-256 key (32 bytes)

    Returns:
        dict: {
            'encrypted_content': base64-encoded ciphertext,
            'iv': base64-encoded nonce,
            'auth_tag': base64-encoded authentication tag
        }
    """
    result = encrypt_message(plaintext, aes_key)
    return {
        'encrypted_content': result['ciphertext'],
        'iv': result['nonce'],
        'auth_tag': result['tag']  # For database 'hmac' field
    }


def decrypt_message_simple(encrypted_content, iv, aes_key):
    """
    Simplified decryption for easy integration.

    Args:
        encrypted_content: base64-encoded ciphertext
        iv: base64-encoded nonce
        aes_key: bytes - The AES-256 key (32 bytes)

    Returns:
        str: Decrypted plaintext message
    """
    return decrypt_message(encrypted_content, iv, aes_key)


__all__ = [
    'generate_aes_key',
    'encrypt_message',
    'decrypt_message',
    'encrypt_message_simple',
    'decrypt_message_simple'
]
