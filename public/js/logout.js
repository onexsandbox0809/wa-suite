async function handleLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (err) {
    // Ignore network errors -- redirect to login regardless, since the
    // whole point is to end up logged out either way.
  }
  window.location.href = '/login.html';
}
