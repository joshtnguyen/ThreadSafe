from __future__ import annotations

import os
from pathlib import Path

from flask import Flask, jsonify, request
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

    # CORS: allow requests from configured frontend origin
    frontend_origin = app.config.get("FRONTEND_ORIGIN") or os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
    allowed_origin_values = [
        origin for origin in {
            frontend_origin,
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        } if origin
    ]
    cors_resources = {
        r"/api/*": {
            "origins": allowed_origin_values,
            "methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            "allow_headers": ["Content-Type", "Authorization"],
        }
    }

    CORS(
        app,
        resources=cors_resources,
        supports_credentials=True,
    )
    db.init_app(app)
    jwt.init_app(app)

    # Register blueprints lazily to avoid circular imports.
    from .routes import register_blueprints

    register_blueprints(app)

    allowed_origins_set = set(allowed_origin_values)

    @app.before_request
    def handle_preflight():
        """Return proper CORS headers for OPTIONS preflight before auth decorators run."""
        if request.method == "OPTIONS":
            response = app.make_default_options_response()
            origin = request.headers.get("Origin")
            if origin in allowed_origins_set:
                response.headers["Access-Control-Allow-Origin"] = origin
                response.headers["Vary"] = "Origin"
            response.headers.setdefault(
                "Access-Control-Allow-Headers", "Content-Type, Authorization"
            )
            response.headers.setdefault(
                "Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS"
            )
            response.headers.setdefault("Access-Control-Allow-Credentials", "true")
            return response

    @app.after_request
    def apply_cors_headers(response):
        """Guarantee CORS headers are attached to API responses."""
        origin = request.headers.get("Origin")
        if origin in allowed_origins_set:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
        response.headers.setdefault(
            "Access-Control-Allow-Headers", "Content-Type, Authorization"
        )
        response.headers.setdefault(
            "Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        )
        response.headers.setdefault("Access-Control-Allow-Credentials", "true")
        return response

    @app.get("/api/ping")
    def ping():
        """Simple health-check endpoint."""
        return jsonify({"status": "ok"}), 200

    # Ensure tables exist without requiring migrations for this minimal build.
    with app.app_context():
        db.create_all()

    return app


__all__ = ["create_app", "db", "jwt"]
