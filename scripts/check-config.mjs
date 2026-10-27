const missing=[];
if(!/^[A-Za-z0-9._@-]{3,80}$/.test(process.env.ADMIN_USERNAME?.trim()||''))missing.push('ADMIN_USERNAME');
if(!/^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/i.test(process.env.ADMIN_PASSWORD_HASH||''))missing.push('ADMIN_PASSWORD_HASH');
for(const name of ['SESSION_SECRET','INGEST_API_TOKEN'])if(!/^[0-9a-f]{64,128}$/i.test(process.env[name]||'')||(process.env[name]||'').length%2!==0)missing.push(name);
try {
  const url=new URL(process.env.APP_ORIGIN||'');
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)missing.push('APP_ORIGIN');
} catch {missing.push('APP_ORIGIN');}
if(missing.length){console.error('Configuration missing or invalid: '+missing.join(', ')+'. Run node scripts/setup.mjs and keep .env private.');process.exit(1);}
console.log('Required owner-account configuration is present.');
