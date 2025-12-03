from __future__ import annotations

from datetime import datetime, timedelta

from flask import Blueprint, jsonify, request
from flask_jwt_extended import create_access_token, get_jwt_identity, jwt_required
from sqlalchemy import func
from werkzeug.security import check_password_hash, generate_password_hash

from ..database import db
from ..models import User, PublicKey, LoginAttempt, LoginAttemptByIP
from ..encryption.ecc_handler import generate_key_pair, serialize_public_key

auth_bp = Blueprint("auth", __name__)

# Rate limiting configuration
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_DURATION_MINUTES = 1  # Change to 15-30 for production
MAX_IP_LOGIN_ATTEMPTS = 20  # Maximum login attempts from a single IP
IP_LOCKOUT_DURATION_MINUTES = 60  # Lock IP for 1 hour after exceeding limit


def _normalise_username(username: str) -> str:
    return username.strip().lower()


@auth_bp.post("/register")
def register():
    """Register a new user."""
    payload = request.get_json(silent=True) or {}
    username = payload.get("username", "").strip()
    email = payload.get("email", "").strip()
    password = payload.get("password", "")
    display_name = payload.get("displayName", "").strip() or None  # Full name (optional)

    if not username or not password or not email:
        return jsonify({"message": "Username, email, and password are required."}), 400

    # Validate password length
    if len(password) < 8:
        return jsonify({"message": "Password must be at least 8 characters long."}), 400
    if len(password) > 15:
        return jsonify({"message": "Password must not exceed 15 characters."}), 400

    # Validate username format
    import re
    # Must be 3-15 characters, start with letter, allow letters/numbers/_-. after first char
    username_pattern = r'^[a-zA-Z][a-zA-Z0-9._-]{2,14}$'

    if not re.match(username_pattern, username):
        if len(username) < 3:
            return jsonify({"message": "Username must be at least 3 characters long."}), 400
        elif len(username) > 15:
            return jsonify({"message": "Username must not exceed 15 characters."}), 400
        elif not username[0].isalpha():
            return jsonify({"message": "Username must start with a letter, not a number or special character."}), 400
        else:
            return jsonify({"message": "Username can only contain letters, numbers, underscore (_), hyphen (-), and period (.)."}), 400

    # Email is case-insensitive, username is case-SENSITIVE
    normalised_email = email.lower()

    # Check for existing username (case-insensitive to prevent confusing duplicates like 'Alice' and 'alice')
    if User.query.filter(func.lower(User.username) == username.lower()).first():
        return jsonify({"message": "Username already exists (case-insensitive check)."}), 409

    if User.query.filter(func.lower(User.email) == normalised_email).first():
        return jsonify({"message": "Email already exists."}), 409

    # Store username with exact case as provided
    user = User(
        username=username,  # Preserve exact case
        email=normalised_email,
        password=generate_password_hash(password, method="pbkdf2:sha256"),
        display_name=display_name,  # Full name
    )

    db.session.add(user)
    db.session.flush()  # Flush to get user.userID before commit

    # Generate ECC key pair for end-to-end encryption
    try:
        private_key, public_key = generate_key_pair()
        public_key_str = serialize_public_key(public_key)

        # Store public key in database
        user_public_key = PublicKey(
            userID=user.userID,
            publicKey=public_key_str,
            algorithm="ECC-SECP256R1"
        )
        db.session.add(user_public_key)

        # Note: Private key is NOT stored on server - it will be generated
        # and stored on client-side in production. For now, we generate it
        # here but don't store it (client will need to generate their own)

    except Exception as e:
        db.session.rollback()
        return jsonify({"message": f"Failed to generate encryption keys: {str(e)}"}), 500

    db.session.commit()

    token = create_access_token(identity=str(user.userID))

    return (
        jsonify(
            {
                "accessToken": token,
                "user": user.to_dict(),
                "publicKey": public_key_str,  # Return public key to client
                "message": "Account created. Note: In production, generate key pair on client-side."
            }
        ),
        201,
    )


