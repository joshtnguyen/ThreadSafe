"""
ECC (Elliptic Curve Cryptography) Handler
Provides functions for ECC key pair generation, serialization, and hybrid encryption.
Uses SECP256R1 (P-256) curve for compatibility and security.
"""

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import os
import base64


def generate_key_pair():
    """
    Generate an ECC key pair using SECP256R1 (P-256) curve.

    Returns:
        tuple: (private_key, public_key) as cryptography objects
    """
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_key = private_key.public_key()
    return private_key, public_key


def serialize_private_key(private_key):
    """
    Serialize private key to PEM format for storage.

    Args:
        private_key: ECC private key object

    Returns:
        str: Base64-encoded PEM format private key
    """
    pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    )
    return base64.b64encode(pem).decode('utf-8')


def deserialize_private_key(private_key_str):
    """
    Deserialize private key from PEM format.

    Args:
        private_key_str: Base64-encoded PEM format private key

    Returns:
        ECC private key object
    """
    pem = base64.b64decode(private_key_str.encode('utf-8'))
    return serialization.load_pem_private_key(pem, password=None)


def serialize_public_key(public_key):
    """
    Serialize public key to PEM format for database storage.

    Args:
        public_key: ECC public key object

    Returns:
        str: Base64-encoded PEM format public key
    """
    pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    )
    return base64.b64encode(pem).decode('utf-8')


def deserialize_public_key(public_key_str):
    """
    Deserialize public key from PEM format.

    Args:
        public_key_str: Base64-encoded PEM format public key

    Returns:
        ECC public key object
    """
    pem = base64.b64decode(public_key_str.encode('utf-8'))
    return serialization.load_pem_public_key(pem)


def encrypt_aes_key_with_public_key(aes_key, recipient_public_key):
    """
    Encrypt an AES key using recipient's ECC public key (ECIES-style).
    Uses ECDH to derive a shared secret, then encrypts the AES key.

    Args:
        aes_key: bytes - The AES-256 key to encrypt (32 bytes)
        recipient_public_key: ECC public key object of the recipient

    Returns:
        dict: {
            'encrypted_aes_key': base64-encoded encrypted AES key,
            'ephemeral_public_key': base64-encoded ephemeral public key (for ECDH)
        }
    """
    # Generate ephemeral key pair for ECDH
    ephemeral_private_key = ec.generate_private_key(ec.SECP256R1())
    ephemeral_public_key = ephemeral_private_key.public_key()

    # Perform ECDH to get shared secret
    shared_key = ephemeral_private_key.exchange(ec.ECDH(), recipient_public_key)

    # Derive encryption key from shared secret using HKDF
    derived_key = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=b'encryption'
    ).derive(shared_key)

    # Encrypt the AES key using the derived key with AES-GCM
    aesgcm = AESGCM(derived_key)
    nonce = os.urandom(12)  # 96-bit nonce for GCM
    encrypted_aes_key = aesgcm.encrypt(nonce, aes_key, None)

    # Combine nonce + ciphertext
    encrypted_data = nonce + encrypted_aes_key

    return {
        'encrypted_aes_key': base64.b64encode(encrypted_data).decode('utf-8'),
        'ephemeral_public_key': serialize_public_key(ephemeral_public_key)
    }


def decrypt_aes_key_with_private_key(encrypted_data, ephemeral_public_key_str, recipient_private_key):
    """
    Decrypt an AES key using recipient's ECC private key (ECIES-style).

    Args:
        encrypted_data: base64-encoded encrypted AES key (includes nonce)
        ephemeral_public_key_str: base64-encoded ephemeral public key
        recipient_private_key: ECC private key object

    Returns:
        bytes: Decrypted AES-256 key (32 bytes)
    """
    # Decode the encrypted data
    encrypted_bytes = base64.b64decode(encrypted_data.encode('utf-8'))
    nonce = encrypted_bytes[:12]  # First 12 bytes are the nonce
    ciphertext = encrypted_bytes[12:]  # Rest is the ciphertext

    # Deserialize ephemeral public key
    ephemeral_public_key = deserialize_public_key(ephemeral_public_key_str)

    # Perform ECDH to get shared secret
    shared_key = recipient_private_key.exchange(ec.ECDH(), ephemeral_public_key)

    # Derive decryption key from shared secret
    derived_key = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=b'encryption'
    ).derive(shared_key)

    # Decrypt the AES key
    aesgcm = AESGCM(derived_key)
    aes_key = aesgcm.decrypt(nonce, ciphertext, None)

    return aes_key


__all__ = [
    'generate_key_pair',
    'serialize_private_key',
    'deserialize_private_key',
    'serialize_public_key',
    'deserialize_public_key',
    'encrypt_aes_key_with_public_key',
    'decrypt_aes_key_with_private_key'
]
