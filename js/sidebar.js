// The app shell is mounted by script.js only after /v1/me confirms the
// authenticated profile. Do not restore roles or identity from localStorage.
window.addEventListener('ace-session-verified', () => {});