@auth_bp.post("/login")
def login():
    """Authenticate a user and issue a JWT access token (accepts username or email)."""
    payload = request.get_json(silent=True) or {}
    identifier = payload.get("username", "").strip()
    password = payload.get("password", "")

    if not identifier or not password:
        return jsonify({"message": "Username/email and password are required."}), 400

    # Get client IP address (handle proxies)
    if request.headers.getlist("X-Forwarded-For"):
        client_ip = request.headers.getlist("X-Forwarded-For")[0]
    else:
        client_ip = request.remote_addr

    # Check IP-based rate limiting FIRST (before username lookup)
    ip_attempt_record = LoginAttemptByIP.query.filter_by(ip_address=client_ip).first()

    if ip_attempt_record and ip_attempt_record.lockout_until:
        if datetime.utcnow() < ip_attempt_record.lockout_until:
            # IP is locked out
            time_remaining = ip_attempt_record.lockout_until - datetime.utcnow()
            seconds_remaining = int(time_remaining.total_seconds())
            minutes_remaining = seconds_remaining // 60

            if minutes_remaining > 0:
                time_str = f"{minutes_remaining} minute{'s' if minutes_remaining != 1 else ''}"
            else:
                time_str = f"{seconds_remaining} second{'s' if seconds_remaining != 1 else ''}"

            return jsonify({
                "message": f"Too many login attempts from your IP address. Please wait {time_str} before trying again.",
                "lockoutUntil": ip_attempt_record.lockout_until.isoformat(),
                "secondsRemaining": seconds_remaining
            }), 429
        else:
            # IP lockout expired - reset
            ip_attempt_record.failed_attempts = 0
            ip_attempt_record.lockout_until = None
            db.session.commit()

    # Try to find user by exact username first (case-SENSITIVE), then by email (case-insensitive)
    user = User.query.filter_by(username=identifier).first()
    if not user:
        user = User.query.filter(func.lower(User.email) == identifier.lower()).first()

    # If user doesn't exist, track IP attempt but return generic error
    if not user:
        # Track IP-based attempt for non-existent users too
        if not ip_attempt_record:
            ip_attempt_record = LoginAttemptByIP(ip_address=client_ip, failed_attempts=0)
            db.session.add(ip_attempt_record)

        ip_attempt_record.failed_attempts += 1
        ip_attempt_record.last_attempt = datetime.utcnow()

        # Check if IP should be locked out
        if ip_attempt_record.failed_attempts >= MAX_IP_LOGIN_ATTEMPTS:
            ip_attempt_record.lockout_until = datetime.utcnow() + timedelta(minutes=IP_LOCKOUT_DURATION_MINUTES)

        db.session.commit()
        return jsonify({"message": "Invalid credentials."}), 401

    # User exists - now check rate limiting for this account
    tracking_identifier = user.username

    # Check for existing login attempt record
    attempt_record = LoginAttempt.query.filter_by(username=tracking_identifier).first()

    # Check if user is currently locked out
    if attempt_record and attempt_record.lockout_until:
        if datetime.utcnow() < attempt_record.lockout_until:
            # Still locked out - calculate time remaining
            time_remaining = attempt_record.lockout_until - datetime.utcnow()
            seconds_remaining = int(time_remaining.total_seconds())
            minutes_remaining = seconds_remaining // 60
            seconds_part = seconds_remaining % 60

            if minutes_remaining > 0:
                time_str = f"{minutes_remaining} minute{'s' if minutes_remaining != 1 else ''} and {seconds_part} second{'s' if seconds_part != 1 else ''}"
            else:
                time_str = f"{seconds_part} second{'s' if seconds_part != 1 else ''}"

            return jsonify({
                "message": f"Too many failed login attempts. Please wait {time_str} before trying again.",
                "lockoutUntil": attempt_record.lockout_until.isoformat(),
                "secondsRemaining": seconds_remaining
            }), 429
        else:
            # Lockout period has expired - reset the attempt record
            attempt_record.failed_attempts = 0
            attempt_record.lockout_until = None
            db.session.commit()

    # Verify password (we know user exists at this point)
    if not check_password_hash(user.password, password):
        # Failed login - increment attempt counters (both user and IP)
        if not attempt_record:
            attempt_record = LoginAttempt(username=tracking_identifier, failed_attempts=0)
            db.session.add(attempt_record)

        attempt_record.failed_attempts += 1
        attempt_record.last_attempt = datetime.utcnow()

        # Also track IP-based attempts
        if not ip_attempt_record:
            ip_attempt_record = LoginAttemptByIP(ip_address=client_ip, failed_attempts=0)
            db.session.add(ip_attempt_record)

        ip_attempt_record.failed_attempts += 1
        ip_attempt_record.last_attempt = datetime.utcnow()

        # Check if IP should be locked out
        if ip_attempt_record.failed_attempts >= MAX_IP_LOGIN_ATTEMPTS:
            ip_attempt_record.lockout_until = datetime.utcnow() + timedelta(minutes=IP_LOCKOUT_DURATION_MINUTES)

        remaining_attempts = MAX_LOGIN_ATTEMPTS - attempt_record.failed_attempts

        # Check if we should lock out the user account
        if attempt_record.failed_attempts >= MAX_LOGIN_ATTEMPTS:
            attempt_record.lockout_until = datetime.utcnow() + timedelta(minutes=LOCKOUT_DURATION_MINUTES)
            db.session.commit()
            return jsonify({
                "message": f"Too many failed login attempts. Your account has been locked for {LOCKOUT_DURATION_MINUTES} minute{'s' if LOCKOUT_DURATION_MINUTES != 1 else ''}.",
                "lockoutUntil": attempt_record.lockout_until.isoformat(),
                "secondsRemaining": LOCKOUT_DURATION_MINUTES * 60
            }), 429

        db.session.commit()
        return jsonify({
            "message": f"Invalid credentials. {remaining_attempts} attempt{'s' if remaining_attempts != 1 else ''} remaining.",
            "attemptsRemaining": remaining_attempts
        }), 401

    # Successful login - reset attempt counters (both user and IP)
    if attempt_record:
        db.session.delete(attempt_record)
    if ip_attempt_record:
        db.session.delete(ip_attempt_record)
    db.session.commit()

    token = create_access_token(identity=str(user.userID))

    # Get user's encrypted private key for key recovery
    public_key = PublicKey.query.filter_by(userID=user.userID).first()

    response_data = {
        "accessToken": token,
        "user": user.to_dict()
    }

    # Include encrypted private key if available (for key recovery on new device)
    if public_key and public_key.encrypted_private_key:
        response_data["encryptedPrivateKey"] = public_key.encrypted_private_key
        response_data["salt"] = public_key.private_key_salt
        response_data["iv"] = public_key.private_key_iv

    return jsonify(response_data), 200


@auth_bp.get("/me")
@jwt_required()
def me():
    """Return the authenticated user's profile."""
    user_id = int(get_jwt_identity())
    user = User.query.get(user_id)
    if not user:
        return jsonify({"message": "User not found."}), 404
    return jsonify({"user": user.to_dict()}), 200
