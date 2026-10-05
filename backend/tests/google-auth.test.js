import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleAuth, validateGoogleClaims } from '../server/google-auth.js';

const env = { GOOGLE_CLIENT_ID:'test', GOOGLE_CLIENT_SECRET:'test', HEAD_ADMIN_EMAIL:'owner@gmail.com',
  GOOGLE_REDIRECT_URI:'https://green-api.example/v1/auth/google/callback', GREEN_FRONTEND_URL:'https://green.example' };
test('Google claims require a matching nonce and authoritative verified email', () => {
  const claims = {sub:'123',email:'owner@gmail.com',email_verified:true,nonce:'test'};
  assert.equal(validateGoogleClaims(claims,'test').sub,'123');
  for (const changed of [{nonce:'other'},{email_verified:false},{sub:undefined},{email:15},{email:'owner@external.example'},{email:'owner@external.example',hd:'different.example'}]) {
    assert.throws(() => validateGoogleClaims({...claims,...changed},'test'));
  }
  assert.throws(() => validateGoogleClaims({...claims,nonce:'éé'},'test'));
  assert.equal(validateGoogleClaims({...claims,email:'user@company.example',hd:'company.example'},'test').email,'user@company.example');
});
test('HTTP is accepted only by explicit local development configuration', () => {
  const local = {...env, GREEN_FRONTEND_URL:'http://localhost:5500',GOOGLE_REDIRECT_URI:'http://localhost:3000/v1/auth/google/callback'};
  assert.throws(() => createGoogleAuth({},local));
  assert.doesNotThrow(() => createGoogleAuth({}, {...local,NODE_ENV:'development',GOOGLE_AUTH_LOCAL_TEST:'true'}));
  assert.throws(() => createGoogleAuth({}, {...local,NODE_ENV:'production',GOOGLE_AUTH_LOCAL_TEST:'true'}));
  assert.throws(() => createGoogleAuth({}, {...env,GREEN_FRONTEND_URL:'https://aceclock.onrender.com'}));
  assert.throws(() => createGoogleAuth({}, {...env,GOOGLE_REDIRECT_URI:'https://user:pass@green-api.example/v1/auth/google/callback'}));
});
