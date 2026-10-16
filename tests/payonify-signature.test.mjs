// Local HMAC fixtures only: no provider calls, credentials, payments or DB.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {verifyWebhookSignature} from '../api/_payonify.js';
test('signed webhook bytes still verify; tampering, stale and malformed signatures fail safely',async()=>{
  const previous=process.env.PAYONIFY_WEBHOOK_SECRET;
  process.env.PAYONIFY_WEBHOOK_SECRET='local-test-fixture-not-a-provider-secret';
  try {
    const payload=JSON.stringify({type:'checkout.succeeded',data:{object:{id:'fixture-only'}}});
    const now=Math.floor(Date.now()/1000);
    const sign=(body,time=now)=>`t=${time},v1=${createHmac('sha256',process.env.PAYONIFY_WEBHOOK_SECRET).update(`${time}.${body}`).digest('hex')}`;
    assert.equal((await verifyWebhookSignature(payload,sign(payload))).ok,true);
    assert.equal((await verifyWebhookSignature(payload+' ',sign(payload))).ok,false);
    assert.equal((await verifyWebhookSignature(payload,sign(payload,now-600))).reason,'timestamp-too-old');
    for(const signature of ['',`t=${now},v1=short`,`t=${now},v1=${'z'.repeat(64)}`,`t=${now},v1=${'0'.repeat(64)}`])assert.equal((await verifyWebhookSignature(payload,signature)).ok,false);
  } finally {
    if(previous===undefined)delete process.env.PAYONIFY_WEBHOOK_SECRET;else process.env.PAYONIFY_WEBHOOK_SECRET=previous;
  }
});
