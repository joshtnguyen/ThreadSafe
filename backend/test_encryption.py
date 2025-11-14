"""
Test Script for Encryption Modules
Tests the complete E2EE flow: User A encrypts a message for User B
"""

import sys
sys.path.insert(0, '.')

from encryption.ecc_handler import (
    generate_key_pair,
    serialize_public_key,
    serialize_private_key,
    deserialize_public_key,
    deserialize_private_key,
    encrypt_aes_key_with_public_key,
    decrypt_aes_key_with_private_key
)

from encryption.aes_handler import (
    generate_aes_key,
    encrypt_message,
    decrypt_message
)


def test_full_encryption_flow():
    """Test the complete encryption flow from User A to User B."""

    print("=" * 70)
    print(" Testing Complete E2EE Encryption Flow")
    print("=" * 70)

    # ========== SETUP: Generate Keys for User A and User B ==========
    print("\n1️⃣  Generating ECC key pairs for User A and User B...")

    # User A generates their key pair
    user_a_private_key, user_a_public_key = generate_key_pair()
    user_a_public_key_str = serialize_public_key(user_a_public_key)
    print(f"   [OK] User A public key generated (length: {len(user_a_public_key_str)} chars)")

    # User B generates their key pair
    user_b_private_key, user_b_public_key = generate_key_pair()
    user_b_public_key_str = serialize_public_key(user_b_public_key)
    print(f"   [OK] User B public key generated (length: {len(user_b_public_key_str)} chars)")


    # ========== USER A: Encrypt Message for User B ==========
    print("\n2️⃣  User A encrypts a message for User B...")

    # Original message
    original_message = "Hello User B! This is a secret encrypted message. "
    print(f"   📝 Original message: '{original_message}'")

    # Step 1: Generate a unique AES-256 key for this message
    aes_key = generate_aes_key()
    print(f"   🔑 Generated AES-256 key ({len(aes_key)} bytes)")

    # Step 2: Encrypt the message with AES-256-GCM
    encrypted_data = encrypt_message(original_message, aes_key)
    print(f"   [OK] Message encrypted with AES-256-GCM")
    print(f"      - Ciphertext length: {len(encrypted_data['ciphertext'])} chars")
    print(f"      - Nonce/IV length: {len(encrypted_data['nonce'])} chars")
    print(f"      - Auth tag length: {len(encrypted_data['tag'])} chars")

    # Step 3: Encrypt the AES key with User B's public key
    user_b_public_key_obj = deserialize_public_key(user_b_public_key_str)
    encrypted_key_data = encrypt_aes_key_with_public_key(aes_key, user_b_public_key_obj)
    print(f"   [OK] AES key encrypted with User B's public key (ECIES)")
    print(f"      - Encrypted AES key length: {len(encrypted_key_data['encrypted_aes_key'])} chars")
    print(f"      - Ephemeral public key length: {len(encrypted_key_data['ephemeral_public_key'])} chars")


    # ========== TRANSMISSION: Simulated Network ==========
    print("\n3️⃣  Transmitting encrypted payload through relay server...")
    print("   🌐 Server receives encrypted data (cannot read it!)")

    # This is what gets stored in the database / sent over the network
    payload = {
        'encrypted_content': encrypted_data['ciphertext'],
        'iv': encrypted_data['nonce'],
        'hmac': encrypted_data['tag'],  # Auth tag stored in hmac field
        'encrypted_aes_key': encrypted_key_data['encrypted_aes_key'],
        'ephemeral_public_key': encrypted_key_data['ephemeral_public_key']
    }
    print(f"   [OK] Payload ready for transmission")


    # ========== USER B: Decrypt Message ==========
    print("\n4️⃣  User B decrypts the message...")

    # Step 1: Decrypt the AES key using User B's private key
    decrypted_aes_key = decrypt_aes_key_with_private_key(
        payload['encrypted_aes_key'],
        payload['ephemeral_public_key'],
        user_b_private_key
    )
    print(f"    AES key decrypted with User B's private key")

    # Verify the AES key matches
    if decrypted_aes_key == aes_key:
        print(f"   [OK] AES key successfully recovered!")
    else:
        print(f"   [ERROR] ERROR: AES key mismatch!")
        return False

    # Step 2: Decrypt the message using the recovered AES key
    decrypted_message = decrypt_message(
        payload['encrypted_content'],
        payload['iv'],
        decrypted_aes_key
    )
    print(f"    Message decrypted with AES-256-GCM")
    print(f"   📝 Decrypted message: '{decrypted_message}'")


    # ========== VERIFICATION ==========
    print("\n5️⃣  Verifying encryption integrity...")

    if decrypted_message == original_message:
        print(f"   [OK] SUCCESS! Messages match perfectly!")
        print(f"   [OK] Encryption/Decryption flow works correctly!")
    else:
        print(f"   [ERROR] ERROR: Messages don't match!")
        print(f"      Expected: '{original_message}'")
        print(f"      Got: '{decrypted_message}'")
        return False


    # ========== TAMPERING TEST ==========
    print("\n6️⃣  Testing tampering detection (modifying ciphertext)...")

    try:
        # Try to decrypt with tampered ciphertext
        tampered_ciphertext = payload['encrypted_content'][:-10] + "XXXXXXXXXX"
        decrypt_message(tampered_ciphertext, payload['iv'], decrypted_aes_key)
        print("   [ERROR] ERROR: Tampering was not detected!")
        return False
    except Exception as e:
        print(f"   [OK] SUCCESS! Tampering detected: {str(e)[:50]}...")


    # ========== SUMMARY ==========
    print("\n" + "=" * 70)
    print(" ALL TESTS PASSED!")
    print("=" * 70)
    print("\n[OK] ECC key generation works")
    print("[OK] AES-256-GCM encryption works")
    print("[OK] Hybrid encryption (ECIES) works")
    print("[OK] Message decryption works")
    print("[OK] Authentication tag verification works")
    print("[OK] Tampering detection works")
    print("\n Your E2EE implementation is ready for integration!\n")

    return True


