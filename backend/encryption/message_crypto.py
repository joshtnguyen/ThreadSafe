"""
Message Encryption Helper
High-level functions for encrypting and decrypting messages in the messaging system.
"""

from .ecc_handler import (
    encrypt_aes_key_with_public_key,
    decrypt_aes_key_with_private_key,
    deserialize_public_key,
    deserialize_private_key
)
from .aes_handler import (
    generate_aes_key,
    encrypt_message_simple,
    decrypt_message_simple
)


def encrypt_message_for_user(plaintext_message, recipient_public_key_str):
    """
    Encrypt a message for a specific recipient using hybrid encryption.

    This is what User A does when sending a message to User B:
    1. Generate a unique AES-256 key for this message
    2. Encrypt the message with AES-256-GCM
    3. Encrypt the AES key with recipient's public key (ECIES)

    Args:
        plaintext_message: str - The message to encrypt
        recipient_public_key_str: str - Base64-encoded recipient's public key

    Returns:
        dict: {
            'encrypted_content': base64-encoded ciphertext,
            'iv': base64-encoded nonce,
            'auth_tag': base64-encoded authentication tag,
            'encrypted_aes_key': base64-encoded encrypted AES key,
            'ephemeral_public_key': base64-encoded ephemeral public key
        }
    """
    # Step 1: Generate unique AES key for this message
    aes_key = generate_aes_key()

    # Step 2: Encrypt message with AES-256-GCM
    aes_encrypted = encrypt_message_simple(plaintext_message, aes_key)

    # Step 3: Encrypt AES key with recipient's public key
    recipient_public_key = deserialize_public_key(recipient_public_key_str)
    encrypted_key_data = encrypt_aes_key_with_public_key(aes_key, recipient_public_key)

    # Combine everything into one payload
    return {
        'encrypted_content': aes_encrypted['encrypted_content'],
        'iv': aes_encrypted['iv'],
        'auth_tag': aes_encrypted['auth_tag'],
        'encrypted_aes_key': encrypted_key_data['encrypted_aes_key'],
        'ephemeral_public_key': encrypted_key_data['ephemeral_public_key']
    }


def decrypt_message_from_user(encrypted_content, iv, encrypted_aes_key, ephemeral_public_key, recipient_private_key_str):
    """
    Decrypt a message using the recipient's private key.

    This is what User B does when receiving a message from User A:
    1. Decrypt the AES key using their private key
    2. Decrypt the message using the recovered AES key

    Args:
        encrypted_content: base64-encoded ciphertext
        iv: base64-encoded nonce
        encrypted_aes_key: base64-encoded encrypted AES key
        ephemeral_public_key: base64-encoded ephemeral public key
        recipient_private_key_str: base64-encoded recipient's private key

    Returns:
        str: Decrypted plaintext message
    """
    # Step 1: Decrypt the AES key
    recipient_private_key = deserialize_private_key(recipient_private_key_str)
    aes_key = decrypt_aes_key_with_private_key(
        encrypted_aes_key,
        ephemeral_public_key,
        recipient_private_key
    )

    # Step 2: Decrypt the message
    plaintext = decrypt_message_simple(encrypted_content, iv, aes_key)

    return plaintext


__all__ = [
    'encrypt_message_for_user',
    'decrypt_message_from_user'
]
