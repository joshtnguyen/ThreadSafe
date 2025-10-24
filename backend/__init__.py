from __future__ import annotations

import os
from pathlib import Path

from flask import Flask, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager

from .config import Config
from .database import db

jwt = JWTManager()


def create_app(config_class: type[Config] | None = None) -> Flask:
    """Application factory used by both run.py and tests."""
    app = Flask(__name__, instance_relative_config=True)

    # Ensure the instance folder exists for the SQLite database.
    try:
        os.makedirs(app.instance_path, exist_ok=True)
    except OSError:
        pass

    app.config.from_object(config_class or Config())

    # Initialise extensions.
    CORS(app, supports_credentials=True)
    db.init_app(app)
    jwt.init_app(app)

    # Register blueprints lazily to avoid circular imports.
    from .routes import register_blueprints

    register_blueprints(app)

    @app.get("/api/ping")
    def ping():
        """Simple health-check endpoint."""
        return jsonify({"status": "ok"}), 200

    # Ensure tables exist without requiring migrations for this minimal build.
    with app.app_context():
        db.create_all()

    return app


__all__ = ["create_app", "db", "jwt"]
