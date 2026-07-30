async function login() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('error');
  errorEl.textContent = '';

  if (!email || !password) {
    errorEl.textContent = 'Please enter both email and password.';
    return;
  }

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      errorEl.textContent = data.error || 'Login failed.';
      return;
    }

    // Success -> the campaign manager's home page.
    window.location.href = '/campaign/index.html';
  } catch (err) {
    errorEl.textContent = 'Network error, please try again.';
  }
}
