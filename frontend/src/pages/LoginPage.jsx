import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../lib/api.js";
import { generateKeyPair, exportPrivateKey, exportPublicKey } from "../lib/crypto.js";
import { getPrivateKey, getPublicKey, storePrivateKey, storePublicKey } from "../lib/keyStorage.js";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await api.login(form);
      await ensureEncryptionKeys(response.user.id, response.accessToken);
      login(response.user, response.accessToken);
      navigate("/app");
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const ensureEncryptionKeys = async (userId, accessToken) => {
    let privateKeyPem = getPrivateKey(userId);
    let publicKeyPem = getPublicKey(userId);

    if (!privateKeyPem || !publicKeyPem) {
      const keyPair = await generateKeyPair();
      publicKeyPem = await exportPublicKey(keyPair.publicKey);
      privateKeyPem = await exportPrivateKey(keyPair.privateKey);
      storePrivateKey(privateKeyPem, userId);
      storePublicKey(publicKeyPem, userId);

      try {
        await api.rotatePublicKey(accessToken, publicKeyPem);
      } catch (rotationError) {
        if (rotationError.message.includes("No existing key")) {
          await api.registerPublicKey(accessToken, publicKeyPem);
        } else {
          throw rotationError;
        }
      }
    } else {
      try {
        await api.myPublicKey(accessToken);
      } catch (error) {
        if (error.message.includes("not registered")) {
          await api.registerPublicKey(accessToken, publicKeyPem);
        } else {
          throw error;
        }
      }
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-header">
          <span className="auth-logo">ThreadSafe</span>
          <span className="auth-badge" aria-hidden>
            ✓
          </span>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span className="field-label">Username or Email</span>
            <input
              name="username"
              value={form.username}
              onChange={handleChange}
              placeholder="Username or Email"
              autoComplete="username"
              required
            />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              placeholder="Password"
              autoComplete="current-password"
              required
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="action-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Logging in..." : "Log in"}
          </button>
        </form>
        <p className="auth-footer">
          Don&apos;t have an account? <Link to="/register">Register here</Link>
        </p>
        <p className="auth-meta">
          <span>About the app</span>
          <span className="info-icon" aria-hidden>
            i
          </span>
        </p>
      </section>
    </main>
  );
}
