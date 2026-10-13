import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_RECOLOR, createRecolorTransform, protectionAt } from '../frontend-dist/studio/candy-recolor.js';

test('protected pink stays original while neighboring pink turns green', () => {
  const data = new Uint8ClampedArray([237,143,182,73,237,143,182,255]);
  const protection = {width:2,height:1,data:new Uint8Array([255,0])};
  createRecolorTransform(DEFAULT_RECOLOR,false,{protection,width:2,height:1})(data);
  assert.deepEqual([...data.slice(0,4)],[237,143,182,73]);
  assert.ok(data[5]>data[4] && data[5]>data[6]); assert.equal(data[7],255);
});

test('partial protection blends with the original instead of adding a tint', () => {
  const full = new Uint8ClampedArray([237,143,182,255]);
  const partial = full.slice();
  createRecolorTransform()(full);
  createRecolorTransform(DEFAULT_RECOLOR,false,{protection:{width:1,height:1,data:new Uint8Array([128])},width:1,height:1})(partial);
  assert.ok(partial[0]>full[0] && partial[0]<237);
  assert.ok(partial[1]<full[1] && partial[1]>143);
  assert.equal(partial[3],255);
});

test('selection preview excludes protected regions', () => {
  const data = new Uint8ClampedArray([237,143,182,255,237,143,182,255]);
  createRecolorTransform(DEFAULT_RECOLOR,true,{protection:{width:2,height:1,data:new Uint8Array([255,0])},width:2,height:1})(data);
  assert.equal(data[0],data[1]); assert.equal(data[1],data[2]);
  assert.deepEqual([...data.slice(4)],[243,111,162,255]);
});

test('protection sampling interpolates and clamps image edges', () => {
  const protection = {width:2,height:2,data:new Uint8Array([255,0,0,0])};
  assert.equal(protectionAt(protection,0,0),1);
  assert.equal(protectionAt(protection,.5,.5),.25);
  assert.equal(protectionAt(protection,-10,-10),1);
  assert.equal(protectionAt(protection,50,50),0);
  assert.equal(protectionAt(null,0,0),0);
});

test('protection stays in the same normalized region at export resolution', () => {
  const data = new Uint8ClampedArray(Array.from({length:8},()=>[237,143,182,255]).flat());
  const protection = {width:2,height:1,data:new Uint8Array([255,0])};
  const transform = createRecolorTransform(DEFAULT_RECOLOR,false,{protection,width:8,height:1});
  transform(data,0,16); transform(data,16,data.length);
  assert.deepEqual([...data.slice(0,8)],[237,143,182,255,237,143,182,255]);
  assert.ok(data[29]>data[28], 'far right remains editable');
});
