import test from 'node:test';
import assert from 'node:assert/strict';
import {freshProject,parseImport,themeForExport}from'../frontend-dist/studio/workshop/core.mjs';

test('old workshop projects acquire preview defaults without changing theme fields',()=>{
 const input={kind:'qiuqiu-workshop',version:1,theme:{custom_css:'.x{color:pink}',private_plugin_field:{value:3}},sample:{userName:'旧草稿'}};
 const result=parseImport(JSON.stringify(input)).project;
 assert.equal(result.sample.runtime,'sillytavern');assert.equal(result.sample.composerActions,true);assert.equal(result.sample.scriptState,'idle');assert.equal(result.sample.userName,'旧草稿');assert.deepEqual(result.theme,input.theme);
});
test('Tauri preview choices round-trip only in the workshop project',()=>{
 const project=freshProject();Object.assign(project.sample,{runtime:'tauritavern',oled:true,quickReplies:true,scriptState:'paused'});
 const restored=parseImport(JSON.stringify(project)).project;
 assert.equal(restored.sample.runtime,'tauritavern');assert.equal(restored.sample.oled,true);assert.equal(restored.sample.quickReplies,true);assert.equal(restored.sample.scriptState,'paused');
 const theme=themeForExport(restored.theme,'我的美化','body{color:pink}');assert.ok(!('runtime'in theme));assert.ok(!('oled'in theme));assert.equal(theme.custom_css,'body{color:pink}');
});
test('unsupported runtime and script state values fall back to safe preview defaults',()=>{
 const project=freshProject();project.sample.runtime='https://untrusted.invalid/runtime.js';project.sample.scriptState='injected';
 const restored=parseImport(JSON.stringify(project)).project;
 assert.equal(restored.sample.runtime,'sillytavern');assert.equal(restored.sample.scriptState,'idle');
});
