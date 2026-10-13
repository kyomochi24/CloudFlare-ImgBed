import assert from 'node:assert/strict';
import test from 'node:test';
import {createRecolorTransform, DEFAULT_RECOLOR, rgbToHsl, hexToHsl} from '../frontend-dist/studio/candy-recolor.js';
const rules=[{...DEFAULT_RECOLOR,target:'#4695e7'},{source:'#4695e7',target:'#87c9a1',range:25,softness:50}];
const distance=(a,b)=>Math.abs(((a-b+540)%360)-180);

test('pink to blue and original blue to green apply without cascading',()=>{
  const data=new Uint8ClampedArray([237,143,182,255,70,149,231,255,255,211,112,255]);
  createRecolorTransform(rules)(data);
  assert.ok(distance(rgbToHsl(...data.slice(0,3))[0],hexToHsl('#4695e7')[0])<1);
  assert.ok(distance(rgbToHsl(...data.slice(4,7))[0],hexToHsl('#87c9a1')[0])<1);
  assert.deepEqual([...data.slice(8)],[255,211,112,255]);
});

test('the nearest source hue wins when color ranges overlap',()=>{
  const data=new Uint8ClampedArray([237,143,182,255]);
  createRecolorTransform([{source:'#ed8f98',target:'#4695e7',range:60,softness:0},{...DEFAULT_RECOLOR,range:60,softness:0}])(data);
  assert.ok(distance(rgbToHsl(...data)[0],hexToHsl(DEFAULT_RECOLOR.target)[0])<1);
});

test('protection excludes a pixel from all rules and removing a rule leaves its source unchanged',()=>{
  const data=new Uint8ClampedArray([237,143,182,255,70,149,231,255]);
  createRecolorTransform(rules,false,{protection:{width:2,height:1,data:new Uint8Array([255,0])},width:2,height:1})(data);
  assert.deepEqual([...data.slice(0,4)],[237,143,182,255]);
  assert.ok(data[5]>data[4]);
  const blue=new Uint8ClampedArray([70,149,231,91]);createRecolorTransform([rules[0]])(blue);
  assert.deepEqual([...blue],[70,149,231,91]);
});
