// Offline administrative configuration generator. Does not connect to a Site or grant credits.
import {randomBytes,createHash} from 'node:crypto';
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const i=a.indexOf('=');return[i<0?a:a.slice(0,i),i<0?'true':a.slice(i+1)];}));
const kind=args['--kind']||'promo',credits=Number(args['--credits']||5),maxUses=Number(args['--limit']||10),expiresAt=args['--expires']||'';
if(!['partner','creator','promo'].includes(kind)||!Number.isSafeInteger(credits)||credits<1||credits>200||!Number.isSafeInteger(maxUses)||maxUses<1||maxUses>200||!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=Date.now())throw new Error('Use --kind=promo --credits=5 --limit=10 --expires=<future ISO date>. Nothing was saved.');
const code='CA-'+randomBytes(8).toString('hex').toUpperCase();console.log(JSON.stringify({code,configuration:{hash:createHash('sha256').update(code).digest('hex'),kind,credits,maxUses,expiresAt:new Date(expiresAt).toISOString()},active:false,note:'Offline configuration only. Requires separate approved redemption/provider integration; no credits or access granted.'},null,2));