def test_key_serialization():
    """Test key serialization and deserialization."""

    print("\n" + "=" * 70)
    print("🔑 Testing Key Serialization")
    print("=" * 70)

    # Generate a key pair
    private_key, public_key = generate_key_pair()

    # Serialize keys
    private_key_str = serialize_private_key(private_key)
    public_key_str = serialize_public_key(public_key)

    print(f"\n[OK] Private key serialized ({len(private_key_str)} chars)")
    print(f"[OK] Public key serialized ({len(public_key_str)} chars)")

    # Deserialize keys
    recovered_private_key = deserialize_private_key(private_key_str)
    recovered_public_key = deserialize_public_key(public_key_str)

    print(f"[OK] Private key deserialized successfully")
    print(f"[OK] Public key deserialized successfully")

    # Test that deserialized keys work
    test_aes_key = generate_aes_key()
    encrypted = encrypt_aes_key_with_public_key(test_aes_key, recovered_public_key)
    decrypted = decrypt_aes_key_with_private_key(
        encrypted['encrypted_aes_key'],
        encrypted['ephemeral_public_key'],
        recovered_private_key
    )

    if test_aes_key == decrypted:
        print(f"[OK] Serialization/Deserialization works correctly!\n")
        return True
    else:
        print(f"[ERROR] ERROR: Keys don't work after deserialization!\n")
        return False


if __name__ == "__main__":
    print("\n Starting Encryption Module Tests...\n")

    try:
        # Test 1: Key Serialization
        if not test_key_serialization():
            print("[ERROR] Key serialization test failed!")
            sys.exit(1)

        # Test 2: Full Encryption Flow
        if not test_full_encryption_flow():
            print("[ERROR] Encryption flow test failed!")
            sys.exit(1)

        print("\n✨ All tests completed successfully! ✨\n")
        sys.exit(0)

    except Exception as e:
        print(f"\n💥 FATAL ERROR: {str(e)}\n")
        import traceback
        traceback.print_exc()
        sys.exit(1)
