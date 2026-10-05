window.ACE_API_URL = 'http://localhost:3000';
window.addEventListener('DOMContentLoaded', async () => {
  const status = document.getElementById('status');
  const signin = document.getElementById('signin');
  const signout = document.getElementById('signout');
  try {
    const client = await window.ACEAuth.client();
    const { data } = await client.auth.getSession();
    if (data.session) {
      const response = await fetch(`${window.ACE_API_URL}/v1/me`, { headers: { Authorization: `Bearer ${data.session.access_token}` } });
      if (!response.ok) { await client.auth.signOut(); throw new Error('Your session has ended. Sign in again.'); }
      const user = await response.json();
      status.textContent = `Google sign-in worked. Signed in as ${user.email}. Your session is stored in local PostgreSQL.`;
      signout.hidden = false;
    } else {
      status.textContent = sessionStorage.getItem('ace_login_notice') || 'Ready. Sign in with your head administrator Google account.';
      sessionStorage.removeItem('ace_login_notice');
      signin.hidden = false;
    }
    signin.onclick = async () => { await client.auth.signInWithOAuth(); };
    signout.onclick = async () => {
      const { error } = await client.auth.signOut();
      if (error) { status.textContent = error.message; return; }
      window.location.replace('/login');
    };
  } catch (error) { status.textContent = error.message; signin.hidden = false; signin.onclick = () => window.location.reload(); }
});
