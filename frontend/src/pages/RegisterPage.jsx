import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../lib/api.js";
import { generateKeyPair, exportPublicKey, exportPrivateKey, encryptPrivateKeyWithPassword } from "../lib/crypto.js";
import { storePrivateKey, storePublicKey } from "../lib/keyStorage.js";

export default function RegisterPage() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    displayName: "",
  });
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
  };

  const validateUsername = (username) => {
    // 3-15 characters, start with letter, allow letters/numbers/_-. after first char
    const usernamePattern = /^[a-zA-Z][a-zA-Z0-9._-]{2,14}$/;

    if (username.length < 3) {
      return "Username must be at least 3 characters long.";
    }
    if (username.length > 15) {
      return "Username must not exceed 15 characters.";
    }
    if (!/^[a-zA-Z]/.test(username)) {
      return "Username must start with a letter, not a number or special character.";
    }
    if (!usernamePattern.test(username)) {
      return "Username can only contain letters, numbers, underscore (_), hyphen (-), and period (.).";
    }
    return null; // Valid
  };

  const validatePassword = (password) => {
    // 8-15 characters, all letters and special characters allowed
    if (password.length < 8) {
      return "Password must be at least 8 characters long.";
    }
    if (password.length > 15) {
      return "Password must not exceed 15 characters.";
    }
    return null; // Valid
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    // Validate username on client side
    const usernameError = validateUsername(form.username);
    if (usernameError) {
      setError(usernameError);
      return;
    }

    // Validate password on client side
    const passwordError = validatePassword(form.password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setIsSubmitting(true);

    try {
      // Step 1: Generate ECC key pair client-side
      const keyPair = await generateKeyPair();
      const publicKeyPem = await exportPublicKey(keyPair.publicKey);
      const privateKeyPem = await exportPrivateKey(keyPair.privateKey);

      // Step 2: Encrypt private key with password for backup/recovery
      const { encryptedPrivateKey, salt, iv } = await encryptPrivateKeyWithPassword(
        privateKeyPem,
        form.password
      );

      // Step 3: Register account (backend will generate its own keys initially)
      const response = await api.register(form);

      // Step 4: Store private key locally with user ID
      storePrivateKey(privateKeyPem, response.user.id);
      storePublicKey(publicKeyPem, response.user.id);

      // Step 5: Update backend with our client-generated public key and encrypted private key backup
      await api.rotatePublicKey(
        response.accessToken,
        publicKeyPem,
        encryptedPrivateKey,
        salt,
        iv
      );

      // Step 6: Login
      login(response.user, response.accessToken);
      navigate("/app");
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-header">
          <span className="auth-logo">Create Account</span>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span className="field-label">Display Name</span>
            <input
              name="displayName"
              value={form.displayName}
              onChange={handleChange}
              placeholder="Your Display Name"
              autoComplete="name"
            />
          </label>
          <label className="field">
            <span className="field-label">Username</span>
            <input
              name="username"
              value={form.username}
              onChange={handleChange}
              placeholder="Username"
              autoComplete="username"
              required
            />
          </label>
          <label className="field">
            <span className="field-label">Email</span>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              placeholder="Email Address"
              autoComplete="email"
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
              autoComplete="new-password"
              required
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="action-button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Creating account..." : "Register"}
          </button>
        </form>
        <p className="auth-footer">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </section>
    </main>
  );
}
