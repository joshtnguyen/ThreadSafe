from __future__ import annotations

from flask import Flask

from .admin import admin_bp
from .auth import auth_bp
from .backups import backups_bp
from .contacts import friends_bp
from .conversations import conversations_bp
from .keys import keys_bp
from .settings import settings_bp


def register_blueprints(app: Flask) -> None:
    """Attach all API blueprints to the Flask application."""
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(friends_bp, url_prefix="/api/friends")
    app.register_blueprint(conversations_bp, url_prefix="/api/conversations")
    app.register_blueprint(keys_bp, url_prefix="/api/keys")
    app.register_blueprint(settings_bp, url_prefix="/api/settings")
    app.register_blueprint(backups_bp, url_prefix="/api/backups")
    app.register_blueprint(admin_bp, url_prefix="/api/admin")


__all__ = ["register_blueprints"]
